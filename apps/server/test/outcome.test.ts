import { describe, expect, it } from 'vitest';
import { decideOutcome, type SubmissionFact } from '../src/battle/outcome.js';
import { difficultyFor } from '../src/battle/problem-pick.js';

const P = ['alice', 'bob'] as const;
let seq = 0;
const sub = (
  userId: string,
  createdAt: number,
  r: Partial<SubmissionFact> = {},
): SubmissionFact => ({
  id: `s${seq++}`,
  userId,
  createdAt,
  status: 'DONE',
  verdict: 'WRONG_ANSWER',
  testsPassed: 0,
  ...r,
});
const ac = (u: string, t: number) => sub(u, t, { verdict: 'ACCEPTED', testsPassed: 10 });
const pending = (u: string, t: number) =>
  sub(u, t, { status: 'RUNNING', verdict: null, testsPassed: null });
const partial = (u: string, t: number, n: number) => sub(u, t, { testsPassed: n });

describe('first full ACCEPTED wins', () => {
  it('wins immediately, before time is up', () => {
    expect(decideOutcome(P, [partial('bob', 1, 9), ac('alice', 2)], { timeUp: false })).toEqual({
      kind: 'win',
      winnerId: 'alice',
      reason: 'SOLVED',
    });
  });

  it('orders by submission time, not by which verdict arrived first', () => {
    // bob submitted first; both accepted → bob, regardless of array/judging order
    expect(decideOutcome(P, [ac('alice', 20), ac('bob', 10)], { timeUp: false })).toMatchObject({
      winnerId: 'bob',
    });
  });

  it('waits while the opponent has an earlier submission still being judged', () => {
    expect(decideOutcome(P, [pending('bob', 10), ac('alice', 20)], { timeUp: false })).toEqual({
      kind: 'undecided',
    });
    // ...and that earlier one turning out ACCEPTED wins it for bob
    expect(decideOutcome(P, [ac('bob', 10), ac('alice', 20)], { timeUp: false })).toMatchObject({
      winnerId: 'bob',
    });
    // ...or failing hands it to alice
    expect(
      decideOutcome(P, [partial('bob', 10, 3), ac('alice', 20)], { timeUp: false }),
    ).toMatchObject({
      winnerId: 'alice',
    });
  });

  it("does not wait on the winner's own pending submissions or on later ones", () => {
    expect(
      decideOutcome(P, [pending('alice', 5), ac('alice', 10)], { timeUp: false }),
    ).toMatchObject({
      winnerId: 'alice',
    });
    expect(
      decideOutcome(P, [ac('alice', 10), pending('bob', 20)], { timeUp: false }),
    ).toMatchObject({
      winnerId: 'alice',
    });
  });

  it('ignores submissions from non-players', () => {
    expect(decideOutcome(P, [ac('mallory', 1)], { timeUp: false })).toEqual({ kind: 'undecided' });
  });
});

describe('at time-out', () => {
  it('is undecided before time is up without an ACCEPTED', () => {
    expect(decideOutcome(P, [partial('alice', 1, 5)], { timeUp: false })).toEqual({
      kind: 'undecided',
    });
  });

  it('most tests passed wins', () => {
    expect(
      decideOutcome(P, [partial('alice', 1, 3), partial('bob', 2, 7), partial('alice', 3, 6)], {
        timeUp: true,
      }),
    ).toEqual({
      kind: 'win',
      winnerId: 'bob',
      reason: 'TIMEOUT',
    });
  });

  it('a tie on tests goes to whoever reached that score first', () => {
    const subs = [
      partial('bob', 5, 4),
      partial('alice', 3, 2),
      partial('alice', 8, 4),
      partial('bob', 9, 4),
    ];
    expect(decideOutcome(P, subs, { timeUp: true })).toMatchObject({ winnerId: 'bob' });
  });

  it('nobody passing anything is a draw, including no submissions at all', () => {
    expect(decideOutcome(P, [], { timeUp: true })).toEqual({ kind: 'draw' });
    expect(
      decideOutcome(P, [partial('alice', 1, 0), sub('bob', 2, { verdict: 'COMPILE_ERROR' })], {
        timeUp: true,
      }),
    ).toEqual({
      kind: 'draw',
    });
  });

  it('a lone scorer wins against someone who never submitted', () => {
    expect(decideOutcome(P, [partial('alice', 1, 1)], { timeUp: true })).toMatchObject({
      winnerId: 'alice',
    });
  });

  it('waits for pending verdicts, unless told to give up on them', () => {
    const subs = [partial('alice', 1, 3), pending('bob', 2)];
    expect(decideOutcome(P, subs, { timeUp: true })).toEqual({ kind: 'undecided' });
    expect(decideOutcome(P, subs, { timeUp: true, ignorePending: true })).toMatchObject({
      winnerId: 'alice',
    });
  });

  it('judge FAILED submissions are not pending and score 0', () => {
    const subs = [
      partial('alice', 1, 1),
      sub('bob', 2, { status: 'FAILED', verdict: null, testsPassed: null }),
    ];
    expect(decideOutcome(P, subs, { timeUp: true })).toMatchObject({ winnerId: 'alice' });
  });
});

describe('difficultyFor', () => {
  it('maps average rating to difficulty; new players start on Easy', () => {
    expect(difficultyFor(1500)).toBe('EASY');
    expect(difficultyFor(1549)).toBe('EASY');
    expect(difficultyFor(1550)).toBe('MEDIUM');
    expect(difficultyFor(1899)).toBe('MEDIUM');
    expect(difficultyFor(1900)).toBe('HARD');
  });
});
