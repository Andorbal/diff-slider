import type { Stop } from '../src/shared/protocol';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relativeTime(ms: number, now = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000);
  for (const [unit, size] of UNITS) {
    // Truncate rather than round, so 18 months reads "last year", not "2 years ago".
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return 'just now';
}

const absolute = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function absoluteTime(ms: number): string {
  return absolute.format(new Date(ms));
}

/** Short identifier shown for a stop: abbreviated sha, "Staged", or "Working copy". */
export function stopLabel(stop: Stop): string {
  if (stop.kind === 'working') return 'Working copy';
  if (stop.kind === 'staged') return 'Staged';
  return stop.shortSha ?? stop.id.slice(0, 7);
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

/** Tags first, then branches; HEAD pointers are shortened. */
export function formatRefs(refs: readonly string[] | undefined): { text: string; tag: boolean }[] {
  if (!refs) return [];
  return refs
    .map((r) => {
      if (r.startsWith('tag: ')) return { text: r.slice(5), tag: true };
      if (r.startsWith('HEAD -> ')) return { text: r.slice(8), tag: false };
      return { text: r, tag: false };
    })
    .sort((a, b) => Number(b.tag) - Number(a.tag));
}
