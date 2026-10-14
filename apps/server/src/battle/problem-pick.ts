import type { Difficulty } from '@thegrave/shared';
import { prisma } from '../lib/prisma.js';

const ORDER: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];

/** New players (1500) start on Easy; see decision.md D-042. */
export function difficultyFor(avgRating: number): Difficulty {
  if (avgRating < 1550) return 'EASY';
  if (avgRating < 1900) return 'MEDIUM';
  return 'HARD';
}

const random = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]!;

/**
 * A problem neither player has seen, preferring the target difficulty, then the nearest ones.
 * If they have seen everything, falls back to any problem at the target difficulty.
 */
export async function pickProblem(
  userIds: string[],
  target: Difficulty,
): Promise<{ id: string; difficulty: Difficulty }> {
  const t = ORDER.indexOf(target);
  const byDistance = [...ORDER].sort(
    (x, y) => Math.abs(ORDER.indexOf(x) - t) - Math.abs(ORDER.indexOf(y) - t),
  );
  for (const difficulty of byDistance) {
    const fresh = await prisma.problem.findMany({
      where: { difficulty, seenBy: { none: { userId: { in: userIds } } } },
      select: { id: true, difficulty: true },
    });
    if (fresh.length) return random(fresh);
  }
  const any = await prisma.problem.findMany({
    where: { difficulty: target },
    select: { id: true, difficulty: true },
  });
  const all = any.length
    ? any
    : await prisma.problem.findMany({ select: { id: true, difficulty: true } });
  if (!all.length) throw new Error('no problems in the database; run db:seed');
  return random(all);
}
