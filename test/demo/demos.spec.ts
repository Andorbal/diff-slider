/**
 * Records the animations in the README (media/demo/*.gif) from the real
 * extension running in code-server, on the history of Express. Each scene
 * checks what it expects to see, so a run fails instead of recording
 * something broken. See "Recording the README animations" in CONTRIBUTING.md.
 *
 *   CODE_SERVER=/path/to/code-server npm run demos
 *   CODE_SERVER=/path/to/code-server npm run demos -- -g follow-renames
 */
import * as path from 'path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { Pointer, Recorder, showKeys, sleep } from './recorder';
import {
  ROOT,
  center,
  command,
  findFfmpeg,
  goToLine,
  hideSideBar,
  knob,
  openWorkbench,
  prepareRepo,
  quickOpen,
  resetRepo,
  slider,
  startCodeServer,
  tick,
  writeSettings,
  type CodeServer,
} from './workbench';

let server: CodeServer;
let ffmpeg: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(600_000); // the first run clones Express
  ffmpeg = findFfmpeg();
  prepareRepo();
  server = await startCodeServer();
});

test.afterAll(() => {
  server?.stop();
});

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) for (const page of context.pages()) await page.close();
});

/**
 * Opens `file` with the slider once and leaves it open, so the recorded scene
 * doesn't wait on the webview loading from a cold cache.
 */
async function prepare(browser: Browser, file: string, line?: number, settings: Record<string, unknown> = {}): Promise<Page> {
  writeSettings(settings);
  await sleep(800); // VS Code picks up the settings file
  const page = await openWorkbench(browser, server);
  await quickOpen(page, file);
  await expect(page.locator('.tab.active')).toContainText(path.basename(file));
  if (line) await goToLine(page, line);
  await hideSideBar(page);
  await page.keyboard.press('Control+Alt+H');
  await slider(page);
  return page;
}

/** Records `scene` into media/demo/<name>.gif. */
async function record(page: Page, name: string, scene: () => Promise<void>): Promise<void> {
  const rec = new Recorder(page, path.join(ROOT, '.demos', 'frames', name));
  await rec.start();
  await scene();
  await rec.stop();
  const out = path.join(ROOT, 'media', 'demo', `${name}.gif`);
  const bytes = rec.gif(out, ffmpeg);
  console.log(`${path.relative(ROOT, out)}: ${(bytes / 1e6).toFixed(2)} MB`);
}

test('scrub-history', async ({ browser }) => {
  // The hero: open the slider on lib/response.js and drag back through its history.
  const page = await prepare(browser, 'lib/response.js', 126);
  await page.keyboard.press('Control+W'); // back to the file, ready for the shortcut
  await page.locator('.editor-instance .monaco-editor').first().click();
  await goToLine(page, 126);
  const pointer = new Pointer(page);
  await pointer.show();
  await sleep(800);

  await record(page, 'scrub-history', async () => {
    await sleep(900);
    await showKeys(page, 'Ctrl + Alt + H');
    await page.keyboard.press('Control+Alt+H');
    const f = await slider(page);
    await sleep(1000);

    const k = await knob(f, 'old');
    await pointer.move(k.x, k.y, 900);
    await sleep(500);
    await pointer.drag(await tick(f, 12), 2600, [{ ...(await tick(f, 34)), duration: 1800, wait: 900 }]);
    await sleep(2200);
    // Past the oldest loaded commit: the next 50 load.
    const first = await tick(f, 0);
    await pointer.drag({ x: first.x - 30, y: first.y }, 1500);
    await expect(f.locator('.file-count')).toContainText('100 commits', { timeout: 20_000 });
    await pointer.move(first.x + 300, first.y + 300, 900);
    await page.keyboard.press('Escape');
    await sleep(1800);
  });
});

test('follow-renames', async ({ browser }) => {
  // examples/error-pages/index.js began as examples/pages/app.js; both renames changed nothing else.
  const page = await prepare(browser, 'examples/error-pages/index.js');
  const f = await slider(page);
  const count = f.locator('.file-count');
  await expect(count).toHaveText('48 commits loaded (2 hidden)');
  const pointer = new Pointer(page);
  await pointer.show();
  await sleep(800);

  await record(page, 'follow-renames', async () => {
    await sleep(1200);
    // Back to where the file began, loading the last commit on the way.
    const k = await knob(f, 'old');
    await pointer.move(k.x, k.y, 800);
    await sleep(300);
    const first = await tick(f, 0);
    await pointer.drag({ x: first.x - 30, y: first.y }, 3000, [{ ...(await tick(f, 24)), duration: 1500, wait: 600 }]);
    await expect(count).toHaveText('49 commits (2 hidden)', { timeout: 20_000 });
    await pointer.move(first.x + 200, first.y + 260, 700);
    await sleep(700);
    await showKeys(page, 'Home', 800);
    await page.keyboard.press('Home');
    await expect(f.locator('.side.old')).toContainText('Added custom pages example');
    await sleep(2000);

    // Unchecking "Content changes only" brings back the two commits that only renamed the file.
    const box = await center(f.locator('label.check'));
    const checkbox = { x: box.x - 50, y: box.y };
    await pointer.click(checkbox, 900);
    await expect(count).toHaveText('51 commits');
    await sleep(800);
    for (const i of [16, 26]) {
      const rename = await tick(f, i);
      await pointer.move(rename.x, rename.y, 900);
      await expect(f.locator('.card')).toContainText('renamed from');
      await sleep(2200);
    }
    await pointer.click(checkbox, 1000);
    await expect(count).toHaveText('49 commits (2 hidden)');
    await pointer.move(box.x - 200, box.y + 300, 700);
    await sleep(1500);
  });
});

test('step-through-commits', async ({ browser }) => {
  // Double-click a commit for just its change, then [ and ] to step, N to jump to the change.
  const page = await prepare(browser, 'lib/response.js', 126);
  const f = await slider(page);
  const pointer = new Pointer(page);
  await pointer.show();
  await sleep(800);

  await record(page, 'step-through-commits', async () => {
    await sleep(700);
    const commit = await tick(f, 44);
    await pointer.dblclick(commit, 1100);
    await expect(f.locator('.stats')).toContainText(/\d+ changes?/);
    await sleep(600);
    await pointer.move(commit.x - 120, commit.y + 330, 700);
    await sleep(1400);
    const step = async (key: string) => {
      await showKeys(page, key, 600);
      await page.keyboard.press(key);
      await sleep(550);
      await showKeys(page, 'N', 600);
      await page.keyboard.press('n');
      await sleep(1500);
    };
    for (let i = 0; i < 4; i++) await step('[');
    for (let i = 0; i < 2; i++) await step(']');
    await sleep(600);
  });
});

test('live-working-copy', async ({ browser }) => {
  // Typing in the file beside the slider; inline, since the panel is half as wide.
  const page = await prepare(browser, 'lib/response.js', 127, { 'diffSlider.renderSideBySide': false });
  const f = await slider(page);
  await quickOpen(page, 'lib/response.js', 'Control+Enter');
  await expect(page.locator('.editor-group-container')).toHaveCount(2);
  await goToLine(page, 128); // `var encoding;`
  await page.keyboard.press('End');
  const pointer = new Pointer(page);
  await pointer.show();
  await sleep(1000);

  try {
    await record(page, 'live-working-copy', async () => {
      await sleep(800);
      const cursor = await center(page.locator('.editor-group-container.active .monaco-editor .cursor').first());
      await pointer.click({ x: cursor.x + 2, y: cursor.y }, 900);
      await page.keyboard.press('End');
      await sleep(300);
      await page.keyboard.press('Enter');
      await page.keyboard.type("var etag = this.get('ETag');", { delay: 70 });
      await sleep(900);
      await page.keyboard.press('Enter');
      await page.keyboard.type('// TODO: skip the body for HEAD requests', { delay: 55 });
      await expect(f.locator('.side.new')).toContainText('unsaved changes');
      await expect(f.locator('.editor.modified')).toContainText('skip the body for HEAD requests');
      await pointer.move(cursor.x - 250, cursor.y + 200, 900);
      await sleep(2200);
    });
  } finally {
    // Leave no unsaved edit for VS Code to restore in the next window.
    await command(page, 'File: Revert File').catch(() => undefined);
    resetRepo();
  }
});
