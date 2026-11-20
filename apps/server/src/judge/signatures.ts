import type { Language } from '@thegrave/shared';

/**
 * Function-style DSA problems: the player implements `solve(...)` and nothing else. The test data stays raw
 * stdin text (decision.md D-008); a hidden driver, generated from the signatures below, parses it, calls the
 * player's function and prints the answer, so the judge still just compares output text.
 */

type Ty = 'int' | 'str' | 'ints' | 'strs' | 'matrix';
type Ret =
  'int' | 'bool' | 'str' | 'ints' | 'maybeInt' | 'intLines' | 'strLines' | 'intervals' | 'half'; // a median-like number: printed without a decimal point when whole, else with one digit

/** How the stdin is laid out, one step per line (or per group of lines), in order. */
type Step =
  | { ints: string[] } // one line of integers into these variables
  | { arr: string } // one line of integers into a list
  | { line: string } // one line of text
  | { grid: string; rows: string } // `rows` lines of text
  | { matrix: string; rows: string }; // `rows` lines of integers

interface Param {
  name: string;
  ty: Ty;
  doc: string;
}

export interface Signature {
  steps: Step[];
  params: Param[];
  ret: Ret;
  retDoc: string;
}

const p = (name: string, ty: Ty, doc: string): Param => ({ name, ty, doc });

export const SIGNATURES: Record<string, Signature> = {
  'sum-of-array': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers')],
    ret: 'int',
    retDoc: 'the sum of all elements',
  },
  'reverse-words': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'the sentence: lowercase words separated by single spaces')],
    ret: 'str',
    retDoc: 'the words in reverse order, separated by single spaces',
  },
  fizzbuzz: {
    steps: [{ ints: ['n'] }],
    params: [p('n', 'int', 'how many lines to produce')],
    ret: 'strLines',
    retDoc: 'the n lines, one string each',
  },
  'count-vowels': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'a string of lowercase letters')],
    ret: 'int',
    retDoc: 'the number of vowels',
  },
  'palindrome-check': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'a string of lowercase letters')],
    ret: 'bool',
    retDoc: 'true if it is a palindrome (printed as YES, otherwise NO)',
  },
  'second-largest': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers')],
    ret: 'maybeInt',
    retDoc: 'the second largest distinct value, or None / nullopt if all values are equal',
  },
  'max-consecutive-ones': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n values, each 0 or 1')],
    ret: 'int',
    retDoc: 'the length of the longest run of 1s',
  },
  'missing-number': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [
      p('n', 'int', 'the numbers are drawn from 1 … n'),
      p('a', 'ints', 'the n − 1 given numbers'),
    ],
    ret: 'int',
    retDoc: 'the missing number',
  },
  'anagram-check': {
    steps: [{ line: 's' }, { line: 't' }],
    params: [p('s', 'str', 'the first string'), p('t', 'str', 'the second string')],
    ret: 'bool',
    retDoc: 'true if they are anagrams (printed as YES, otherwise NO)',
  },
  'range-sum-queries': {
    steps: [{ ints: ['n', 'q'] }, { arr: 'a' }, { matrix: 'queries', rows: 'q' }],
    params: [
      p('a', 'ints', 'the n integers'),
      p('queries', 'matrix', 'the q queries, each [l, r] (1-indexed, inclusive)'),
    ],
    ret: 'intLines',
    retDoc: 'the sum for each query, in order',
  },
  'max-subarray-sum': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers')],
    ret: 'int',
    retDoc: 'the maximum subarray sum',
  },
  'pair-sum-count': {
    steps: [{ ints: ['n', 't'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers'), p('t', 'int', 'the target sum')],
    ret: 'int',
    retDoc: 'the number of pairs that add up to t',
  },
  'longest-unique-substring': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'a string of lowercase letters')],
    ret: 'int',
    retDoc: 'the length of the longest substring without repeated characters',
  },
  'balanced-brackets': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'the bracket string')],
    ret: 'bool',
    retDoc: 'true if the brackets are balanced (printed as YES, otherwise NO)',
  },
  'merge-intervals': {
    steps: [{ ints: ['n'] }, { matrix: 'intervals', rows: 'n' }],
    params: [p('intervals', 'matrix', 'the n intervals, each [l, r]')],
    ret: 'intervals',
    retDoc: 'the merged intervals as [l, r] pairs, sorted by l',
  },
  'kth-smallest': {
    steps: [{ ints: ['n', 'k'] }, { arr: 'a' }],
    params: [
      p('a', 'ints', 'the n integers'),
      p('k', 'int', 'which smallest element to find (1-indexed)'),
    ],
    ret: 'int',
    retDoc: 'the k-th smallest element',
  },
  'grid-paths': {
    steps: [{ ints: ['n', 'm'] }, { grid: 'grid', rows: 'n' }],
    params: [p('grid', 'strs', 'n rows of m characters: "." is free, "#" is blocked')],
    ret: 'int',
    retDoc: 'the number of paths modulo 10^9 + 7 (0 if the start or end is blocked)',
  },
  'coin-change': {
    steps: [{ ints: ['n', 'amount'] }, { arr: 'coins' }],
    params: [p('coins', 'ints', 'the n coin values'), p('amount', 'int', 'the amount to make')],
    ret: 'int',
    retDoc: 'the minimum number of coins, or -1 if the amount cannot be made',
  },
  'lis-length': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers')],
    ret: 'int',
    retDoc: 'the length of the longest strictly increasing subsequence',
  },
  'count-islands': {
    steps: [{ ints: ['n', 'm'] }, { grid: 'grid', rows: 'n' }],
    params: [p('grid', 'strs', 'n rows of m characters: "#" is land, "." is water')],
    ret: 'int',
    retDoc: 'the number of islands',
  },
  'next-greater-element': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers')],
    ret: 'ints',
    retDoc: 'for each position the next greater element, or -1 if there is none',
  },
  'edit-distance': {
    steps: [{ line: 's' }, { line: 't' }],
    params: [p('s', 'str', 'the first string'), p('t', 'str', 'the second string')],
    ret: 'int',
    retDoc: 'the edit distance between s and t',
  },
  'shortest-path': {
    steps: [{ ints: ['n', 'm'] }, { matrix: 'edges', rows: 'm' }],
    params: [
      p('n', 'int', 'the number of nodes'),
      p('edges', 'matrix', 'the m directed edges, each [u, v, w]'),
    ],
    ret: 'int',
    retDoc: 'the shortest distance from node 1 to node n, or -1 if unreachable',
  },
  'count-inversions': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers')],
    ret: 'int',
    retDoc: 'the number of inversions',
  },
  'sliding-window-max': {
    steps: [{ ints: ['n', 'k'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers'), p('k', 'int', 'the window size')],
    ret: 'ints',
    retDoc: 'the maximum of each window, from the leftmost to the rightmost',
  },
  'longest-palindromic-substring': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'a string of lowercase letters')],
    ret: 'int',
    retDoc: 'the length of the longest palindromic substring',
  },
  knapsack: {
    steps: [{ ints: ['n', 'capacity'] }, { matrix: 'items', rows: 'n' }],
    params: [
      p('items', 'matrix', 'the n items, each [weight, value]'),
      p('capacity', 'int', 'the weight capacity W'),
    ],
    ret: 'int',
    retDoc: 'the maximum total value',
  },
  'minimum-spanning-tree': {
    steps: [{ ints: ['n', 'm'] }, { matrix: 'edges', rows: 'm' }],
    params: [
      p('n', 'int', 'the number of nodes'),
      p('edges', 'matrix', 'the m undirected edges, each [u, v, w]'),
    ],
    ret: 'int',
    retDoc: 'the total MST weight, or -1 if the graph is not connected',
  },
  'lexicographic-toposort': {
    steps: [{ ints: ['n', 'm'] }, { matrix: 'constraints', rows: 'm' }],
    params: [
      p('n', 'int', 'the number of tasks'),
      p('constraints', 'matrix', 'the m constraints, each [u, v]: task u must come before task v'),
    ],
    ret: 'ints',
    retDoc: 'the lexicographically smallest valid order, or [-1] if none exists',
  },
  'largest-rectangle': {
    steps: [{ ints: ['n'] }, { arr: 'heights' }],
    params: [p('heights', 'ints', 'the n bar heights')],
    ret: 'int',
    retDoc: 'the largest rectangle area',
  },

  // ---- second batch (problems-easy / -medium / -hard) ----------------------------------------
  'peak-elements': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n altitudes')],
    ret: 'int',
    retDoc: 'the number of peaks',
  },
  'run-length-encode': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'a string of lowercase letters')],
    ret: 'str',
    retDoc: 'the run-length encoding of s',
  },
  'rotate-right': {
    steps: [{ ints: ['n', 'k'] }, { arr: 'a' }],
    params: [
      p('a', 'ints', 'the n values in seat order'),
      p('k', 'int', 'how many seats to turn the carousel (up to 10^9)'),
    ],
    ret: 'ints',
    retDoc: 'the arrangement after rotating right by k seats',
  },
  'closest-to-zero': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n readings')],
    ret: 'int',
    retDoc: 'the reading closest to zero (the positive one if two tie)',
  },
  'digit-sum-steps': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'the decimal digits of N (up to 10^5 digits)')],
    ret: 'int',
    retDoc: 'the number of digit-sum steps until one digit is left',
  },
  'longest-common-prefix': {
    steps: [{ ints: ['n'] }, { grid: 'words', rows: 'n' }],
    params: [p('words', 'strs', 'the n words')],
    ret: 'str',
    retDoc: 'the longest common prefix, or "NONE" if there is none',
  },
  'unique-once-count': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n scanned IDs')],
    ret: 'int',
    retDoc: 'how many distinct IDs appear exactly once',
  },
  'stair-ways': {
    steps: [{ ints: ['n'] }],
    params: [p('n', 'int', 'the number of steps')],
    ret: 'int',
    retDoc: 'the number of ways to climb them, modulo 10^9 + 7',
  },
  'binary-gap': {
    steps: [{ ints: ['n'] }],
    params: [p('n', 'int', 'the number N (up to 10^18)')],
    ret: 'int',
    retDoc: 'the length of the longest gap of zeros between two ones',
  },
  'subarray-sum-k': {
    steps: [{ ints: ['n', 'k'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n daily profits'), p('k', 'int', 'the target total')],
    ret: 'int',
    retDoc: 'the number of streaks whose total is exactly k',
  },
  'product-except-self': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers')],
    ret: 'ints',
    retDoc: 'for each position the product of all the other elements, modulo 10^9 + 7',
  },
  'shortest-substring-all-chars': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'a string of lowercase letters')],
    ret: 'int',
    retDoc: 'the length of the shortest substring containing every distinct letter of s',
  },
  'meeting-rooms-min': {
    steps: [{ ints: ['n'] }, { matrix: 'meetings', rows: 'n' }],
    params: [p('meetings', 'matrix', 'the n meetings, each [start, end) with start < end')],
    ret: 'int',
    retDoc: 'the minimum number of rooms',
  },
  'search-rotated-array': {
    steps: [{ ints: ['n', 'q'] }, { arr: 'shelf' }, { arr: 'queries' }],
    params: [
      p('shelf', 'ints', 'the n distinct shelf numbers (a sorted shelf, then rotated)'),
      p('queries', 'ints', 'the q values to look up'),
    ],
    ret: 'intLines',
    retDoc: 'for each query its 0-based position on the shelf, or -1 if it is missing',
  },
  'ship-capacity': {
    steps: [{ ints: ['n', 'days'] }, { arr: 'weights' }],
    params: [
      p('weights', 'ints', 'the n package weights, in conveyor order'),
      p('days', 'int', 'the deadline D in days'),
    ],
    ret: 'int',
    retDoc: 'the smallest capacity that ships everything within the deadline',
  },
  'min-jumps': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the longest jump allowed from each pad')],
    ret: 'int',
    retDoc: 'the minimum number of jumps to reach the last pad, or -1 if it is unreachable',
  },
  'provinces-count': {
    steps: [{ ints: ['n', 'm'] }, { matrix: 'roads', rows: 'm' }],
    params: [
      p('n', 'int', 'the number of towns'),
      p('roads', 'matrix', 'the m two-way roads, each [u, v]'),
    ],
    ret: 'int',
    retDoc: 'the number of kingdoms (connected groups of towns)',
  },
  'bipartite-check': {
    steps: [{ ints: ['n', 'm'] }, { matrix: 'rivalries', rows: 'm' }],
    params: [
      p('n', 'int', 'the number of players'),
      p('rivalries', 'matrix', 'the m rival pairs, each [u, v]'),
    ],
    ret: 'bool',
    retDoc:
      'true if the players can be split into two teams with no rivals together (printed as YES, otherwise NO)',
  },
  'word-break-count': {
    steps: [{ ints: ['k'] }, { grid: 'words', rows: 'k' }, { line: 's' }],
    params: [
      p('words', 'strs', 'the k dictionary words'),
      p('s', 'str', 'the string to cut into dictionary words'),
    ],
    ret: 'int',
    retDoc: 'the number of segmentations, modulo 10^9 + 7',
  },
  'house-robber-circular': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the coins in each of the n houses, in order around the circle')],
    ret: 'int',
    retDoc: 'the maximum number of coins the thief can take',
  },
  'partition-equal-subset': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n item values')],
    ret: 'bool',
    retDoc:
      'true if the items can be split into two groups of equal value (printed as YES, otherwise NO)',
  },
  'top-k-frequent': {
    steps: [{ ints: ['n', 'k'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n played song IDs'), p('k', 'int', 'how many IDs to report')],
    ret: 'ints',
    retDoc: 'the k most played IDs, most played first, the smaller ID first on ties',
  },
  'tree-diameter': {
    steps: [{ ints: ['n'] }, { matrix: 'cables', rows: 'n - 1' }],
    params: [
      p('n', 'int', 'the number of computers'),
      p('cables', 'matrix', 'the n - 1 cables, each [u, v]'),
    ],
    ret: 'int',
    retDoc: 'the diameter: the number of cables on the longest route',
  },
  'lca-queries': {
    steps: [
      { ints: ['n', 'q'] },
      { matrix: 'links', rows: 'n - 1' },
      { matrix: 'queries', rows: 'q' },
    ],
    params: [
      p('n', 'int', 'the number of people; person 1 is the root ancestor'),
      p('links', 'matrix', 'the n - 1 parent-child links, each [u, v] in either order'),
      p('queries', 'matrix', 'the q queries, each [u, v]'),
    ],
    ret: 'intLines',
    retDoc: 'the lowest common ancestor of each query pair, in order',
  },
  'gas-station': {
    steps: [{ ints: ['n'] }, { arr: 'gas' }, { arr: 'cost' }],
    params: [
      p('gas', 'ints', 'the fuel sold at each of the n stations'),
      p('cost', 'ints', 'the fuel needed to drive from each station to the next'),
    ],
    ret: 'int',
    retDoc: 'the smallest starting index that completes the circle, or -1',
  },
  'max-product-subarray': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers')],
    ret: 'int',
    retDoc: 'the largest product of a non-empty block of consecutive elements',
  },
  'longest-subarray-diff': {
    steps: [{ ints: ['n', 'k'] }, { arr: 'a' }],
    params: [
      p('a', 'ints', 'the n readings'),
      p('k', 'int', 'the largest allowed difference between the maximum and minimum of a block'),
    ],
    ret: 'int',
    retDoc: 'the length of the longest calm block',
  },
  'pattern-occurrences': {
    steps: [{ line: 't' }, { line: 'p' }],
    params: [p('t', 'str', 'the text'), p('p', 'str', 'the pattern')],
    ret: 'int',
    retDoc: 'the number of positions where p occurs in t (overlaps count)',
  },
  'longest-valid-parens': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'a string of "(" and ")"')],
    ret: 'int',
    retDoc: 'the length of the longest well-formed substring',
  },
  'lcs-length': {
    steps: [{ line: 'a' }, { line: 'b' }],
    params: [p('a', 'str', 'the first string'), p('b', 'str', 'the second string')],
    ret: 'int',
    retDoc: 'the length of their longest common subsequence',
  },
  'min-palindrome-cuts': {
    steps: [{ line: 's' }],
    params: [p('s', 'str', 'a string of lowercase letters')],
    ret: 'int',
    retDoc: 'the minimum number of cuts so that every piece is a palindrome',
  },
  'k-edge-shortest-path': {
    steps: [{ ints: ['n', 'm', 'k'] }, { matrix: 'flights', rows: 'm' }],
    params: [
      p('n', 'int', 'the number of cities'),
      p('flights', 'matrix', 'the m one-way flights, each [u, v, w]'),
      p('k', 'int', 'the most flights you may use'),
    ],
    ret: 'int',
    retDoc: 'the minimum cost from city 1 to city n using at most k flights, or -1',
  },
  'scc-count': {
    steps: [{ ints: ['n', 'm'] }, { matrix: 'roads', rows: 'm' }],
    params: [
      p('n', 'int', 'the number of junctions'),
      p('roads', 'matrix', 'the m directed roads, each [u, v]'),
    ],
    ret: 'ints',
    retDoc: 'two values: [the number of groups, the size of the largest group]',
  },
  'bridge-count': {
    steps: [{ ints: ['n', 'm'] }, { matrix: 'cables', rows: 'm' }],
    params: [
      p('n', 'int', 'the number of servers'),
      p('cables', 'matrix', 'the m two-way cables, each [u, v]'),
    ],
    ret: 'int',
    retDoc: 'the number of critical cables (bridges)',
  },
  'count-paths-dag': {
    steps: [{ ints: ['n', 'm'] }, { matrix: 'dependencies', rows: 'm' }],
    params: [
      p('n', 'int', 'the number of stages'),
      p('dependencies', 'matrix', 'the m one-way dependencies, each [u, v]; the graph is acyclic'),
    ],
    ret: 'int',
    retDoc: 'the number of routes from stage 1 to stage n, modulo 10^9 + 7',
  },
  'range-update-queries': {
    steps: [{ ints: ['n', 'q'] }, { arr: 'a' }, { matrix: 'ops', rows: 'q' }],
    params: [
      p('a', 'ints', 'the n initial scores'),
      p(
        'ops',
        'matrix',
        'the q operations: [1, i, v] adds v to player i, [2, l, r] asks for the sum of players l..r (1-indexed)',
      ),
    ],
    ret: 'intLines',
    retDoc: 'the answer to each [2, l, r] operation, in order',
  },
  'median-two-sorted': {
    steps: [{ ints: ['n', 'm'] }, { arr: 'a' }, { arr: 'b' }],
    params: [
      p('a', 'ints', 'the n numbers of the first sorted list'),
      p('b', 'ints', 'the m numbers of the second sorted list'),
    ],
    ret: 'half',
    retDoc:
      'the median of the merged list: a whole number, or a number ending in .5 (return a float / double)',
  },
  'lis-count': {
    steps: [{ ints: ['n'] }, { arr: 'a' }],
    params: [p('a', 'ints', 'the n integers')],
    ret: 'ints',
    retDoc:
      'two values: [the length of the longest strictly increasing subsequence, how many there are modulo 10^9 + 7]',
  },
  'tsp-small': {
    steps: [{ ints: ['n'] }, { matrix: 'd', rows: 'n' }],
    params: [
      p(
        'd',
        'matrix',
        'the n × n cost matrix: d[i][j] is the cost of driving from city i + 1 to city j + 1',
      ),
    ],
    ret: 'int',
    retDoc:
      'the minimum cost of a round trip that starts and ends in city 1 and visits every city once',
  },
  'weighted-intervals': {
    steps: [{ ints: ['n'] }, { matrix: 'requests', rows: 'n' }],
    params: [p('requests', 'matrix', 'the n booking requests, each [start, end, payment]')],
    ret: 'int',
    retDoc: 'the maximum total payment from non-overlapping accepted requests',
  },
};

// ---- types per language ---------------------------------------------------------------------

const PY_TY: Record<Ty, string> = {
  int: 'int',
  str: 'str',
  ints: 'List[int]',
  strs: 'List[str]',
  matrix: 'List[List[int]]',
};
const CPP_TY: Record<Ty, string> = {
  int: 'long long',
  str: 'string',
  ints: 'vector<long long>',
  strs: 'vector<string>',
  matrix: 'vector<vector<long long>>',
};
const PY_RET: Record<Ret, string> = {
  int: 'int',
  bool: 'bool',
  str: 'str',
  ints: 'List[int]',
  maybeInt: 'Optional[int]',
  intLines: 'List[int]',
  strLines: 'List[str]',
  intervals: 'List[List[int]]',
  half: 'float',
};
const CPP_RET: Record<Ret, string> = {
  int: 'long long',
  bool: 'bool',
  str: 'string',
  ints: 'vector<long long>',
  maybeInt: 'optional<long long>',
  intLines: 'vector<long long>',
  strLines: 'vector<string>',
  intervals: 'vector<vector<long long>>',
  half: 'double',
};
const CPP_DEFAULT: Record<Ret, string> = {
  int: '0',
  bool: 'false',
  str: '""',
  ints: '{}',
  maybeInt: 'nullopt',
  intLines: '{}',
  strLines: '{}',
  intervals: '{}',
  half: '0',
};

// ---- starter code ---------------------------------------------------------------------------

const NOTE = 'The input is read and the answer is printed for you: just implement solve.';

function pythonStarter(sig: Signature): string {
  const used = new Set<string>();
  for (const t of [...sig.params.map((x) => PY_TY[x.ty]), PY_RET[sig.ret]])
    for (const w of ['List', 'Optional']) if (t.includes(w)) used.add(w);
  const imports = used.size ? `from typing import ${[...used].sort().join(', ')}\n\n` : '';
  const args = sig.params.map((x) => `${x.name}: ${PY_TY[x.ty]}`).join(', ');
  const docs = [
    `# ${NOTE}`,
    ...sig.params.map((x) => `# ${x.name}: ${x.doc}`),
    `# Return ${sig.retDoc}.`,
  ].join('\n');
  return `${imports}${docs}\ndef solve(${args}) -> ${PY_RET[sig.ret]}:\n    # your code here\n    pass\n`;
}

function cppStarter(sig: Signature): string {
  const args = sig.params.map((x) => `${CPP_TY[x.ty]} ${x.name}`).join(', ');
  const docs = [
    `// ${NOTE}`,
    ...sig.params.map((x) => `// ${x.name}: ${x.doc}`),
    `// Return ${sig.retDoc}.`,
  ].join('\n');
  return `#include <bits/stdc++.h>\nusing namespace std;\n\n${docs}\n${CPP_RET[sig.ret]} solve(${args}) {\n    // your code here\n    return ${CPP_DEFAULT[sig.ret]};\n}\n`;
}

export function starterCodeFor(slug: string): Record<Language, string> | null {
  const sig = SIGNATURES[slug];
  return sig ? { python: pythonStarter(sig), cpp: cppStarter(sig) } : null;
}

/** The "### Function" section appended to a statement: what `solve` receives and returns. */
export function functionSection(slug: string): string {
  const sig = SIGNATURES[slug];
  if (!sig) return '';
  const args = sig.params.map((x) => x.name).join(', ');
  return [
    '### Function',
    `Implement \`solve(${args})\`. The input is parsed and the answer printed for you; the samples above show the raw input text, and your function receives it already parsed.`,
    ...sig.params.map((x) => `- \`${x.name}\`: ${x.doc}`),
    `- returns: ${sig.retDoc}`,
  ].join('\n');
}

// ---- hidden driver --------------------------------------------------------------------------

/**
 * A full program that reads stdin and prints by itself (the older style, and every reference solution in the
 * tests) is judged as written; only a bare `solve` function gets the driver.
 */
export function isFullProgram(language: Language, code: string): boolean {
  if (language === 'cpp') return /\bmain\s*\(/.test(code);
  if (/sys\.stdin|\binput\s*\(|open\(\s*0\s*\)/.test(code)) return true;
  // No solve() but it prints: a plain script, not a half-written function.
  return !/\bdef\s+solve\s*\(|\bsolve\s*=/.test(code) && /\bprint\s*\(/.test(code);
}

function pythonDriver(sig: Signature): string {
  const read = sig.steps.map((s) => {
    if ('ints' in s) return `${s.ints.join(', ')}, = map(int, _next().split())`;
    if ('arr' in s) return `${s.arr} = list(map(int, _next().split()))`;
    if ('line' in s) return `${s.line} = _next().strip()`;
    if ('grid' in s) return `${s.grid} = [_next().strip() for _ in range(${s.rows})]`;
    return `${s.matrix} = [list(map(int, _next().split())) for _ in range(${s.rows})]`;
  });
  const out: Record<Ret, string[]> = {
    int: ['print(_r)'],
    str: ['print(_r)'],
    bool: ['print("YES" if _r else "NO")'],
    maybeInt: ['print("NONE" if _r is None else _r)'],
    ints: ['print(" ".join(map(str, _r)))'],
    intLines: ['print("\\n".join(map(str, _r)))'],
    strLines: ['print("\\n".join(map(str, _r)))'],
    intervals: ['print(len(_r))', 'print("\\n".join(f"{x[0]} {x[1]}" for x in _r))'],
    half: ['print(int(_r) if _r == int(_r) else f"{_r:.1f}")'],
  };
  const body = [
    'import sys',
    '_lines = sys.stdin.read().split("\\n")',
    '_pos = 0',
    'def _next():',
    '    nonlocal _pos',
    '    s = _lines[_pos] if _pos < len(_lines) else ""',
    '    _pos += 1',
    '    return s',
    ...read,
    `_r = solve(${sig.params.map((x) => x.name).join(', ')})`,
    ...out[sig.ret],
  ];
  return `\n\n# ---- grader: reads the input and prints the answer (not part of your code) ----\ndef _grader_main():\n${body
    .map((l) => `    ${l}`)
    .join('\n')}\n\n\n_grader_main()\n`;
}

const CPP_HELPERS = `
#include <bits/stdc++.h>
namespace grader_ {
template <class T> struct is_vec : std::false_type {};
template <class T, class A> struct is_vec<std::vector<T, A>> : std::true_type {};
// Copies a parsed value into whatever type the player chose (int or long long, vector<int> or vector<long long>, ...).
template <class T, class S> void cv(T& dst, const S& src) {
  if constexpr (is_vec<T>::value) {
    dst.clear();
    dst.reserve(src.size());
    for (const auto& e : src) { typename T::value_type x{}; cv(x, e); dst.push_back(std::move(x)); }
  } else if constexpr (std::is_arithmetic_v<T>) {
    dst = static_cast<T>(src);
  } else {
    dst = src;
  }
}
template <class F> struct fn_args;
template <class R, class... A> struct fn_args<R (*)(A...)> { using type = std::tuple<std::decay_t<A>...>; };
template <class V> void put_row(const V& v) {
  for (size_t i = 0; i < v.size(); ++i) { if (i) std::cout << ' '; std::cout << +v[i]; }
  std::cout << '\\n';
}
}  // namespace grader_
`;

function cppDriver(sig: Signature): string {
  const decl: string[] = [];
  for (const s of sig.steps) {
    if ('ints' in s) {
      decl.push(
        `long long ${s.ints.join(' = 0, ')} = 0;`,
        `{ auto h = _ints(_next()); ${s.ints.map((v, i) => `if (h.size() > ${i}) ${v} = h[${i}];`).join(' ')} }`,
      );
    } else if ('arr' in s) decl.push(`std::vector<long long> ${s.arr} = _ints(_next());`);
    else if ('line' in s) decl.push(`std::string ${s.line} = _next();`);
    else if ('grid' in s)
      decl.push(
        `std::vector<std::string> ${s.grid}; for (long long i = 0; i < ${s.rows}; ++i) ${s.grid}.push_back(_next());`,
      );
    else
      decl.push(
        `std::vector<std::vector<long long>> ${s.matrix}; for (long long i = 0; i < ${s.rows}; ++i) ${s.matrix}.push_back(_ints(_next()));`,
      );
  }
  const fill = sig.params.map((x, i) => `grader_::cv(std::get<${i}>(_args), ${x.name});`);
  const out: Record<Ret, string> = {
    int: 'std::cout << _r << "\\n";',
    str: 'std::cout << _r << "\\n";',
    bool: 'std::cout << (_r ? "YES" : "NO") << "\\n";',
    maybeInt: 'if (_r) std::cout << *_r; else std::cout << "NONE"; std::cout << "\\n";',
    ints: 'grader_::put_row(_r);',
    intLines: 'for (const auto& x : _r) std::cout << x << "\\n";',
    strLines: 'for (const auto& x : _r) std::cout << x << "\\n";',
    intervals:
      'std::cout << _r.size() << "\\n"; for (const auto& x : _r) std::cout << x[0] << " " << x[1] << "\\n";',
    half: '{ double _d = static_cast<double>(_r); if (_d == std::floor(_d)) std::cout << static_cast<long long>(_d); else std::cout << std::fixed << std::setprecision(1) << _d; std::cout << "\\n"; }',
  };
  return `\n${CPP_HELPERS}
// ---- grader: reads the input and prints the answer (not part of your code) ----
int main() {
  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);
  auto _next = []() { std::string s; std::getline(std::cin, s); if (!s.empty() && s.back() == '\\r') s.pop_back(); return s; };
  auto _ints = [](const std::string& l) { std::vector<long long> v; std::istringstream is(l); long long x; while (is >> x) v.push_back(x); return v; };
  ${decl.join('\n  ')}
  grader_::fn_args<decltype(&solve)>::type _args;
  ${fill.join('\n  ')}
  auto _r = std::apply(solve, _args);
  ${out[sig.ret]}
  return 0;
}
`;
}

/** What the judge actually compiles or runs: the player's code with the hidden driver appended. */
export function withDriver(slug: string, language: Language, code: string): string {
  const sig = SIGNATURES[slug];
  if (!sig || isFullProgram(language, code)) return code;
  return code + (language === 'python' ? pythonDriver(sig) : cppDriver(sig));
}
