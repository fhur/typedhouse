/** Palette search: case-insensitive subsequence match with prefix and word-start bonuses. DOM-free. */
export interface Match { score: number; indices: number[] }

const isWordStart = (text: string, i: number) =>
  i === 0 || !/[a-z0-9]/i.test(text[i - 1]!) || (/[a-z]/.test(text[i - 1]!) && /[A-Z]/.test(text[i]!));

/**
 * Scores `text` against `query`, or `undefined` when the query is not a subsequence. An empty query matches
 * everything with score 0. Higher is better: a contiguous match beats a scattered one, a match at the start
 * or at word starts beats one in the middle of a word, and shorter texts win ties.
 */
export function matchScore(query: string, text: string): Match | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const lower = text.toLowerCase();
  // Prefer a contiguous occurrence, at a word start if there is one.
  let at = -1;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + 1)) {
    if (at < 0) at = i;
    if (isWordStart(text, i)) { at = i; break; }
  }
  if (at >= 0) {
    const indices = Array.from({ length: q.length }, (_, k) => at + k);
    return { score: 100 + q.length * 3 + (at === 0 ? 50 : isWordStart(text, at) ? 25 : 0) - text.length / 100, indices };
  }
  // Otherwise a subsequence, taking word starts when they are the next match.
  const indices: number[] = [];
  let from = 0;
  for (const c of q) {
    let pick = -1;
    for (let i = lower.indexOf(c, from); i >= 0; i = lower.indexOf(c, i + 1)) {
      if (pick < 0) pick = i;
      if (isWordStart(text, i)) { pick = i; break; }
      if (i > pick + 8) break; // don't jump far for a word start
    }
    if (pick < 0) return undefined;
    indices.push(pick);
    from = pick + 1;
  }
  let score = 0;
  indices.forEach((i, k) => {
    score += 1;
    if (isWordStart(text, i)) score += 8;
    if (k > 0 && i === indices[k - 1]! + 1) score += 4;
    else if (k > 0) score -= Math.min(3, (i - indices[k - 1]! - 1) / 4);
  });
  if (indices[0] === 0) score += 10;
  return { score: score - text.length / 100, indices };
}

/** Matching items, best first; ties keep their original order. */
export function rank<T>(items: readonly T[], query: string, text: (item: T) => string): { item: T; match: Match }[] {
  return items
    .map((item, order) => ({ item, order, match: matchScore(query, text(item)) }))
    .filter((r): r is { item: T; order: number; match: Match } => r.match !== undefined)
    .sort((a, b) => b.match.score - a.match.score || a.order - b.order)
    .map(({ item, match }) => ({ item, match }));
}
