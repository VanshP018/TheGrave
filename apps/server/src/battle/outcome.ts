import type { SubmissionStatus, Verdict } from '@thegrave/shared';

export interface SubmissionFact {
  id: string;
  userId: string;
  createdAt: number;
  status: SubmissionStatus;
  verdict: Verdict | null;
  testsPassed: number | null;
}

export type Outcome =
  | { kind: 'undecided' }
  | { kind: 'win'; winnerId: string; reason: 'SOLVED' | 'TIMEOUT' }
  | { kind: 'draw' };

const isPending = (s: SubmissionFact) => s.status === 'QUEUED' || s.status === 'RUNNING';

/**
 * Battle win rules (PLAN.md Phase 4, decision.md D-041), as a pure function of the submissions:
 *
 * 1. The first full ACCEPTED wins, ordered by *submission* time, not judging order: an ACCEPTED is final
 *    only if the opponent has no earlier submission still being judged (which might also be ACCEPTED).
 * 2. Otherwise, once time is up and nothing is pending: most tests passed wins.
 * 3. Tie: whoever reached that best score first wins.
 * 4. Nobody passed anything (or a perfect tie): draw.
 *
 * `ignorePending` is used when the judge failed to deliver verdicts within the end grace period.
 */
export function decideOutcome(
  players: readonly [string, string],
  submissions: readonly SubmissionFact[],
  opts: { timeUp: boolean; ignorePending?: boolean },
): Outcome {
  const subs = submissions
    .filter((s) => players.includes(s.userId) && !(opts.ignorePending && isPending(s)))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  const pendingBy = new Set<string>();
  for (const s of subs) {
    if (isPending(s)) {
      pendingBy.add(s.userId);
    } else if (s.status === 'DONE' && s.verdict === 'ACCEPTED') {
      const opponent = players[0] === s.userId ? players[1] : players[0];
      if (pendingBy.has(opponent)) return { kind: 'undecided' };
      return { kind: 'win', winnerId: s.userId, reason: 'SOLVED' };
    }
  }

  if (!opts.timeUp || pendingBy.size > 0) return { kind: 'undecided' };

  const best = players.map((userId) => {
    let passed = 0;
    let at = Infinity;
    for (const s of subs) {
      if (s.userId !== userId || s.status !== 'DONE') continue;
      const p = s.testsPassed ?? 0;
      if (p > passed) {
        passed = p;
        at = s.createdAt;
      }
    }
    return { userId, passed, at };
  });
  const [a, b] = best as [(typeof best)[0], (typeof best)[0]];

  if (a.passed === 0 && b.passed === 0) return { kind: 'draw' };
  if (a.passed !== b.passed) {
    return { kind: 'win', winnerId: a.passed > b.passed ? a.userId : b.userId, reason: 'TIMEOUT' };
  }
  if (a.at === b.at) return { kind: 'draw' };
  return { kind: 'win', winnerId: a.at < b.at ? a.userId : b.userId, reason: 'TIMEOUT' };
}
