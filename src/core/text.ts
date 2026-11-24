/** Name normalization shared by the audit, the geocoder build and the in-app search. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Search key: normalized name with apostrophes and punctuation turned into spaces ("Sant'Ambrogio" → "sant ambrogio"). */
export function searchKey(s: string): string {
  return normalizeName(s)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Italian street types a user may leave out (SPEC §9.1). Longest first so "via privata" wins over "via". */
export const STREET_TYPES = [
  'via privata', 'strada privata', 'sottopassaggio', 'passaggio', 'piazzale', 'piazzetta', 'piazza', 'viale', 'via',
  'corso', 'largo', 'vicolo', 'strada', 'alzaia', 'ripa', 'bastioni', 'galleria', 'foro', 'ponte', 'cortile', 'rotonda',
  'scalinata', 'salita', 'contrada', 'stradone', 'vialetto', 'lungo',
];

/** Key without its leading street type, or null when it has none (or nothing would remain). */
export function stripStreetType(key: string): string | null {
  for (const t of STREET_TYPES) {
    if (key.startsWith(t + ' ') && key.length > t.length + 1) return key.slice(t.length + 1);
  }
  return null;
}

const WORDS = [
  '', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici',
  'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove', 'venti', 'ventuno', 'ventidue', 'ventitre',
  'ventiquattro', 'venticinque', 'ventisei', 'ventisette', 'ventotto', 'ventinove', 'trenta', 'trentuno',
];
const ROMAN = [
  '', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii',
  'xix', 'xx', 'xxi', 'xxii', 'xxiii', 'xxiv', 'xxv', 'xxvi', 'xxvii', 'xxviii', 'xxix', 'xxx', 'xxxi',
];
const AFTER_NUMBER = new Set([
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre', 'giornate',
]);

function numberValue(token: string): number {
  if (token === 'primo') return 1;
  const d = /^\d{1,2}$/.test(token) ? Number(token) : -1;
  if (d >= 1 && d <= 31) return d;
  const w = WORDS.indexOf(token);
  if (w > 0) return w;
  const r = ROMAN.indexOf(token);
  return r > 0 ? r : -1;
}

/**
 * Variants of a key where a day number before a month (or "giornate") is written in the two other
 * forms: "piazza ventiquattro maggio" → "piazza 24 maggio", "piazza xxiv maggio".
 */
export function numberVariants(key: string): string[] {
  const tokens = key.split(' ');
  const out: string[] = [];
  tokens.forEach((t, i) => {
    const next = tokens[i + 1];
    if (!next || !AFTER_NUMBER.has(next)) return;
    const n = numberValue(t);
    if (n < 0) return;
    for (const form of [String(n), WORDS[n]!, ROMAN[n]!]) {
      if (form === t) continue;
      out.push([...tokens.slice(0, i), form, ...tokens.slice(i + 1)].join(' '));
    }
  });
  return out;
}

/** Optimal string alignment distance, stopping early above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  let prev2 = new Array<number>(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[n]!;
}
