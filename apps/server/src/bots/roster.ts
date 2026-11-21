/**
 * The practice bots: one account each, with a fixed rating and a playing style. A bot's rating never
 * changes (only the human's does, against it), so the roster is a dense ladder from beginner to expert, with
 * the most rungs where most players are. Every bot plays both DSA and programming battles.
 */
export type BotStyle = 'steady' | 'speedy' | 'careful' | 'grinder';

export interface BotPersona {
  username: string;
  /** The name an earlier roster gave this account; the seed renames it in place so its history is kept. */
  legacy?: string;
  rating: number;
  style: BotStyle;
  /** Multiplies how long the bot takes: above 1 is slower than its rating suggests, below 1 faster. */
  pace: number;
  /** Chance of a wrong submission before the real one (0 = always careful). */
  sloppiness: number;
  bio: string;
}

const STYLE_TEXT: Record<BotStyle, string> = {
  steady: 'Steady and methodical.',
  speedy: 'Quick to submit, quick to fix.',
  careful: 'Slow, thorough, rarely wrong.',
  grinder: 'Keeps iterating until it passes.',
};
// How each style bends the rating-based defaults: [pace, sloppiness]
const STYLE_SHAPE: Record<BotStyle, [number, number]> = {
  steady: [1, 1],
  speedy: [0.8, 1.35],
  careful: [1.2, 0.45],
  grinder: [1.1, 1],
};

/** Pace and sloppiness for a rating: stronger players are quicker and make fewer wrong submissions. */
export function traitsFor(rating: number, style: BotStyle = 'steady') {
  const strength = Math.min(1, Math.max(0, (rating - 700) / 1800));
  const [paceMul, sloppyMul] = STYLE_SHAPE[style];
  return {
    pace: Math.round((1.3 - 0.65 * strength) * paceMul * 100) / 100,
    sloppiness: Math.round(Math.min(0.85, (0.65 - 0.6 * strength) * sloppyMul) * 100) / 100,
  };
}

const bot = (username: string, rating: number, style: BotStyle, legacy?: string): BotPersona => ({
  username,
  legacy,
  rating,
  style,
  ...traitsFor(rating, style),
  bio: `Practice bot. ${STYLE_TEXT[style]}`,
});

// Sorted by rating. The 12 `legacy` entries are the accounts from the first roster, renamed in place.
export const BOTS: readonly BotPersona[] = [
  bot('aarav_k', 700, 'grinder'),
  bot('megha_codes', 800, 'steady', 'ArrayAnt'),
  bot('dev_patel22', 870, 'speedy'),
  bot('nina_bytes', 950, 'careful', 'LoopLarry'),
  bot('aisha_b', 1000, 'steady'),
  bot('sam_the_coder', 1040, 'grinder'),
  bot('ishaan_dev', 1100, 'speedy', 'StackSam'),
  bot('kavya_j', 1160, 'careful'),
  bot('tanmay07', 1210, 'steady'),
  bot('priya_codes', 1250, 'grinder', 'QueueQuinn'),
  bot('arjun_m', 1310, 'speedy'),
  bot('rishi_codes', 1350, 'careful'),
  bot('leo_writes_code', 1400, 'steady', 'HeapHana'),
  bot('mira_dev', 1440, 'grinder'),
  bot('vikram_s', 1470, 'speedy'),
  bot('anya_r', 1500, 'careful', 'TreeTara'),
  bot('kabir_xyz', 1530, 'steady'),
  bot('tara_builds', 1560, 'speedy'),
  bot('nikhil_r99', 1600, 'grinder', 'GraphGio'),
  bot('elena_v', 1640, 'careful'),
  bot('omar_dev', 1680, 'steady'),
  bot('riya_sen', 1720, 'speedy'),
  bot('jason_lee21', 1750, 'careful', 'DPDiya'),
  bot('sana_k', 1790, 'grinder'),
  bot('rahul_vz', 1830, 'steady'),
  bot('maya_codes', 1870, 'speedy'),
  bot('ethan_w', 1900, 'steady', 'BitBea'),
  bot('diya_p', 1950, 'careful'),
  bot('harsh_cp', 2000, 'speedy'),
  bot('noah_b', 2050, 'careful', 'SegSasha'),
  bot('ishita_r', 2100, 'steady'),
  bot('yash_dev01', 2150, 'grinder'),
  bot('lucas_m', 2200, 'speedy', 'FlowFinn'),
  bot('ananya_k', 2250, 'careful'),
  bot('dhruv_cp', 2300, 'steady'),
  bot('chloe_t', 2350, 'careful', 'NullNova'),
  bot('karan_s', 2400, 'speedy'),
  bot('sofia_h', 2450, 'steady'),
  bot('pranav_m', 2500, 'careful'),
  bot('zoe_kim', 1330, 'steady'),
].sort((a, b) => a.rating - b.rating);
