// Bundle Monaco locally instead of the default CDN loader: no third-party script at runtime, works offline,
// and only the editor core + the languages we use are included.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/python/register';
// Programming challenges (decision.md D-066) also open JavaScript, Markdown and shell files.
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/definitions/shell/register';
// The core API ships without editor features; add the ones people reach for: find & replace (Ctrl+F/H),
// toggle comment (Ctrl+/), multi-cursor, line moves, bracket matching, word highlight, folding, the
// context menu and clipboard actions.
import 'monaco-editor/editor/contrib/find/browser/findController';
import 'monaco-editor/editor/contrib/comment/browser/comment';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter';
import 'monaco-editor/editor/contrib/folding/browser/folding';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';

(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
loader.config({ monaco });

// Editor theme in the brand palette: near-black surface, blue cursor and selection, blue keywords.
export const MONACO_THEME = 'grave';
monaco.editor.defineTheme(MONACO_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '5cb8ff' },
    { token: 'number', foreground: 'a8dbff' },
    { token: 'string', foreground: 'b9c3cf' },
    { token: 'comment', foreground: '8a8a8a', fontStyle: 'italic' },
    { token: 'type', foreground: '8fd0ff' },
  ],
  colors: {
    'editor.background': '#141414',
    'editor.foreground': '#f5f5f4',
    'editorCursor.foreground': '#5cb8ff',
    'editor.selectionBackground': '#5cb8ff40',
    'editor.inactiveSelectionBackground': '#5cb8ff22',
    'editor.lineHighlightBackground': '#1b1b1b',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#5a5a5a',
    'editorGutter.background': '#141414',
    'editorLineNumber.activeForeground': '#5cb8ff',
    'editorIndentGuide.background1': '#222222',
    'editorBracketMatch.border': '#5cb8ff80',
    'editorWidget.background': '#141414',
    'editorWidget.border': '#262626',
    'scrollbarSlider.background': '#ffffff14',
  },
});
