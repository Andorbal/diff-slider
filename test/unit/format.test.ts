import { describe, expect, it } from 'vitest';
import { escapeHtml, formatRefs, relativeTime } from '../../webview/format';

const DAY = 86_400_000;

describe('format', () => {
  it('describes ages without overstating them', () => {
    const now = Date.UTC(2026, 8, 29);
    expect(relativeTime(now - 30_000, now)).toBe('just now');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 hours ago');
    expect(relativeTime(now - 1.9 * DAY, now)).toBe('yesterday');
    expect(relativeTime(now - 540 * DAY, now)).toBe('last year');
    expect(relativeTime(now - 800 * DAY, now)).toBe('2 years ago');
  });

  it('escapes html', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('puts tags first and trims HEAD pointers', () => {
    expect(formatRefs(['HEAD -> main', 'origin/main', 'tag: v1.2.0'])).toEqual([
      { text: 'v1.2.0', tag: true },
      { text: 'main', tag: false },
      { text: 'origin/main', tag: false },
    ]);
    expect(formatRefs(undefined)).toEqual([]);
  });
});
