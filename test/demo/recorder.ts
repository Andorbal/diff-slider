/**
 * Records a page as an animated GIF: Chromium's screencast saves a frame each
 * time the page repaints, and ffmpeg turns the frames into a GIF that shows
 * each one for as long as it was on screen.
 *
 * Headless Chromium draws no mouse pointer or keystrokes, so `Pointer` and
 * `showKeys` draw them on top of the page.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { CDPSession, Page } from '@playwright/test';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export interface Point {
  x: number;
  y: number;
}

export interface GifOptions {
  /** Seconds to hold the last frame. */
  hold?: number;
  fps?: number;
}

export class Recorder {
  private cdp?: CDPSession;
  private frames: { file: string; t: number }[] = [];
  private end = 0;

  constructor(
    private readonly page: Page,
    private readonly framesDir: string,
  ) {}

  async start(): Promise<void> {
    fs.rmSync(this.framesDir, { recursive: true, force: true });
    fs.mkdirSync(this.framesDir, { recursive: true });
    this.frames = [];
    const size = this.page.viewportSize()!;
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = path.join(this.framesDir, `f${String(this.frames.length).padStart(5, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      this.frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
      this.cdp?.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
    });
    await this.cdp.send('Page.startScreencast', { format: 'png', maxWidth: size.width, maxHeight: size.height });
  }

  async stop(): Promise<void> {
    this.end = Date.now() / 1000;
    await this.cdp?.send('Page.stopScreencast');
    await sleep(200);
    await this.cdp?.detach();
  }

  /** Writes the GIF and returns its size in bytes. */
  gif(out: string, ffmpeg: string, { hold = 0.5, fps = 15 }: GifOptions = {}): number {
    if (!this.frames.length) throw new Error('No frames were recorded');
    // ffconcat: every frame stays up until the next one arrived.
    const lines = ['ffconcat version 1.0'];
    this.frames.forEach((f, i) => {
      const next = i + 1 < this.frames.length ? this.frames[i + 1].t : this.end + hold;
      lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
    });
    lines.push(`file '${this.frames[this.frames.length - 1].file}'`);
    const list = path.join(this.framesDir, 'frames.ffconcat');
    fs.writeFileSync(list, lines.join('\n') + '\n');
    // One palette for the whole clip, built from what changes between frames.
    const filter = `fps=${fps},split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-filter_complex', filter, '-loop', '0', out]);
    return fs.statSync(out).size;
  }
}

/** The overlay elements, added to the top-level page so they draw above VS Code's webview iframes. */
async function installOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('demo-cursor')) return;
    const fixed = (el: HTMLElement, style: Partial<CSSStyleDeclaration>) => {
      Object.assign(el.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', zIndex: '2147483647' }, style);
      return el;
    };
    const cursor = fixed(document.createElement('div'), {
      transform: 'translate(-100px, -100px)',
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))',
    });
    cursor.id = 'demo-cursor';
    cursor.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2 L3 19.5 L7.6 15.4 L10.7 22.3 L13.8 21 L10.8 14.2 L16.8 14.2 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    // Shown while the button is down.
    const ring = fixed(document.createElement('div'), {
      width: '28px',
      height: '28px',
      margin: '-14px 0 0 -14px',
      borderRadius: '50%',
      background: 'rgba(255, 214, 10, 0.45)',
      border: '2px solid rgba(255, 214, 10, 0.9)',
      zIndex: '2147483646',
      opacity: '0',
      transition: 'opacity 120ms',
    });
    ring.id = 'demo-ring';
    const keys = fixed(document.createElement('div'), {
      left: '50%',
      top: 'auto',
      bottom: '44px',
      transform: 'translateX(-50%)',
      padding: '8px 16px',
      borderRadius: '8px',
      background: 'rgba(20, 20, 20, 0.92)',
      border: '1px solid rgba(255,255,255,0.25)',
      color: '#fff',
      font: '600 20px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif',
      letterSpacing: '0.5px',
      opacity: '0',
      transition: 'opacity 150ms',
      boxShadow: '0 4px 14px rgba(0,0,0,.5)',
    });
    keys.id = 'demo-keys';
    document.body.append(ring, cursor, keys);
  });
}

/** Shows `text` (a key or shortcut) in a badge at the bottom of the page for `ms`. */
export async function showKeys(page: Page, text: string, ms = 1100): Promise<void> {
  await page.evaluate(
    ([text, ms]) => {
      const k = document.getElementById('demo-keys')!;
      const w = window as unknown as { __demoKeysTimer?: ReturnType<typeof setTimeout> };
      k.textContent = text;
      k.style.opacity = '1';
      clearTimeout(w.__demoKeysTimer);
      w.__demoKeysTimer = setTimeout(() => (k.style.opacity = '0'), ms);
    },
    [text, ms] as const,
  );
}

export interface DragStop extends Point {
  /** Milliseconds to get here. */
  duration?: number;
  /** Milliseconds to stay here before moving on. */
  wait?: number;
}

/** Moves the real mouse in small eased steps, like a person, and draws a pointer where it is. */
export class Pointer {
  private x: number;
  private y: number;
  private down = false;

  constructor(private readonly page: Page) {
    const size = page.viewportSize()!;
    this.x = size.width * 0.62;
    this.y = size.height * 0.62;
  }

  async show(): Promise<void> {
    await installOverlay(this.page);
    await this.place(this.x, this.y);
  }

  private async place(x: number, y: number): Promise<void> {
    this.x = x;
    this.y = y;
    await this.page.mouse.move(x, y);
    await this.page.evaluate(
      ([x, y, down]) => {
        // The arrow's tip is at (3, 2) in its SVG.
        document.getElementById('demo-cursor')!.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
        const ring = document.getElementById('demo-ring')!;
        ring.style.transform = `translate(${x}px, ${y}px)`;
        ring.style.opacity = down ? '1' : '0';
      },
      [x, y, this.down] as const,
    );
  }

  async move(x: number, y: number, duration = 600): Promise<void> {
    const from = { x: this.x, y: this.y };
    const start = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / duration);
      const e = ease(t);
      await this.place(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      if (t >= 1) break;
      await sleep(12);
    }
  }

  private async press(): Promise<void> {
    this.down = true;
    await this.place(this.x, this.y);
    await this.page.mouse.down();
  }

  private async release(): Promise<void> {
    await this.page.mouse.up();
    this.down = false;
    await this.place(this.x, this.y);
  }

  async click(to: Point, duration = 600): Promise<void> {
    await this.move(to.x, to.y, duration);
    await sleep(120);
    await this.press();
    await sleep(90);
    await this.release();
  }

  async dblclick(to: Point, duration = 600): Promise<void> {
    await this.move(to.x, to.y, duration);
    await sleep(150);
    this.down = true;
    await this.place(to.x, to.y);
    await this.page.mouse.dblclick(to.x, to.y);
    await sleep(120);
    this.down = false;
    await this.place(to.x, to.y);
  }

  /** Presses where the pointer is, moves through `pauses` to `to`, and lets go. */
  async drag(to: Point, duration: number, pauses: DragStop[] = []): Promise<void> {
    await this.press();
    await sleep(150);
    for (const stop of [...pauses, to as DragStop]) {
      await this.move(stop.x, stop.y, stop.duration ?? duration);
      if (stop.wait) await sleep(stop.wait);
    }
    await sleep(150);
    await this.release();
  }
}
