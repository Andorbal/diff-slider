// Builds the extension host bundle, the webview bundle (with Monaco), and the Monaco worker.
import { randomBytes } from 'crypto';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const outWebview = 'dist/webview';

// Stamped into both bundles so a panel can tell that it was opened by an extension
// host from a different build (see src/shared/build.ts). Also written to
// dist/build-id.txt for the UI tests' mock host.
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const buildId = `${version}+${randomBytes(4).toString('hex')}`;
const stamp = { __HISTORY_SLIDER_BUILD__: JSON.stringify(buildId) };

/** @type {esbuild.BuildOptions} */
const extension = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  define: stamp,
  logLevel: 'warning',
};

/** @type {esbuild.BuildOptions} */
const webview = {
  entryPoints: { main: 'webview/main.ts' },
  outdir: outWebview,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  loader: { '.ttf': 'file' },
  assetNames: '[name]',
  sourcemap: !production,
  minify: production,
  // Monaco locates its own workers through import.meta.url; we supply them via MonacoEnvironment instead.
  define: { 'import.meta.url': '""', ...stamp },
  logLevel: 'warning',
};

/** @type {esbuild.BuildOptions} */
const worker = {
  entryPoints: { 'editor.worker': 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js' },
  outdir: outWebview,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: production,
  define: { 'import.meta.url': '""' },
  logLevel: 'warning',
};

/**
 * Monaco ships its own "codicon" font. To avoid clashing with it, the icon font
 * used by our UI is renamed: `.codicon-foo` becomes `.hsi-foo`.
 */
function copyIcons() {
  fs.mkdirSync(outWebview, { recursive: true });
  const dir = 'node_modules/@vscode/codicons/dist';
  const css = fs
    .readFileSync(path.join(dir, 'codicon.css'), 'utf8')
    .replace(/font-family:\s*"codicon"/g, 'font-family: "hs-codicon"')
    .replace(/(\d+px\/1) codicon;/g, '$1 "hs-codicon";')
    .replace(/url\("\.\/codicon\.ttf[^"]*"\)/g, 'url("./hs-codicon.ttf")')
    .replace(/\.codicon/g, '.hsi')
    .replace(/codicon-/g, 'hsi-');
  fs.writeFileSync(path.join(outWebview, 'icons.css'), css);
  fs.copyFileSync(path.join(dir, 'codicon.ttf'), path.join(outWebview, 'hs-codicon.ttf'));
}

async function main() {
  if (!watch) fs.rmSync('dist', { recursive: true, force: true });
  copyIcons();
  fs.writeFileSync('dist/build-id.txt', buildId);
  if (watch) {
    const contexts = await Promise.all([extension, webview, worker].map((o) => esbuild.context(o)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('Watching for changes…');
    return;
  }
  await Promise.all([extension, webview, worker].map((o) => esbuild.build(o)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
