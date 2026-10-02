import * as vscode from 'vscode';
import { decodeText, runGit } from './git';
import { gitPath } from './gitExtension';

export const REVISION_SCHEME = 'history-slider';

interface RevisionQuery {
  root: string;
  /** git object spec: a blob id, `<sha>:<path>`, or empty for "file did not exist". */
  spec: string;
}

/** A read-only document URI for the file at a revision; the path keeps the real file name for language detection. */
export function revisionUri(root: string, relPath: string, spec: string | undefined, label: string): vscode.Uri {
  const query: RevisionQuery = { root, spec: spec ?? '' };
  // The label becomes a path segment so tabs and breadcrumbs show which revision this is.
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/') + 1) : '';
  const name = relPath.slice(dir.length);
  return vscode.Uri.from({
    scheme: REVISION_SCHEME,
    path: `/${dir}${label.replace(/[\\/]/g, '_')}/${name}`,
    query: JSON.stringify(query),
  });
}

export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { root, spec } = JSON.parse(uri.query) as RevisionQuery;
    if (!spec) return '';
    const buf = await runGit(await gitPath(), ['cat-file', 'blob', spec], root);
    return decodeText(buf);
  }
}
