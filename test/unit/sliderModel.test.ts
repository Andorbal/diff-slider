import { describe, expect, it } from 'vitest';
import type { Stop } from '../../src/shared/protocol';
import {
  axisLabels,
  barsFor,
  computeLayout,
  granularityFor,
  indexAt,
  labelWidth,
  nearestVisible,
  orderSelection,
  shiftSelection,
  visibleStops,
  xOf,
} from '../../webview/sliderModel';

const DAY = 86_400_000;

function commit(id: string, date: number, added = 1, deleted = 0): Stop {
  return { id, kind: 'commit', sha: id, path: 'f', subject: id, authorDate: date, added, deleted };
}

const working: Stop = { id: '::working', kind: 'working', path: 'f', subject: 'Working copy' };
const staged: Stop = { id: '::staged', kind: 'staged', path: 'f', subject: 'Staged' };

describe('layout', () => {
  const opts = { minSpacing: 10, padLeft: 20, padRight: 30 };

  it('spreads stops across the viewport when they fit', () => {
    const l = computeLayout(11, 1050, opts);
    expect(l.contentWidth).toBe(1050);
    expect(l.spacing).toBe(100);
    expect(xOf(l, 0)).toBe(20);
    expect(xOf(l, 10)).toBe(1020);
  });

  it('grows wider than the viewport instead of squeezing below the minimum spacing', () => {
    const l = computeLayout(201, 500, opts);
    expect(l.spacing).toBe(10);
    expect(l.contentWidth).toBe(20 + 30 + 2000);
  });

  it('puts a single stop at the right end', () => {
    const l = computeLayout(1, 400, opts);
    expect(xOf(l, 0)).toBe(370);
    expect(indexAt(l, 5)).toBe(0);
  });

  it('maps x back to the nearest stop, clamped to the ends', () => {
    const l = computeLayout(11, 1050, opts);
    expect(indexAt(l, 20)).toBe(0);
    expect(indexAt(l, 169)).toBe(1);
    expect(indexAt(l, 171)).toBe(2);
    expect(indexAt(l, -500)).toBe(0);
    expect(indexAt(l, 99999)).toBe(10);
  });
});

describe('selection', () => {
  const stops = [commit('a', 1), commit('b', 2), commit('c', 3), staged, working];

  it('treats whichever handle is further left as old', () => {
    expect(orderSelection(stops, ['b', '::working'])).toEqual({ oldIndex: 1, newIndex: 4, oldHandle: 0 });
    expect(orderSelection(stops, ['::working', 'a'])).toEqual({ oldIndex: 0, newIndex: 4, oldHandle: 1 });
    expect(orderSelection(stops, ['c', 'c'])).toEqual({ oldIndex: 2, newIndex: 2, oldHandle: 0 });
  });

  it('shifts both handles together and stops at either end', () => {
    expect(shiftSelection(stops, ['b', 'c'], -1)).toEqual(['a', 'b']);
    expect(shiftSelection(stops, ['b', 'c'], -5)).toEqual(['a', 'b']);
    expect(shiftSelection(stops, ['c', 'b'], 1)).toEqual(['::staged', 'c']);
    expect(shiftSelection(stops, ['b', '::working'], 1)).toEqual(['b', '::working']);
    expect(shiftSelection(stops, ['zzz', 'b'], 1)).toEqual(['zzz', 'b']);
  });
});

describe('bars', () => {
  it('scales change size logarithmically and splits added/deleted', () => {
    const stops = [commit('small', 1, 1, 1), commit('big', 2, 900, 100), commit('none', 3, 0, 0), working];
    const bars = barsFor(stops, 30, 3);
    expect(bars[1].height).toBeCloseTo(30);
    expect(bars[0].height).toBeGreaterThan(3);
    expect(bars[0].height).toBeLessThan(15);
    expect(bars[1].addedFraction).toBeCloseTo(0.9);
    expect(bars[2]).toMatchObject({ height: 3, unknown: false });
    expect(bars[3]).toMatchObject({ height: 0, unknown: true });
  });

  it('marks commits without line stats (binary) as unknown', () => {
    const bin: Stop = { ...commit('bin', 1), added: undefined, deleted: undefined, binary: true };
    expect(barsFor([bin], 30)[0].unknown).toBe(true);
  });
});

describe('axis labels', () => {
  it('picks a granularity from the time span', () => {
    const t = Date.UTC(2024, 0, 1);
    expect(granularityFor([commit('a', t), commit('b', t + 10 * DAY)])).toBe('day');
    expect(granularityFor([commit('a', t), commit('b', t + 300 * DAY)])).toBe('month');
    expect(granularityFor([commit('a', t), commit('b', t + 6 * 365 * DAY)])).toBe('year');
  });

  it('labels month starts, adds the year when it changes, and never overlaps', () => {
    const t = Date.UTC(2024, 10, 15, 12);
    const stops = [
      commit('a', t),
      commit('b', t + 1 * DAY),
      commit('c', t + 20 * DAY), // December
      commit('d', t + 50 * DAY), // January 2025
      commit('e', t + 90 * DAY), // February
      working,
    ];
    const layout = computeLayout(stops.length, 1200, { minSpacing: 10, padLeft: 20, padRight: 40 });
    const labels = axisLabels(stops, layout);
    expect(labels.map((l) => l.text)).toEqual(['Working copy', 'Nov 2024', 'Dec', 'Jan 2025', 'Feb']);
    // Squeezed into a narrow timeline, some labels are dropped rather than drawn on top of each other.
    const crowded = computeLayout(stops.length, 120, { minSpacing: 10, padLeft: 20, padRight: 40 });
    const few = axisLabels(stops, crowded);
    expect(few.length).toBeLessThan(labels.length);
    const spans = few.map((l) => {
      const w = labelWidth(l.text);
      return l.align === 'end' ? [l.x - w + 8, l.x + 8] : [l.x - 2, l.x + w];
    });
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const [a1, b1] = spans[i];
        const [a2, b2] = spans[j];
        expect(b1 <= a2 || b2 <= a1).toBe(true);
      }
    }
  });

  it('labels the staged stop when there is room', () => {
    const t = Date.UTC(2024, 0, 1);
    const stops = [commit('a', t), staged, working];
    const labels = axisLabels(stops, computeLayout(3, 800, { minSpacing: 10, padLeft: 20, padRight: 40 }));
    expect(labels.map((l) => l.text)).toContain('Staged');
  });
});

describe('hiding commits without a visible change', () => {
  const hidden = (id: string): Stop => ({ ...commit(id, 0, 0, 0), noVisibleChange: true });
  const all = [hidden('h0'), commit('a', 0), hidden('h1'), hidden('h2'), commit('b', 0), hidden('h3'), staged, working];

  it('drops only flagged commits, and only when asked', () => {
    expect(visibleStops(all, true).map((s) => s.id)).toEqual(['a', 'b', '::staged', '::working']);
    expect(visibleStops(all, false)).toEqual(all);
  });

  it('moves a hidden commit to the nearest older visible stop, else the nearest newer one', () => {
    const visible = visibleStops(all, true);
    expect(nearestVisible(all, visible, 'b')).toBe('b');
    expect(nearestVisible(all, visible, 'h2')).toBe('a');
    expect(nearestVisible(all, visible, 'h3')).toBe('b');
    expect(nearestVisible(all, visible, 'h0')).toBe('a');
    expect(nearestVisible(all, visible, 'unknown')).toBeUndefined();
    expect(nearestVisible([hidden('x')], [], 'x')).toBeUndefined();
  });
});
