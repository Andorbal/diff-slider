import type * as Monaco from 'monaco-editor/editor/editor.api';

/** Monaco color ids we copy from the VS Code theme (exposed to webviews as --vscode-* CSS variables). */
const COLOR_IDS = [
  'editor.background',
  'editor.foreground',
  'editorLineNumber.foreground',
  'editorLineNumber.activeForeground',
  'editor.selectionBackground',
  'editor.inactiveSelectionBackground',
  'editor.selectionHighlightBackground',
  'editor.lineHighlightBackground',
  'editor.lineHighlightBorder',
  'editor.findMatchBackground',
  'editor.findMatchHighlightBackground',
  'editorCursor.foreground',
  'editorWhitespace.foreground',
  'editorIndentGuide.background1',
  'editorIndentGuide.activeBackground1',
  'editorGutter.background',
  'editorOverviewRuler.border',
  'editorLink.activeForeground',
  'diffEditor.insertedTextBackground',
  'diffEditor.insertedTextBorder',
  'diffEditor.removedTextBackground',
  'diffEditor.removedTextBorder',
  'diffEditor.insertedLineBackground',
  'diffEditor.removedLineBackground',
  'diffEditor.border',
  'diffEditor.diagonalFill',
  'diffEditor.unchangedRegionBackground',
  'diffEditor.unchangedRegionForeground',
  'diffEditor.unchangedRegionShadow',
  'diffEditor.unchangedCodeBackground',
  'diffEditor.move.border',
  'diffEditor.moveActive.border',
  'diffEditorGutter.insertedLineBackground',
  'diffEditorGutter.removedLineBackground',
  'diffEditorOverview.insertedForeground',
  'diffEditorOverview.removedForeground',
  'scrollbar.shadow',
  'scrollbarSlider.background',
  'scrollbarSlider.hoverBackground',
  'scrollbarSlider.activeBackground',
  'editorWidget.background',
  'editorWidget.foreground',
  'editorWidget.border',
  'editorHoverWidget.background',
  'editorHoverWidget.foreground',
  'editorHoverWidget.border',
  'editorStickyScroll.background',
  'input.background',
  'input.foreground',
  'input.border',
  'inputOption.activeBorder',
  'inputOption.activeBackground',
  'focusBorder',
  'list.hoverBackground',
  'list.activeSelectionBackground',
  'list.activeSelectionForeground',
  'menu.background',
  'menu.foreground',
  'menu.selectionBackground',
  'menu.selectionForeground',
  'menu.separatorBackground',
  'widget.shadow',
];

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let ctx: CanvasRenderingContext2D | null | undefined;

/** Normalizes any CSS color to #rrggbb or #rrggbbaa, which is all Monaco accepts. */
export function toHex(color: string): string | undefined {
  if (!color) return undefined;
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
    if (color.length === 4 || color.length === 5) {
      return '#' + [...color.slice(1)].map((c) => c + c).join('');
    }
    return color;
  }
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#00000000';
  ctx.fillStyle = color;
  const v = String(ctx.fillStyle);
  if (v.startsWith('#')) return v;
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (!m) return undefined;
  const [r, g, b, a = '1'] = m[1].split(',').map((p) => p.trim());
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  const alpha = Number(a);
  return `#${hex(+r)}${hex(+g)}${hex(+b)}${alpha < 1 ? hex(alpha * 255) : ''}`;
}

export function baseTheme(): Monaco.editor.BuiltinTheme {
  const c = document.body.classList;
  if (c.contains('vscode-high-contrast-light')) return 'hc-light';
  if (c.contains('vscode-high-contrast')) return 'hc-black';
  if (c.contains('vscode-light')) return 'vs';
  return 'vs-dark';
}

/** Defines and activates a Monaco theme that mirrors the current VS Code theme. */
export function applyTheme(monaco: typeof Monaco): void {
  const colors: Record<string, string> = {};
  for (const id of COLOR_IDS) {
    const hex = toHex(cssVar(`--vscode-${id.replace(/\./g, '-')}`));
    if (hex) colors[id] = hex;
  }
  monaco.editor.defineTheme('history-slider', { base: baseTheme(), inherit: true, rules: [], colors });
  monaco.editor.setTheme('history-slider');
}

export interface EditorFont {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
}

export function editorFont(): EditorFont {
  const size = parseFloat(cssVar('--vscode-editor-font-size'));
  return {
    fontFamily: cssVar('--vscode-editor-font-family') || undefined,
    fontSize: Number.isFinite(size) && size > 0 ? size : undefined,
    fontWeight: cssVar('--vscode-editor-font-weight') || undefined,
  };
}

/** Calls `listener` when VS Code switches theme (it rewrites body classes and CSS variables). */
export function onThemeChange(listener: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(listener, 50);
  };
  new MutationObserver(fire).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(fire).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
}
