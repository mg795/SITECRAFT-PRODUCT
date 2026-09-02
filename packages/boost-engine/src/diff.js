/**
 * Word-level diff for the before/after review card.
 *
 * Clients will not read two paragraphs and spot the difference themselves.
 * They need to see what changed, so the panel renders insertions and
 * deletions inline rather than showing two blocks of prose.
 */

/** Split on whitespace but keep the separators, so rejoining is lossless. */
const tokenize = (s) => s.split(/(\s+)/);

/**
 * Longest-common-subsequence diff over word tokens.
 *
 * Returns runs of {op, text} where op is '=' (unchanged), '-' (removed)
 * or '+' (added). Adjacent runs of the same op are merged so the rendered
 * output does not fragment into one <ins> per word.
 *
 * O(n*m) time and memory. Page-level copy is small enough that this is
 * fine; guard with `maxTokens` so a pathological input cannot lock the UI.
 */
export function diffWords(before, after, { maxTokens = 4000 } = {}) {
  const A = tokenize(before);
  const B = tokenize(after);

  // Fall back to a whole-block replace rather than allocating a huge matrix.
  if (A.length * B.length > maxTokens * maxTokens) {
    return [{ op: '-', text: before }, { op: '+', text: after }];
  }

  const n = A.length;
  const m = B.length;

  // lcs[i][j] = length of the LCS of A[i..] and B[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = A[i] === B[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const runs = [];
  const push = (op, text) => {
    const last = runs[runs.length - 1];
    if (last && last.op === op) last.text += text;
    else runs.push({ op, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('=', A[i]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push('-', A[i]); i++; }
    else { push('+', B[j]); j++; }
  }
  while (i < n) push('-', A[i++]);
  while (j < m) push('+', B[j++]);

  return runs;
}

/** Runs that make up the "what it says now" side. */
export const beforeRuns = (runs) => runs.filter((r) => r.op !== '+');

/** Runs that make up the "what it could say" side. */
export const afterRuns = (runs) => runs.filter((r) => r.op !== '-');

/** How much of the original survived, 0..1. Useful for flagging heavy rewrites. */
export function retention(runs) {
  let kept = 0;
  let total = 0;
  for (const r of runs) {
    const n = r.text.trim() ? r.text.trim().split(/\s+/).length : 0;
    if (r.op !== '+') total += n;
    if (r.op === '=') kept += n;
  }
  return total === 0 ? 1 : kept / total;
}
