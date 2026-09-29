// The editor contributions a read-only diff viewer needs: a trimmed-down version
// of monaco's `features/register.all` that leaves out editing, completion,
// refactoring and language-service features (roughly halving the bundle).
import 'monaco-editor/editor/browser/coreCommands';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget';
import 'monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution';
import 'monaco-editor/editor/common/standaloneStrings';
import '../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import '../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/features/find/register';
import 'monaco-editor/editor/contrib/folding/browser/folding';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/editor/contrib/lineSelection/browser/lineSelection';
import 'monaco-editor/editor/contrib/longLinesHelper/browser/longLinesHelper';
import 'monaco-editor/editor/contrib/middleScroll/browser/middleScroll.contribution';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor';
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution';
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect';
import 'monaco-editor/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';
import 'monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations';
