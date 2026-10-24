import Editor, { type OnMount } from '@monaco-editor/react';
import { useRef } from 'react';
import { MONACO_THEME } from '../battle/monaco-setup';
import { languageFor } from './files';

/**
 * Multi-file editor: `path` gives every file its own Monaco model, so switching tabs keeps each file's
 * undo history, cursor and scroll position.
 */
export function WorkspaceEditor(props: {
  path: string;
  value: string;
  onChange: (v: string) => void;
  onRunTests?: () => void;
  onSubmit?: () => void;
}) {
  const handlers = useRef(props);
  handlers.current = props;

  const onMount: OnMount = (editor, monaco) => {
    const { KeyMod, KeyCode } = monaco;
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => handlers.current.onRunTests?.());
    editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter, () =>
      handlers.current.onSubmit?.(),
    );
  };

  return (
    <div className="h-full min-h-[280px] overflow-hidden" data-testid="workspace-editor">
      <Editor
        theme={MONACO_THEME}
        path={props.path}
        language={languageFor(props.path)}
        value={props.value}
        onChange={(v) => props.onChange(v ?? '')}
        onMount={onMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineHeight: 22,
          fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
          fontLigatures: true,
          padding: { top: 12, bottom: 12 },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: props.path.endsWith('.py') ? 4 : 2,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          renderLineHighlight: 'all',
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
        }}
      />
    </div>
  );
}
