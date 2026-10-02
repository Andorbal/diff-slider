declare const __HISTORY_SLIDER_BUILD__: string | undefined;

/**
 * Identifies one build of the extension. esbuild stamps the same value into the
 * extension host and webview bundles (see esbuild.mjs).
 *
 * Reinstalling the extension over the same version replaces its files while the
 * running extension host keeps the old code and the old `package.json`. A panel
 * opened after that loads the new webview but talks to the old host, which
 * cannot save settings it never registered. Comparing the two stamps lets the
 * panel notice and ask for a reload.
 */
export const BUILD_ID: string = typeof __HISTORY_SLIDER_BUILD__ === 'string' ? __HISTORY_SLIDER_BUILD__ : 'dev';
