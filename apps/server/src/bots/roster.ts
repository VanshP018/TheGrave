/**
 * The practice bots: one account each, with a fixed rating and a playing style. A bot's rating never
 * changes (only the human's does, against it), so the roster is a stable ladder from beginner to expert.
 * Every bot plays both DSA and programming battles, and is always labelled as a bot in the app.
 */
export interface BotPersona {
  username: string;
  rating: number;
  /** Multiplies how long the bot takes: above 1 is slower than its rating suggests, below 1 faster. */
  pace: number;
  /** Chance of a wrong submission before each real attempt (0 = always careful). */
  sloppiness: number;
  bio: string;
}

const bio = (rating: number, style: string) =>
  `Practice bot, rating ${rating}. ${style} Joins when the queue is quiet, so you never wait long.`;

export const BOTS: readonly BotPersona[] = [
  {
    username: 'ArrayAnt',
    rating: 800,
    pace: 1.25,
    sloppiness: 0.6,
    bio: bio(800, 'Still learning loops.'),
  },
  {
    username: 'LoopLarry',
    rating: 950,
    pace: 1.15,
    sloppiness: 0.5,
    bio: bio(950, 'Brute force first.'),
  },
  {
    username: 'StackSam',
    rating: 1100,
    pace: 1.1,
    sloppiness: 0.45,
    bio: bio(1100, 'Careful but slow.'),
  },
  {
    username: 'QueueQuinn',
    rating: 1250,
    pace: 1.0,
    sloppiness: 0.4,
    bio: bio(1250, 'Steady and patient.'),
  },
  {
    username: 'HeapHana',
    rating: 1400,
    pace: 0.95,
    sloppiness: 0.35,
    bio: bio(1400, 'Loves a good heap.'),
  },
  {
    username: 'TreeTara',
    rating: 1500,
    pace: 1.0,
    sloppiness: 0.3,
    bio: bio(1500, 'Recursion first.'),
  },
  {
    username: 'GraphGio',
    rating: 1600,
    pace: 0.95,
    sloppiness: 0.3,
    bio: bio(1600, 'Sees a graph everywhere.'),
  },
  {
    username: 'DPDiya',
    rating: 1750,
    pace: 0.9,
    sloppiness: 0.25,
    bio: bio(1750, 'Memoises everything.'),
  },
  {
    username: 'BitBea',
    rating: 1900,
    pace: 0.85,
    sloppiness: 0.2,
    bio: bio(1900, 'Fast and tidy.'),
  },
  {
    username: 'SegSasha',
    rating: 2050,
    pace: 0.8,
    sloppiness: 0.15,
    bio: bio(2050, 'Segment trees for breakfast.'),
  },
  {
    username: 'FlowFinn',
    rating: 2200,
    pace: 0.75,
    sloppiness: 0.1,
    bio: bio(2200, 'Rarely misses.'),
  },
  {
    username: 'NullNova',
    rating: 2350,
    pace: 0.7,
    sloppiness: 0.05,
    bio: bio(2350, 'Expert pace, expert accuracy.'),
  },
];
