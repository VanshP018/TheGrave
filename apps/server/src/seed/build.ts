import type { Language } from '@thegrave/shared';
import type { ProblemDef } from './problems.js';
import { createRng, hashString } from './rng.js';

export const STARTER_CODE: Record<Language, string> = {
  python:
    'import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    # your code here\n\n\nmain()\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // your code here\n    return 0;\n}\n',
};

export interface BuiltTestCase {
  ordinal: number;
  input: string;
  expected: string;
  isSample: boolean;
}

/** Samples first, then hidden tests. Deterministic: the RNG is seeded from the slug. */
export function buildTestCases(def: ProblemDef): BuiltTestCase[] {
  const hidden = def.hidden(createRng(hashString(def.slug)));
  return [
    ...def.samples.map((input) => ({ input, isSample: true })),
    ...hidden.map((input) => ({ input, isSample: false })),
  ].map((t, ordinal) => ({ ...t, ordinal, expected: `${def.solve(t.input)}\n` }));
}
