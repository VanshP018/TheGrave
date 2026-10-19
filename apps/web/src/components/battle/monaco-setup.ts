// Bundle Monaco locally instead of the default CDN loader: no third-party script at runtime, works offline,
// and only the editor core + the two languages we judge are included.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/python/register';

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
