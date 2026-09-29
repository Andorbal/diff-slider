# Contributing

## Layout

| Path | What lives there |
| --- | --- |
| `src/extension.ts` | Activation, the `diffSlider.showHistory` command, working out which file (and commit) it was invoked on |
| `src/historyPanel.ts` | One webview panel per file: loads history, serves file contents, watches the file and repository |
| `src/fileHistory.ts`, `src/git.ts` | Git access (`git log --follow`, a long-lived `git cat-file --batch`). No `vscode` imports, so they are tested against real repositories |
| `src/shared/protocol.ts` | Messages between the extension and the webview |
| `webview/` | The panel UI: `slider.ts` (timeline and handles), `sliderModel.ts` (pure layout/selection logic), `diffView.ts` (Monaco diff editor), `card.ts` (commit popup), `app.ts` (wiring) |
| `esbuild.mjs` | Bundles the extension, the webview (with Monaco) and Monaco's diff worker into `dist/` |

## Build and run

```sh
npm install
npm run build        # or: npm run watch
```

Press **F5** in VS Code ("Run Extension") to start an Extension Development Host.

## Tests

```sh
npm run typecheck
npm test             # unit tests: git layer against temporary repos, slider logic, formatting
npm run test:ui      # the webview in headless Chromium with a mock extension host
npm run check        # all of the above
```

The UI tests (`test/ui`) serve the built webview the way VS Code does: the page and its assets on different origins, under the same Content-Security-Policy the extension sets. They fail on any console error or CSP violation, and they check that Monaco's diff worker really starts.

### End-to-end tests in VS Code

`test/e2e` drives the real extension inside [code-server](https://github.com/coder/code-server) (VS Code in a browser). They are skipped unless `DIFF_SLIDER_CODE_SERVER` is set.

```sh
# code-server needs Node 24 and, on Linux, libkrb5-dev to build.
npm install --prefix /tmp/cs code-server

# Point an extensions directory at this checkout.
mkdir -p /tmp/cs-ext && ln -sfn "$PWD" /tmp/cs-ext/AndrewBenz.diff-slider-0.1.0

npm run build
/tmp/cs/node_modules/.bin/code-server --auth none --bind-addr 127.0.0.1:8123 \
  --extensions-dir /tmp/cs-ext --user-data-dir /tmp/cs-data --disable-workspace-trust &

DIFF_SLIDER_CODE_SERVER=http://127.0.0.1:8123 npm run test:e2e
```

Each run creates a throwaway repository and checks: the keybinding, dragging across a rename, opening VS Code's diff editor, live updates while typing, refreshing after an outside `git commit`, restoring after a window reload, and the Timeline and Explorer context menus.

## Packaging

```sh
npm run package      # diff-slider-<version>.vsix
```
