import * as vscode from 'vscode';
import { HistoryPanel, VIEW_TYPE, type OpenOptions } from './historyPanel';
import { REVISION_SCHEME, RevisionContentProvider } from './revisionProvider';
import type { PanelState } from './shared/protocol';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('diffSlider.showHistory', (...args: unknown[]) => showHistory(context, args)),
    vscode.workspace.registerTextDocumentContentProvider(REVISION_SCHEME, new RevisionContentProvider()),
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: PanelState | undefined) {
        HistoryPanel.revive(panel, context.extensionUri, state);
      },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('diffSlider')) return;
      const historyKeys = ['pageSize', 'followRenames', 'firstParentOnly', 'showStaged', 'maxFileSizeMB'];
      if (historyKeys.some((k) => e.affectsConfiguration(`diffSlider.${k}`))) HistoryPanel.reloadAll();
      else HistoryPanel.broadcastOptions();
    }),
  );
}

export function deactivate(): void {}

function isUri(value: unknown): value is vscode.Uri {
  return value instanceof vscode.Uri;
}

/** Works out which file (and optionally which commit) a command invocation refers to. */
function resolveTarget(args: unknown[]): { uri?: vscode.Uri; options: OpenOptions } {
  const [first, second] = args;
  const options: OpenOptions = {};

  // Timeline item: (item, uri, source). Git timeline items use the commit sha as their id.
  if (isUri(second) && first && typeof first === 'object' && !isUri(first)) {
    const item = first as { id?: unknown; ref?: unknown };
    const sha = [item.ref, item.id].find((v): v is string => typeof v === 'string' && /^[0-9a-f]{7,64}$/i.test(v));
    if (sha) options.sha = sha;
    return { uri: second, options };
  }
  // Explorer / editor title: (uri, selectedUris?)
  if (isUri(first)) return { uri: first, options };
  // SCM resource state
  if (first && typeof first === 'object' && isUri((first as { resourceUri?: unknown }).resourceUri)) {
    return { uri: (first as { resourceUri: vscode.Uri }).resourceUri, options };
  }

  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === 'file') {
    options.line = editor.selection.active.line + 1;
    return { uri: editor.document.uri, options };
  }
  // A diff editor or other tab that wraps a file.
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText) return { uri: input.uri, options };
  if (input instanceof vscode.TabInputTextDiff) return { uri: input.modified, options };
  return { options };
}

function showHistory(context: vscode.ExtensionContext, args: unknown[]): void {
  const { uri, options } = resolveTarget(args);
  if (!uri) {
    void vscode.window.showInformationMessage('Diff Slider: open a file first, then run this command.');
    return;
  }
  if (uri.scheme !== 'file') {
    void vscode.window.showInformationMessage('Diff Slider only works with files on disk.');
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (options.line === undefined && editor?.document.uri.toString() === uri.toString()) {
    options.line = editor.selection.active.line + 1;
  }
  HistoryPanel.show(context.extensionUri, uri, options);
}
