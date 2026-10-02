/**
 * The setting for the README recordings: a pinned clone of Express, and a
 * code-server of our own with the extension linked from this checkout and a
 * fixed set of user settings.
 */
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { expect, type Browser, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { sleep, type Point } from './recorder';

export const ROOT = path.resolve(__dirname, '../..');
const WORK = path.join(ROOT, '.demos');

/**
 * Express (MIT License): long histories, merged branches, and files renamed
 * along the way. Pinned so the timelines, and the counts the scenes check,
 * stay the same.
 */
const EXPRESS_URL = 'https://github.com/expressjs/express.git';
const EXPRESS_COMMIT = '7ef98448f8b38099ab1ded55e458538ad47a51e7';
export const REPO = path.join(WORK, 'express');

export const VIEWPORT = { width: 1120, height: 700 };

const SETTINGS: Record<string, unknown> = {
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.welcomePage.walkthroughs.openOnInstall': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.layoutControl.enabled': false,
  'window.commandCenter': false,
  'chat.disableAIFeatures': true,
  'chat.commandCenter.enabled': false,
  'telemetry.telemetryLevel': 'off',
  'security.workspace.trust.enabled': false,
  'extensions.ignoreRecommendations': true,
  'update.mode': 'none',
  'files.autoSave': 'off',
  'git.autofetch': false,
  'git.openRepositoryInParentFolders': 'always',
  'editor.minimap.enabled': false,
  'editor.stickyScroll.enabled': false,
  'editor.lightbulb.enabled': 'off',
  'breadcrumbs.enabled': false,
  'typescript.disableAutomaticTypeAcquisition': true,
};

const userData = path.join(WORK, 'vscode', 'user-data');

/** Replaces the user settings: the defaults above plus `extra` (History Slider settings for a scene). */
export function writeSettings(extra: Record<string, unknown> = {}): void {
  const dir = path.join(userData, 'User');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...SETTINGS, ...extra }, null, 2));
}

const git = (args: string[], cwd = REPO) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

/** Clones Express on the first run, then puts its working tree back to the pinned commit. */
export function prepareRepo(): void {
  if (!fs.existsSync(path.join(REPO, '.git'))) {
    fs.mkdirSync(WORK, { recursive: true });
    execFileSync('git', ['clone', '--quiet', EXPRESS_URL, REPO], { stdio: 'inherit' });
  }
  try {
    git(['cat-file', '-e', `${EXPRESS_COMMIT}^{commit}`]);
  } catch {
    git(['fetch', '--quiet', 'origin']);
  }
  // A "master" branch, as in the Express repository, for the status bar.
  git(['checkout', '--quiet', '--force', '-B', 'master', EXPRESS_COMMIT]);
  git(['clean', '--quiet', '-fd']);
}

export function resetRepo(): void {
  git(['checkout', '--quiet', '--force', '--', '.']);
}

/** Checks that ffmpeg can make GIFs, and returns how to run it. */
export function findFfmpeg(): string {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  let filters = '';
  try {
    filters = execFileSync(ffmpeg, ['-hide_banner', '-filters'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    throw new Error(`Could not run ${ffmpeg}. Install ffmpeg, or set FFMPEG to its path.`);
  }
  if (!/\bpalettegen\b/.test(filters)) throw new Error(`${ffmpeg} has no palettegen filter, which the GIFs need.`);
  return ffmpeg;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export interface CodeServer {
  url: string;
  stop(): void;
}

/**
 * Starts code-server ($CODE_SERVER) with a fresh profile and this checkout as
 * its only extension. Run `npm run build` first.
 */
export async function startCodeServer(): Promise<CodeServer> {
  const bin = process.env.CODE_SERVER;
  if (!bin) throw new Error('Set CODE_SERVER to a code-server executable; see "Recording the README animations" in CONTRIBUTING.md.');
  if (!fs.existsSync(path.join(ROOT, 'dist', 'extension.js'))) throw new Error('Build the extension first (npm run build).');

  // A fresh profile every run, so no editors, backups or settings carry over.
  fs.rmSync(path.join(WORK, 'vscode'), { recursive: true, force: true });
  const extensions = path.join(WORK, 'vscode', 'extensions');
  fs.mkdirSync(extensions, { recursive: true });
  const { publisher, name, version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.symlinkSync(ROOT, path.join(extensions, `${publisher}.${name}-${version}`), 'dir');
  writeSettings();

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const log = fs.openSync(path.join(WORK, 'code-server.log'), 'w');
  // Its own process group, so stopping it also stops the processes it starts.
  const proc: ChildProcess = spawn(
    bin,
    ['--auth', 'none', '--bind-addr', `127.0.0.1:${port}`, '--extensions-dir', extensions, '--user-data-dir', userData, '--disable-workspace-trust', '--disable-telemetry'],
    { detached: true, stdio: ['ignore', log, log] },
  );
  const stop = () => {
    try {
      process.kill(-proc.pid!, 'SIGTERM');
    } catch {
      proc.kill();
    }
  };
  for (let i = 0; ; i++) {
    if (proc.exitCode !== null) throw new Error(`code-server exited (${proc.exitCode}); see .demos/code-server.log`);
    try {
      if ((await fetch(`${url}/healthz`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (i > 120) {
      stop();
      throw new Error('code-server did not start within a minute; see .demos/code-server.log');
    }
    await sleep(500);
  }
  return { url, stop };
}

// ---- driving VS Code ----

/** Opens the Express folder with no editors or notifications showing. */
export async function openWorkbench(browser: Browser, server: CodeServer): Promise<Page> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(`${server.url}/?folder=${encodeURIComponent(REPO)}`);
  await page.locator('.monaco-workbench').waitFor({ timeout: 60_000 });
  // The git extension has found the repository.
  await expect(page.locator('.statusbar')).toContainText('master', { timeout: 30_000 });
  await sleep(1500);
  await command(page, 'View: Close All Editors');
  await command(page, 'Notifications: Clear All Notifications');
  return page;
}

/** Types into the quick input, waits for an entry matching `expected`, and accepts it with `key`. */
async function pick(page: Page, open: string, text: string, expected: RegExp, key = 'Enter'): Promise<void> {
  await page.keyboard.press(open);
  await page.keyboard.type(text);
  const rows = page.locator('.quick-input-list .monaco-list-row');
  const labels = () => rows.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  // File search can take a while to start, and recently opened editors (such as
  // the "History:" panel of the same file) can be listed above the file.
  await expect.poll(async () => (await labels()).some((l) => expected.test(l)), { timeout: 20_000 }).toBe(true);
  const focused = rows.and(page.locator('.focused'));
  for (let i = 0; i < 10 && !expected.test((await focused.getAttribute('aria-label')) ?? ''); i++) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(focused).toHaveAttribute('aria-label', expected);
  await page.keyboard.press(key);
  await expect(page.locator('.quick-input-widget')).toBeHidden();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const command = (page: Page, name: string) => pick(page, 'F1', name, new RegExp(`^${escape(name)}`));

/** Opens a file by its path in the repository; `Control+Enter` opens it beside the active editor. */
export const quickOpen = (page: Page, file: string, key = 'Enter') =>
  pick(page, 'Control+P', file, new RegExp(`^${escape(path.basename(file))} ${escape(path.dirname(file))}\\b`), key);

export async function goToLine(page: Page, line: number): Promise<void> {
  await page.keyboard.press('Control+G');
  await page.keyboard.type(String(line));
  await page.keyboard.press('Enter');
}

export async function hideSideBar(page: Page): Promise<void> {
  if (await page.locator('.part.sidebar').isVisible()) await command(page, 'View: Toggle Primary Side Bar Visibility');
}

/** The visible History Slider panel, once it has loaded and compared. */
export async function slider(page: Page): Promise<FrameLocator> {
  const outer = page.locator('iframe.webview.ready').filter({ visible: true });
  await expect(outer).toHaveCount(1, { timeout: 30_000 });
  const f = outer.contentFrame().frameLocator('#active-frame');
  await expect(f.locator('.app')).toHaveClass(/state-ready/, { timeout: 60_000 });
  await expect(f.locator('.stats')).not.toContainText('comparing', { timeout: 30_000 });
  return f;
}

export async function center(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${locator} is not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export const tick = (f: FrameLocator, index: number) => center(f.locator('.tl-tick').nth(index));
export const knob = (f: FrameLocator, handle: 'old' | 'new') => center(f.locator(`.tl-handle.is-${handle} .tl-handle-knob`));
