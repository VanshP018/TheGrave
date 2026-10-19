import Editor, { type OnMount } from '@monaco-editor/react';
import type { Language } from '@thegrave/shared';
import { useRef } from 'react';
import { MONACO_THEME } from './monaco-setup';

const MONACO_LANGUAGE: Record<Language, string> = { python: 'python', cpp: 'cpp' };

export function CodeEditor(props: {
  language: Language;
  value: string;
  onChange: (v: string) => void;
  /** Ctrl/⌘ + Enter. */
  onRun?: () => void;
  /** Ctrl/⌘ + Shift + Enter. */
  onSubmit?: () => void;
}) {
  // Monaco commands are bound once at mount; refs keep them calling the latest handlers.
  const handlers = useRef(props);
  handlers.current = props;

  const onMount: OnMount = (editor, monaco) => {
    const { KeyMod, KeyCode } = monaco;
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => handlers.current.onRun?.());
    editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter, () =>
      handlers.current.onSubmit?.(),
    );
  };

  return (
    <div className="h-full min-h-[320px] overflow-hidden" data-testid="code-editor">
      <Editor
        theme={MONACO_THEME}
        language={MONACO_LANGUAGE[props.language]}
        value={props.value}
        onChange={(v) => props.onChange(v ?? '')}
        onMount={onMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineHeight: 22,
          fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
          fontLigatures: true,
          padding: { top: 14, bottom: 14 },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          renderLineHighlight: 'all',
          guides: { indentation: true, bracketPairs: false },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
        }}
      />
    </div>
  );
}
