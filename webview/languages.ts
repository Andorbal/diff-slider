import type * as Monaco from 'monaco-editor/editor/editor.api';

/** VS Code language ids that Monaco knows under a different name (or can approximate). */
const ALIASES: Record<string, string> = {
  typescriptreact: 'typescript',
  javascriptreact: 'javascript',
  json: 'javascript',
  jsonc: 'javascript',
  jsonl: 'javascript',
  json5: 'javascript',
  shellscript: 'shell',
  c: 'cpp',
  'cuda-cpp': 'cpp',
  'objective-cpp': 'objective-c',
  coffeescript: 'coffee',
  terraform: 'hcl',
  properties: 'ini',
  toml: 'ini',
  dotenv: 'ini',
  vue: 'html',
  svelte: 'html',
  astro: 'html',
  erb: 'html',
  jade: 'pug',
  dockercompose: 'yaml',
  'github-actions-workflow': 'yaml',
  jinja: 'twig',
  'git-commit': 'plaintext',
};

const EXTENSION_FALLBACK: Record<string, string> = {
  '.json': 'javascript',
  '.jsonc': 'javascript',
  '.json5': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.vue': 'html',
  '.svelte': 'html',
  '.toml': 'ini',
  '.env': 'ini',
  '.tf': 'hcl',
  '.h': 'cpp',
  '.c': 'cpp',
};

/** Picks the Monaco language for a file, preferring VS Code's language id. */
export function resolveLanguage(monaco: typeof Monaco, vscodeLanguageId: string, fileName: string): string {
  const known = new Set(monaco.languages.getLanguages().map((l) => l.id));
  const candidates = [vscodeLanguageId, ALIASES[vscodeLanguageId]].filter(Boolean);
  for (const id of candidates) if (known.has(id)) return id;

  const lower = fileName.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
  if (EXTENSION_FALLBACK[ext] && known.has(EXTENSION_FALLBACK[ext])) return EXTENSION_FALLBACK[ext];
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.filenames?.some((f) => f.toLowerCase() === lower)) return lang.id;
    if (ext && lang.extensions?.some((e) => e.toLowerCase() === ext)) return lang.id;
  }
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile';
  return 'plaintext';
}
