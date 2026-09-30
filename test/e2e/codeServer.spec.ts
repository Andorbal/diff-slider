/**
 * End-to-end test against a real VS Code build (code-server) with this
 * extension installed. Skipped unless DIFF_SLIDER_CODE_SERVER points at one,
 * e.g. started with:
 *
 *   code-server --auth none --bind-addr 127.0.0.1:8123 \
 *     --extensions-dir <dir containing a symlink to this repo> --disable-workspace-trust
 *
 * See CONTRIBUTING.md for the full recipe.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';

const SERVER = process.env.DIFF_SLIDER_CODE_SERVER;
test.skip(!SERVER, 'Set DIFF_SLIDER_CODE_SERVER to a code-server URL with the extension installed');

const SUBJECTS = [
  'Add retry helper',
  'Handle timeouts',
  'Log each attempt',
  'Add exponential backoff',
  'Fix off-by-one in retries',
  'Extract delay helper',
  'Support abort signals',
  'Tidy up types',
  'Add jitter to backoff',
  'Document options',
  'Rename to request()',
  'Guard against negative retries',
];

/** A repo whose src/request.ts has 12 commits (renamed from src/net.ts), a staged change and an unstaged one. */
function createRepo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diff-slider-e2e-')));
  let day = 0;
  const git = (...args: string[]) => {
    const date = new Date(Date.UTC(2025, 2, 1 + day * 3, 10)).toISOString();
    return execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    }).toString();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Ada Lovelace');
  git('config', 'user.email', 'ada@example.com');
  git('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(root, 'src'));
  const lines = ['export function fetchWithRetry(url: string, retries: number) {', '  let attempt = 0;', '  return null;', '}', ''];
  let file = 'src/net.ts';
  SUBJECTS.forEach((subject, i) => {
    if (i === 10) {
      git('mv', 'src/net.ts', 'src/request.ts');
      file = 'src/request.ts';
      lines[0] = lines[0].replace('fetchWithRetry', 'request');
    }
    if (i > 0) lines.splice(2, 0, `  // ${subject.toLowerCase()}`);
    fs.writeFileSync(path.join(root, file), lines.join('\n'));
    git('add', '-A');
    git('commit', '-q', '-m', subject);
    if (i === 7) git('tag', 'v1.0.0');
    day++;
  });
  lines.splice(1, 0, '  // staged change');
  fs.writeFileSync(path.join(root, file), lines.join('\n'));
  git('add', file);
  lines.push('// unstaged change');
  fs.writeFileSync(path.join(root, file), lines.join('\n'));
  fs.writeFileSync(path.join(root, 'scratch.txt'), 'not tracked\n');
  return root;
}

let page: Page;
let repo: string;

/** The Diff Slider webview that is currently visible. */
async function slider(): Promise<FrameLocator> {
  const outer = page.locator('iframe.webview.ready').filter({ visible: true });
  await expect(outer).toHaveCount(1);
  return outer.contentFrame().frameLocator('#active-frame');
}

/** Types into the quick input and waits until the top entry matches `expected` before accepting. */
async function pick(open: string, text: string, expected: RegExp, key = 'Enter') {
  await page.keyboard.press(open);
  await page.keyboard.type(text);
  // File search can take a while right after the server starts.
  await expect(page.locator('.quick-input-list .monaco-list-row').first()).toHaveAttribute('aria-label', expected, {
    timeout: 20_000,
  });
  await page.keyboard.press(key);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const runCommand = (name: string) => pick('F1', name, new RegExp(`^${escape(name)}`));
/** Opens a file by its path relative to the workspace (never the "History:" panel with the same name). */
const quickOpen = (file: string, key = 'Enter') =>
  pick('Control+P', file, new RegExp(`^${escape(path.basename(file))} ${escape(path.dirname(file))}\\b`), key);

/** Right-clicks `target` and picks `label`; VS Code ignores clicks that land right as a menu opens. */
async function contextMenu(target: Locator, label: string) {
  await target.click({ button: 'right' });
  const item = page.locator('.context-view .action-item', { hasText: label });
  await item.waitFor();
  await page.waitForTimeout(300);
  await item.click();
  await expect(page.locator('.context-view .monaco-menu')).toHaveCount(0);
}

test.describe.serial('Diff Slider in VS Code', () => {
  test.beforeAll(async ({ browser }) => {
    repo = createRepo();
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${SERVER}/?folder=${encodeURIComponent(repo)}`);
    await page.locator('.monaco-workbench').waitFor({ timeout: 60_000 });
    // Let the git extension discover the repository.
    await expect(page.locator('.statusbar')).toContainText('main', { timeout: 30_000 });
  });

  test.afterAll(async () => {
    await page?.close();
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
  });

  test('the keybinding opens the slider on latest commit ↔ working copy', async () => {
    await quickOpen('src/request.ts');
    await expect(page.locator('.tab.active')).toContainText('request.ts');
    await page.locator('.editor-instance .monaco-editor').first().click();
    await page.keyboard.press('Control+Alt+H');
    await expect(page.locator('.tab.active')).toContainText('History: request.ts');
    const f = await slider();
    await expect(f.locator('.app')).toHaveClass(/state-ready/, { timeout: 30_000 });
    // 12 commits (followed across the rename) + staged + working copy.
    await expect(f.locator('.tl-tick')).toHaveCount(14);
    await expect(f.locator('.file-count')).toHaveText('12 commits');
    await expect(f.locator('.side.old')).toContainText('Guard against negative retries');
    await expect(f.locator('.side.new')).toContainText('Working copy');
    await expect(f.locator('.stats')).toContainText('+2');
    await expect(f.locator('.editor.modified')).toContainText('unstaged change');
  });

  test('dragging back past the rename shows the old file content', async () => {
    const f = await slider();
    const knob = (await f.locator('.tl-handle.is-old .tl-handle-knob').boundingBox())!;
    const first = (await f.locator('.tl-tick').first().boundingBox())!;
    await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) {
      await page.mouse.move(knob.x + ((first.x - knob.x) * i) / 15, knob.y + knob.height / 2);
    }
    await expect(f.locator('.card .card-subject')).toHaveText('Add retry helper');
    await page.mouse.up();
    await expect(f.locator('.side.old')).toContainText('Add retry helper');
    await expect(f.locator('.editor.original')).toContainText('fetchWithRetry');
    await expect(f.locator('.stats')).toContainText('11 commits');
  });

  test('the Content changes only checkbox is saved in the user settings', async () => {
    const f = await slider();
    const box = f.locator('input[data-option="contentChangesOnly"]');
    await expect(box).toBeChecked();
    await expect(f.locator('.notice')).toBeHidden();
    await f.locator('label.check').click();
    await expect(box).not.toBeChecked();
    // No commit here is a pure rename, so the timeline stays the same and the panel says why.
    await expect(f.locator('.toast')).toContainText('Nothing to show');
    await expect(f.locator('.tl-tick')).toHaveCount(14);
    await runCommand('Preferences: Open User Settings (JSON)');
    await expect(page.locator('.editor-instance .view-lines')).toContainText('"diffSlider.contentChangesOnly": false');
    await page.keyboard.press('Control+W');
    await page.locator('.tab', { hasText: 'History: request.ts' }).click();
    await (await slider()).locator('label.check').click();
    await expect(box).toBeChecked();
    // VS Code reports failed settings writes (such as an unregistered setting) as notifications.
    await expect(page.locator('.notifications-toasts', { hasText: 'Diff Slider' })).toHaveCount(0);
  });

  test('opens the same comparison in the VS Code diff editor', async () => {
    const f = await slider();
    await f.locator('[data-cmd="openDiff"]').click();
    await expect(page.locator('.tab.active')).toContainText('↔ Working Copy');
    await expect(page.locator('.editor-instance .monaco-diff-editor .editor.original')).toContainText('fetchWithRetry');
    await page.keyboard.press('Control+W');
    await page.locator('.tab', { hasText: 'History: request.ts' }).click();
  });

  test('typing in the file updates the working copy side live', async () => {
    await quickOpen('src/request.ts', 'Control+Enter'); // open to the side, slider stays visible
    await expect(page.locator('.editor-group-container')).toHaveCount(2);
    // The file opened in a new, active group next to the slider; type into it.
    await page.locator('.editor-group-container.active .monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n// typed live');
    const f = await slider();
    await expect(f.locator('.editor.modified')).toContainText('typed live');
    await expect(f.locator('.side.new')).toContainText('unsaved changes');
    // Undo the typing (the editor may already have auto-saved it).
    for (let i = 0; i < 20; i++) await page.keyboard.press('Control+Z');
    await expect(f.locator('.editor.modified')).not.toContainText('typed live');
    await expect(page.locator('.tab.active.dirty')).toHaveCount(0, { timeout: 10_000 });
    await page.keyboard.press('Control+W'); // closing the last editor also closes its group
    await expect(page.locator('.editor-group-container')).toHaveCount(1);
  });

  test('refreshes by itself after a commit made outside VS Code', async () => {
    execFileSync('git', ['commit', '-q', '-m', 'Commit from the terminal'], { cwd: repo });
    const f = await slider();
    await expect(f.locator('.file-count')).toHaveText('13 commits', { timeout: 20_000 });
    // The staged stop is gone because the index now matches HEAD.
    await expect(f.locator('.tl-tick.staged')).toHaveCount(0);
    await expect(f.locator('.tl-tick')).toHaveCount(14);
  });

  test('restores the panel and its selection after a window reload', async () => {
    const f = await slider();
    await f.locator('.side.old').click();
    await page.keyboard.press('End'); // old handle -> working copy
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const before = (await f.locator('.side.old').textContent())!;
    await page.waitForTimeout(500); // selection is reported to the host after a short debounce
    await runCommand('Developer: Reload Window');
    await page.locator('.monaco-workbench').waitFor({ timeout: 60_000 });
    await expect(page.locator('.tab.active')).toContainText('History: request.ts', { timeout: 30_000 });
    const g = await slider();
    await expect(g.locator('.app')).toHaveClass(/state-ready/, { timeout: 30_000 });
    await expect(g.locator('.side.old')).toHaveText(before);
  });

  test('opens on a specific commit from the Timeline view', async () => {
    // Include the folder so Quick Open picks the file, not the "History: request.ts" panel.
    await quickOpen('src/request.ts');
    await expect(page.locator('.tab.active')).not.toContainText('History');
    const timeline = page.locator('.pane-header', { hasText: 'Timeline' });
    if ((await timeline.getAttribute('aria-expanded')) !== 'true') await timeline.click();
    const item = page.locator('.timeline-tree-view .monaco-list-row', { hasText: 'Add jitter to backoff' });
    await contextMenu(item, 'Show File History Slider');
    await expect(page.locator('.tab.active')).toContainText('History: request.ts');
    const f = await slider();
    // The handles select exactly that commit's change.
    await expect(f.locator('.side.new')).toContainText('Add jitter to backoff');
    await expect(f.locator('.side.old')).toContainText('Tidy up types');
    await timeline.click();
  });

  test('is offered in the explorer context menu and explains untracked files', async () => {
    const row = page.locator('.explorer-folders-view .monaco-list-row', { hasText: 'scratch.txt' });
    await contextMenu(row, 'Show File History Slider');
    await expect(page.locator('.tab.active')).toContainText('History: scratch.txt');
    const f = await slider();
    await expect(f.locator('.app')).toHaveClass(/state-empty/, { timeout: 30_000 });
    await expect(f.locator('.status')).toContainText('no git history yet');
  });
});
