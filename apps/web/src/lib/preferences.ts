import { LANGUAGES, type Language } from '@thegrave/shared';
import { useState } from 'react';

const KEY = 'pref:language';

/** The language the editor opens with, in battles and practice. Per browser; storage failures fall back to Python. */
export function readPreferredLanguage(): Language {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (LANGUAGES as readonly string[]).includes(v)) return v as Language;
  } catch {
    // storage unavailable
  }
  return 'python';
}

export function usePreferredLanguage() {
  const [language, setLanguage] = useState<Language>(readPreferredLanguage);
  const update = (l: Language) => {
    setLanguage(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // ignore
    }
  };
  return [language, update] as const;
}
