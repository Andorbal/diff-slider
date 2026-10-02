import { expect, test, type Page } from '@playwright/test';
import { STAGED_ID, WORKING_ID, type Stop, type WebviewMessage } from '../../src/shared/protocol';
import { buildFixture } from './fixture';
import { startHarness, type Scenario } from './harness';

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness();
});

test.afterAll(async () => {
  await harness.close();
});

const fixture = buildFixture();
const stops = fixture.init.stops; // 50 newest commits, staged, working
const LATEST = stops.length - 3;

interface Debug {
  selection(): [string, string];
  ordered(): [string, string];
  original(): string | undefined;
  modified(): string | undefined;
  cursorLine(): number | undefined;
  scrollTop(): number | undefined;
  stopCount(): number;
}

async function open(page: Page, scenario: Scenario = {}): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    const W = window.Worker;
    (window as unknown as { __workers: number }).__workers = 0;
    window.Worker = class extends W {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        (window as unknown as { __workers: number }).__workers++;
      }
    };
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(harness.url(scenario));
  if (!scenario.error) {
    await expect(page.locator('.app')).toHaveClass(/state-(ready|empty)/);
  }
  return problems;
}

async function waitForDiff(page: Page) {
  await expect(page.locator('.stats')).not.toContainText('comparing');
}

const debug = <T,>(page: Page, fn: (d: Debug) => T) =>
  page.evaluate((src) => {
    const d = (window as unknown as { __historySlider: Debug }).__historySlider;
    return new Function('d', `return (${src})(d)`)(d);
  }, fn.toString()) as Promise<T>;

const sent = (page: Page) => page.evaluate(() => (window as unknown as { __sent: WebviewMessage[] }).__sent);

async function tickCenter(page: Page, index: number) {
  const box = (await page.locator('.tl-tick').nth(index).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags a handle's knob to the tick at `index`, moving in small steps like a person would. */
async function drag(page: Page, handle: 'old' | 'new', index: number, opts: { release?: boolean } = {}) {
  const knob = page.locator(`.tl-handle.is-${handle} .tl-handle-knob`);
  const from = (await knob.boundingBox())!;
  const to = await tickCenter(page, index);
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(start.x + ((to.x - start.x) * i) / steps, start.y);
  }
  if (opts.release !== false) await page.mouse.up();
}

test('opens on latest commit ↔ working copy with a rendered diff', async ({ page }) => {
  const problems = await open(page);
  await waitForDiff(page);
  await expect(page.locator('.file-name')).toHaveText('run.ts');
  await expect(page.locator('.file-count')).toHaveText('50 commits loaded');
  await expect(page.locator('.side.old')).toContainText(stops[LATEST].shortSha!);
  await expect(page.locator('.side.new')).toContainText('Working copy');
  await expect(page.locator('.side.new')).toContainText('unsaved changes');
  await expect(page.locator('.tl-tick')).toHaveCount(52);
  await expect(page.locator('.stats')).toContainText('+4');
  await expect(page.locator('.monaco-diff-editor .editor.modified')).toContainText('work in progress');

  expect(await debug(page, (d) => d.original())).toBe(fixture.contents[stops[LATEST].id]);
  expect(await debug(page, (d) => d.modified())).toBe(fixture.contents[WORKING_ID]);
  // The diff ran in a real web worker, and nothing tripped the CSP.
  expect(await page.evaluate(() => (window as unknown as { __workers: number }).__workers)).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});

test('dragging the old handle updates the diff live, with a commit card', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  const target = 30;
  await drag(page, 'old', target, { release: false });

  // Still dragging: the card and the diff already reflect the stop under the handle.
  const card = page.locator('.card');
  await expect(card).toBeVisible();
  await expect(card.locator('.card-subject')).toHaveText(stops[target].subject);
  await expect(card).toContainText(stops[target].authorName!);
  await expect(page.locator('.side.old')).toContainText(stops[target].shortSha!);
  await expect.poll(() => debug(page, (d) => d.original())).toBe(fixture.contents[stops[target].id]);
  // Intermediate stops were requested on the way.
  const requested = (await sent(page)).filter((m) => m.type === 'getContent').map((m) => (m as { stopId: string }).stopId);
  expect(requested).toContain(stops[target + 5].id);

  await page.mouse.up();
  expect(await debug(page, (d) => d.selection())).toEqual([stops[target].id, WORKING_ID]);
  await expect(page.locator('.stats')).toContainText(/\d+ commits/);
  // Commits inside the range are highlighted in the histogram.
  await expect(page.locator('.tl-bar.in')).toHaveCount(LATEST - target);
});

test('handles can cross: whichever is further left is the old side', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  // Drag the working-copy handle all the way past the other one.
  await drag(page, 'new', 20);
  const [h0, h1] = await debug(page, (d) => d.selection());
  expect(h0).toBe(stops[LATEST].id);
  expect(h1).toBe(stops[20].id);
  expect(await debug(page, (d) => d.ordered())).toEqual([stops[20].id, stops[LATEST].id]);
  await expect(page.locator('.tl-handle[data-handle="1"]')).toHaveClass(/is-old/);
  await expect(page.locator('.tl-handle[data-handle="0"]')).toHaveClass(/is-new/);
  await expect(page.locator('.side.old')).toContainText(stops[20].shortSha!);
  await expect(page.locator('.side.new')).toContainText(stops[LATEST].shortSha!);
  await expect.poll(() => debug(page, (d) => d.original())).toBe(fixture.contents[stops[20].id]);
  await expect.poll(() => debug(page, (d) => d.modified())).toBe(fixture.contents[stops[LATEST].id]);
});

test('dragging to the oldest loaded commit loads more history', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  await drag(page, 'old', 0, { release: false });
  await expect(page.locator('.tl-tick')).toHaveCount(102);
  await page.mouse.up();
  expect((await sent(page)).filter((m) => m.type === 'loadMore')).toHaveLength(1);
  await expect(page.locator('.file-count')).toHaveText('100 commits loaded');
  // The handle is on one of the commits that were just loaded (it kept following the pointer).
  const [old] = await debug(page, (d) => d.ordered());
  expect(fixture.pages[0].stops.map((s: Stop) => s.id)).toContain(old);
});

test('Older button loads a page; shift-click loads everything', async ({ page }) => {
  await open(page);
  await page.locator('.tl-more').click();
  await expect(page.locator('.tl-tick')).toHaveCount(102);
  await page.locator('.tl-more').click({ modifiers: ['Shift'] });
  await expect(page.locator('.tl-tick')).toHaveCount(122);
  await expect(page.locator('.tl-more')).toBeHidden();
  await expect(page.locator('.file-count')).toHaveText('120 commits');
  // The boundary between what was loaded before and the new commits is scrolled into view.
  await expect(page.locator('.tl-tick').nth(20)).toBeInViewport();
  await expect(page.locator('.tl-tick').nth(19)).toBeInViewport();
});

test('the card says when a commit renamed the file', async ({ page }) => {
  const problems = await open(page);
  await page.locator('.tl-more').click({ modifiers: ['Shift'] });
  await expect(page.locator('.tl-tick')).toHaveCount(122);
  const tick = page.locator('.tl-tick').nth(30); // the fixture renames src/run.ts here
  await tick.scrollIntoViewIfNeeded();
  const { x, y } = await tickCenter(page, 30);
  await page.mouse.move(x, y);
  const card = page.locator('.card');
  await expect(card).toBeVisible();
  // Visible, not just present: the card's labels once shared a class that hid them.
  await expect(card.getByText('renamed from src/run.ts')).toBeVisible();
  expect(problems).toEqual([]);
});

test('the newest end stays in view when the panel gets narrower or wider', async ({ page }) => {
  const problems = await open(page);
  await waitForDiff(page);
  await expect(page.locator('.tl-tick.working')).toBeInViewport();
  // Like opening the file beside the slider: the timeline no longer fits and scrolls.
  await page.setViewportSize({ width: 560, height: 800 });
  await expect.poll(() => page.locator('.tl-scroll').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(page.locator('.tl-tick.working')).toBeInViewport();
  await expect(page.locator('.tl-handle.is-old .tl-handle-knob')).toBeInViewport();
  // Scrolled somewhere in the middle, a resize keeps that spot the same distance from the right edge.
  await page.locator('.tl-scroll').evaluate((el) => (el.scrollLeft = el.scrollWidth - el.clientWidth - 150));
  const gap = () => page.locator('.tl-scroll').evaluate((el) => Math.round(el.scrollWidth - el.scrollLeft - el.clientWidth));
  await expect.poll(gap).toBe(150);
  await page.setViewportSize({ width: 480, height: 800 });
  await expect.poll(gap).toBe(150);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('.tl-tick.working')).toBeInViewport();
  expect(problems).toEqual([]);
});

test('the Older button stays reachable when the timeline is scrolled to the newest end', async ({ page }) => {
  await open(page);
  await page.locator('.tl-more').click();
  await expect(page.locator('.tl-tick')).toHaveCount(102);
  // Scroll back to the newest end, as after a fresh open; the button must still be on screen.
  await page.locator('.tl-scroll').evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await expect(page.locator('.tl-tick.working')).toBeInViewport();
  await expect(page.locator('.tl-more')).toBeInViewport();
  await page.locator('.tl-more').click({ modifiers: ['Shift'] });
  await expect(page.locator('.tl-tick')).toHaveCount(122);
});

test('keyboard: arrows move the focused handle, Shift/[ ] move both', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  await page.locator('.side.old').click(); // focuses the old handle
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect(await debug(page, (d) => d.selection())).toEqual([stops[LATEST - 2].id, WORKING_ID]);
  await page.keyboard.press('Shift+ArrowLeft');
  expect(await debug(page, (d) => d.selection())).toEqual([stops[LATEST - 3].id, STAGED_ID]);
  await page.keyboard.press(']');
  expect(await debug(page, (d) => d.selection())).toEqual([stops[LATEST - 2].id, WORKING_ID]);
  // Can't step past the newest end.
  await page.keyboard.press(']');
  expect(await debug(page, (d) => d.selection())).toEqual([stops[LATEST - 2].id, WORKING_ID]);
  await page.keyboard.press('r');
  expect(await debug(page, (d) => d.selection())).toEqual([stops[LATEST].id, WORKING_ID]);
  await expect.poll(() => debug(page, (d) => d.original())).toBe(fixture.contents[stops[LATEST].id]);
});

test('double-clicking a commit shows just that commit’s change', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  const { x, y } = await tickCenter(page, 25);
  await page.mouse.dblclick(x, y);
  expect(await debug(page, (d) => d.ordered())).toEqual([stops[24].id, stops[25].id]);
  await expect.poll(() => debug(page, (d) => d.modified())).toBe(fixture.contents[stops[25].id]);
  await waitForDiff(page);
  const added = stops[25].added!;
  await expect(page.locator('.stats')).toContainText(`+${added}`);
});

test('card actions: show change and copy sha', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  const { x, y } = await tickCenter(page, 10);
  await page.mouse.move(x, y);
  const card = page.locator('.card');
  await expect(card).toBeVisible();
  await expect(card.locator('.card-subject')).toHaveText(stops[10].subject);
  // Move into the card (it stays open while hovered) and use its buttons.
  await card.locator('[data-action="copy"]').click();
  expect((await sent(page)).find((m) => m.type === 'copy')).toMatchObject({ text: stops[10].sha });
  await page.mouse.move(x, y + 1);
  await page.mouse.move(x, y);
  await card.locator('[data-action="change"]').click();
  expect(await debug(page, (d) => d.ordered())).toEqual([stops[9].id, stops[10].id]);
});

test('toolbar toggles persist through the host and change the diff', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  await expect(page.locator('.monaco-diff-editor.side-by-side')).toHaveCount(1);
  await page.locator('[data-toggle="renderSideBySide"]').click();
  await expect(page.locator('.monaco-diff-editor.side-by-side')).toHaveCount(0);
  await expect(page.locator('[data-toggle="renderSideBySide"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('body').press('w');
  const options = (await sent(page)).filter((m) => m.type === 'setOption');
  expect(options).toEqual([
    { type: 'setOption', key: 'renderSideBySide', value: false },
    { type: 'setOption', key: 'ignoreTrimWhitespace', value: true },
  ]);
});

test('next/previous change moves through the diff', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  await page.locator('[data-cmd="nextChange"]').click();
  const first = await debug(page, (d) => d.cursorLine());
  await page.locator('[data-cmd="nextChange"]').click();
  const second = await debug(page, (d) => d.cursorLine());
  expect(second).toBeGreaterThan(first!);
  await page.locator('[data-cmd="prevChange"]').click();
  expect(await debug(page, (d) => d.cursorLine())).toBe(first);
});

test('the working copy updates live when the file changes', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  const text = fixture.contents[WORKING_ID] + '\n// typed just now';
  await page.evaluate(
    ({ text, id }) => {
      const host = (window as unknown as { __host: { setContent(id: string, t: string): void; send(m: unknown): void } }).__host;
      host.setContent(id, text);
      host.send({ type: 'workingCopyChanged', stop: { id, kind: 'working', path: 'src/core/run.ts', subject: 'Working copy', dirty: true } });
    },
    { text, id: WORKING_ID },
  );
  await expect.poll(() => debug(page, (d) => d.modified())).toBe(text);
});

test('stats settle after a refresh or save that changes nothing', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  const stats = await page.locator('.stats').textContent();
  // Same payload again (what a refresh with nothing new looks like)...
  await page.evaluate(() => {
    const host = (window as unknown as { __host: { fixture: { init: unknown }; send(m: unknown): void } }).__host;
    host.send({ type: 'init', payload: host.fixture.init });
  });
  await waitForDiff(page);
  await expect(page.locator('.stats')).toHaveText(stats!);
  // ...and a save that leaves the content as it was.
  await page.evaluate((id) => {
    const host = (window as unknown as { __host: { send(m: unknown): void } }).__host;
    host.send({ type: 'workingCopyChanged', stop: { id, kind: 'working', path: 'src/core/run.ts', subject: 'Working copy' } });
  }, WORKING_ID);
  await expect(page.locator('.side.new')).toContainText('on disk');
  await waitForDiff(page);
  await expect(page.locator('.stats')).toHaveText(stats!);
});

test('opening in the VS Code diff editor sends old and new in order', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  await drag(page, 'new', 5);
  await page.locator('[data-cmd="openDiff"]').click();
  expect((await sent(page)).find((m) => m.type === 'openDiff')).toEqual({
    type: 'openDiff',
    oldId: stops[5].id,
    newId: stops[LATEST].id,
  });
});

test('keeps the scroll position when the old side changes', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  await page.locator('.monaco-diff-editor .editor.modified').hover();
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(30);
  }
  await expect.poll(() => debug(page, (d) => d.scrollTop())).toBeGreaterThan(300);
  const before = (await debug(page, (d) => d.scrollTop()))!;
  await page.locator('.side.old').click();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => debug(page, (d) => d.original())).toBe(fixture.contents[stops[LATEST - 1].id]);
  await page.waitForTimeout(300);
  const after = (await debug(page, (d) => d.scrollTop()))!;
  expect(Math.abs(after - before)).toBeLessThan(200);
});

test('binary revisions show a message instead of a diff', async ({ page }) => {
  await open(page, { binary: WORKING_ID });
  await expect(page.locator('.overlay')).toBeVisible();
  await expect(page.locator('.overlay')).toContainText('binary');
});

test('errors are shown with a retry button', async ({ page }) => {
  await open(page, { error: 'demo.txt is not inside a git repository.' });
  await expect(page.locator('.status')).toContainText('not inside a git repository');
  await page.locator('.status button').click();
  expect((await sent(page)).filter((m) => m.type === 'refresh')).toHaveLength(1);
});

test('a file without history explains itself', async ({ page }) => {
  await open(page, { fixture: { commits: 0, staged: false } });
  await expect(page.locator('.app')).toHaveClass(/state-empty/);
  await expect(page.locator('.status')).toContainText('no git history');
});

test('persists the selection in webview state', async ({ page }) => {
  await open(page);
  await waitForDiff(page);
  await drag(page, 'old', 12);
  const state = await page.evaluate(() => (window as unknown as { __host: { state(): unknown } }).__host.state());
  expect(state).toEqual({ resource: fixture.init.resource, selection: [stops[12].id, WORKING_ID] });
});

// The newest page holds commits 70..119; three of them change nothing visible, including the latest.
const HIDDEN = [115, 118, 119];
const hidingFixture = buildFixture({ noVisibleChange: HIDDEN });
const commitAt = (c: number) => hidingFixture.init.stops[c - 70];

test('commits without a visible change are left off the timeline until unchecked', async ({ page }) => {
  const problems = await open(page, { fixture: { noVisibleChange: HIDDEN } });
  await waitForDiff(page);
  const box = page.locator('input[data-option="contentChangesOnly"]');
  await expect(box).toBeChecked();
  await expect(box).toBeEnabled();
  await expect(page.locator('.notice')).toBeHidden();
  await expect(page.locator('.tl-tick')).toHaveCount(52 - HIDDEN.length);
  await expect(page.locator('.file-count')).toHaveText('47 commits loaded (3 hidden)');
  // The host picked the latest commit, which is hidden, so the handle sits on the
  // nearest older visible commit instead. It has the same content.
  expect(await debug(page, (d) => d.selection())).toEqual([commitAt(117).id, WORKING_ID]);
  expect(await debug(page, (d) => d.original())).toBe(hidingFixture.contents[commitAt(119).id]);

  // Unchecking brings them back, and the choice is saved through the host.
  await page.locator('label.check').click();
  await expect(box).not.toBeChecked();
  await expect(page.locator('.tl-tick')).toHaveCount(52);
  await expect(page.locator('.file-count')).toHaveText('50 commits loaded');
  expect((await sent(page)).filter((m) => m.type === 'setOption')).toEqual([
    { type: 'setOption', key: 'contentChangesOnly', value: false },
  ]);

  // A handle on a commit that gets hidden again moves to the nearest older visible one.
  await drag(page, 'old', 118 - 70);
  expect(await debug(page, (d) => d.selection())).toEqual([commitAt(118).id, WORKING_ID]);
  await page.locator('label.check').click();
  await expect(box).toBeChecked();
  await expect(page.locator('.tl-tick')).toHaveCount(52 - HIDDEN.length);
  expect(await debug(page, (d) => d.selection())).toEqual([commitAt(117).id, WORKING_ID]);
  await expect.poll(() => debug(page, (d) => d.original())).toBe(hidingFixture.contents[commitAt(117).id]);

  // Shortcuts keep working while the checkbox has focus.
  await box.focus();
  await page.keyboard.press('[');
  expect(await debug(page, (d) => d.selection())).toEqual([commitAt(116).id, STAGED_ID]);
  expect(problems).toEqual([]);
});

test('says so when there is nothing for the checkbox to hide', async ({ page }) => {
  const problems = await open(page);
  await waitForDiff(page);
  await page.locator('label.check').click();
  await expect(page.locator('input[data-option="contentChangesOnly"]')).not.toBeChecked();
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Nothing to show: every loaded commit changes what the diff shows.');
  await expect(page.locator('.tl-tick')).toHaveCount(52);
  // The choice is still saved.
  expect((await sent(page)).filter((m) => m.type === 'setOption')).toEqual([
    { type: 'setOption', key: 'contentChangesOnly', value: false },
  ]);
  expect(problems).toEqual([]);
});

// Reinstalling the extension over the same version while VS Code runs leaves the old
// extension host running; panels opened afterwards load the new webview. The old host
// has no build stamp and doesn't know (or register) the newer options.
test('a host from an older build: the panel asks for a reload and never sends options that host cannot save', async ({ page }) => {
  const problems = await open(page, { build: null, unknownOptions: ['contentChangesOnly'], fixture: { noVisibleChange: HIDDEN } });
  await waitForDiff(page);
  const notice = page.locator('.notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('History Slider was updated while this window was open.');
  await expect(notice).toContainText('Run Developer: Reload Window');
  // That host can't reload the window for us, so there is no button.
  await expect(notice.locator('button')).toHaveCount(0);

  const box = page.locator('input[data-option="contentChangesOnly"]');
  await expect(box).toBeDisabled();
  await expect(box).toBeChecked();
  await page.locator('label.check').click({ force: true });
  await expect(box).toBeChecked();

  // Options the old host knows still work.
  await page.locator('[data-toggle="wordWrap"]').click();
  await expect(page.locator('[data-toggle="wordWrap"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await sent(page)).filter((m) => m.type === 'setOption')).toEqual([{ type: 'setOption', key: 'wordWrap', value: true }]);
  await expect(page.locator('.toast')).toBeHidden();
  expect(problems).toEqual([]);
});

test('a host from another build that knows how: the notice reloads the window', async ({ page }) => {
  const problems = await open(page, { build: '0.2.0+0123abcd' });
  await waitForDiff(page);
  const notice = page.locator('.notice');
  await expect(notice).toBeVisible();
  await expect(page.locator('input[data-option="contentChangesOnly"]')).toBeEnabled();
  await notice.getByRole('button', { name: 'Reload Window' }).click();
  expect((await sent(page)).filter((m) => m.type === 'reloadWindow')).toEqual([{ type: 'reloadWindow' }]);
  expect(problems).toEqual([]);
});

test('the filter follows the setting when it changes in VS Code', async ({ page }) => {
  await open(page, { fixture: { noVisibleChange: HIDDEN } });
  await expect(page.locator('.tl-tick')).toHaveCount(52 - HIDDEN.length);
  await page.evaluate(() => {
    const host = (window as unknown as { __host: { fixture: { init: { options: object } }; send(m: unknown): void } }).__host;
    host.send({ type: 'options', options: { ...host.fixture.init.options, contentChangesOnly: false } });
  });
  await expect(page.locator('.tl-tick')).toHaveCount(52);
  await expect(page.locator('input[data-option="contentChangesOnly"]')).not.toBeChecked();
  // The host already knows; nothing is sent back.
  expect((await sent(page)).filter((m) => m.type === 'setOption')).toEqual([]);
});
