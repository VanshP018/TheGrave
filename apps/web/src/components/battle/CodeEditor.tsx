import Editor from '@monaco-editor/react';
import type { Language } from '@thegrave/shared';
import './monaco-setup';

const MONACO_LANGUAGE: Record<Language, string> = { python: 'python', cpp: 'cpp' };

export function CodeEditor(props: {
  language: Language;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="h-full min-h-[320px] overflow-hidden rounded-md border border-zinc-800"
      data-testid="code-editor"
    >
      <Editor
        theme="vs-dark"
        language={MONACO_LANGUAGE[props.language]}
        value={props.value}
        onChange={(v) => props.onChange(v ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
        }}
      />
    </div>
  );
}
