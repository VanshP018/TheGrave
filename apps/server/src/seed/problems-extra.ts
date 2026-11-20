import { easyProblems } from './problems-easy.js';
import { hardProblems } from './problems-hard.js';
import { mediumProblems } from './problems-medium.js';
import type { ProblemDef } from './problems.js';

/** The second batch of problems: original statements, raw-stdin mode (no function signatures). */
export const extraProblems: ProblemDef[] = [...easyProblems, ...mediumProblems, ...hardProblems];
