/** Pure layout and selection logic for the timeline slider. No DOM access. */
import type { Stop } from '../src/shared/protocol';

export interface LayoutOptions {
  minSpacing: number;
  padLeft: number;
  padRight: number;
}

export interface Layout {
  count: number;
  contentWidth: number;
  padLeft: number;
  padRight: number;
  spacing: number;
}

/**
 * Spreads `count` stops across the viewport. When they would be closer than
 * `minSpacing`, the content grows wider than the viewport and scrolls.
 */
export function computeLayout(count: number, viewportWidth: number, o: LayoutOptions): Layout {
  const width = Math.max(viewportWidth, o.padLeft + o.padRight + 1);
  if (count <= 1) return { count, contentWidth: width, padLeft: o.padLeft, padRight: o.padRight, spacing: 0 };
  const fit = (width - o.padLeft - o.padRight) / (count - 1);
  const spacing = Math.max(o.minSpacing, fit);
  return {
    count,
    contentWidth: o.padLeft + o.padRight + spacing * (count - 1),
    padLeft: o.padLeft,
    padRight: o.padRight,
    spacing,
  };
}

export function xOf(layout: Layout, index: number): number {
  if (layout.count <= 1) return layout.contentWidth - layout.padRight;
  return layout.padLeft + index * layout.spacing;
}

/** Nearest stop index to a content-relative x coordinate (clamped). */
export function indexAt(layout: Layout, x: number): number {
  if (layout.count <= 1) return 0;
  const i = Math.round((x - layout.padLeft) / layout.spacing);
  return Math.min(layout.count - 1, Math.max(0, i));
}

export interface Ordered {
  oldIndex: number;
  newIndex: number;
  /** Which handle (0 or 1) is currently the left/"old" one. */
  oldHandle: 0 | 1;
}

/** Whichever handle is further left is "old". Ties go to handle 0. */
export function orderSelection(stops: readonly Pick<Stop, 'id'>[], selection: readonly [string, string]): Ordered {
  const a = Math.max(0, stops.findIndex((s) => s.id === selection[0]));
  const b = Math.max(0, stops.findIndex((s) => s.id === selection[1]));
  return a <= b ? { oldIndex: a, newIndex: b, oldHandle: 0 } : { oldIndex: b, newIndex: a, oldHandle: 1 };
}

export function clampIndex(stops: readonly unknown[], index: number): number {
  return Math.min(stops.length - 1, Math.max(0, index));
}

/**
 * Moves both handles by `delta` stops while keeping their distance, stopping
 * at either end. Returns the new selection (unchanged if it cannot move).
 */
export function shiftSelection(
  stops: readonly Pick<Stop, 'id'>[],
  selection: readonly [string, string],
  delta: number,
): [string, string] {
  const a = stops.findIndex((s) => s.id === selection[0]);
  const b = stops.findIndex((s) => s.id === selection[1]);
  if (a < 0 || b < 0) return [selection[0], selection[1]];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const d = Math.max(-lo, Math.min(stops.length - 1 - hi, delta));
  return [stops[a + d].id, stops[b + d].id];
}

export interface Bar {
  /** Height in px, 0 when the stop has no line stats. */
  height: number;
  /** Fraction of the bar that represents added lines (the rest is deleted). */
  addedFraction: number;
  /** Stats are unknown (binary, merge without diff, working copy...). */
  unknown: boolean;
}

/** Log-scaled change-size bars so a 2-line fix is still visible next to a 2000-line rewrite. */
export function barsFor(stops: readonly Stop[], maxHeight: number, minHeight = 3): Bar[] {
  const totals = stops.map((s) => (s.added ?? 0) + (s.deleted ?? 0));
  const max = Math.max(1, ...totals);
  const scale = Math.log1p(max);
  return stops.map((s, i) => {
    if (s.kind !== 'commit') return { height: 0, addedFraction: 0, unknown: true };
    if (s.added === undefined || s.deleted === undefined) {
      return { height: minHeight + 2, addedFraction: 0, unknown: true };
    }
    const total = totals[i];
    const height = total === 0 ? minHeight : minHeight + (maxHeight - minHeight) * (Math.log1p(total) / scale);
    return { height, addedFraction: total === 0 ? 0.5 : s.added / total, unknown: false };
  });
}

export type Granularity = 'day' | 'month' | 'year';

export function granularityFor(stops: readonly Stop[]): Granularity {
  const dates = stops.filter((s) => s.kind === 'commit' && s.authorDate).map((s) => s.authorDate!);
  if (dates.length < 2) return 'day';
  const span = Math.max(...dates) - Math.min(...dates);
  const day = 86_400_000;
  if (span < 45 * day) return 'day';
  if (span < 4 * 365 * day) return 'month';
  return 'year';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodKey(date: Date, g: Granularity): string {
  if (g === 'year') return `${date.getFullYear()}`;
  if (g === 'month') return `${date.getFullYear()}-${date.getMonth()}`;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export interface AxisLabel {
  index: number;
  x: number;
  text: string;
  align: 'start' | 'end';
  kind: 'date' | 'special';
}

/** Rough width of a label in px, used to avoid overlaps. */
export function labelWidth(text: string): number {
  return text.length * 6.2 + 10;
}

/**
 * Chooses date labels for the axis under the slider: one where each
 * day/month/year begins, skipping any that would overlap. The working copy and
 * staged stops get their own labels, which take priority.
 */
export function axisLabels(stops: readonly Stop[], layout: Layout): AxisLabel[] {
  const labels: AxisLabel[] = [];
  const taken: [number, number][] = [];
  const fits = (from: number, to: number) => taken.every(([a, b]) => to <= a - 4 || from >= b + 4);

  for (let i = stops.length - 1; i >= 0; i--) {
    const s = stops[i];
    if (s.kind === 'commit') break;
    const text = s.kind === 'working' ? 'Working copy' : 'Staged';
    const x = xOf(layout, i);
    const w = labelWidth(text);
    const from = s.kind === 'working' ? x - w + 8 : x - w / 2;
    if (fits(from, from + w)) {
      taken.push([from, from + w]);
      labels.push({ index: i, x, text, align: s.kind === 'working' ? 'end' : 'start', kind: 'special' });
    }
  }

  const g = granularityFor(stops);
  let prevKey = '';
  let prevYear = -1;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (s.kind !== 'commit' || !s.authorDate) continue;
    const d = new Date(s.authorDate);
    const key = periodKey(d, g);
    if (key === prevKey) continue;
    prevKey = key;
    let text: string;
    if (g === 'year') text = `${d.getFullYear()}`;
    else if (g === 'month') text = d.getFullYear() !== prevYear ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : MONTHS[d.getMonth()];
    else text = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const x = xOf(layout, i);
    const w = labelWidth(text);
    if (!fits(x - 2, x + w)) continue;
    taken.push([x - 2, x + w]);
    prevYear = d.getFullYear();
    labels.push({ index: i, x, text, align: 'start', kind: 'date' });
  }
  return labels;
}
