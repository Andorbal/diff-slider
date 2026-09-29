import './monacoFeatures';
import 'monaco-editor/languages/definitions/register.all';
import type { PanelState, WebviewMessage } from '../src/shared/protocol';
import { App } from './app';
import './styles.css';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  setState(state: PanelState): void;
  getState(): PanelState | undefined;
}

declare function acquireVsCodeApi(): VsCodeApi;

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker | Promise<Worker> };
  }
}

const container = document.getElementById('app')!;
const workerUrl = container.dataset.worker ?? '';
let workerSource: Promise<string> | undefined;

// Webview resources live on another origin, so the worker script is fetched and
// started from a blob URL. If that fails Monaco falls back to diffing on the main thread.
window.MonacoEnvironment = {
  getWorker() {
    workerSource ??= fetch(workerUrl).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${workerUrl}: ${r.status}`);
      return r.text();
    });
    return workerSource.then((src) => new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))));
  },
};

new App(container, acquireVsCodeApi());
