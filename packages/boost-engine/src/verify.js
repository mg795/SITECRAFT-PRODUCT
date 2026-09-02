/**
 * Copy-bound verifier.
 *
 * The rubric's central constraint is that Sitecraft may only emit words
 * traceable to copy already on the page. A prompt asking a model to obey
 * that is not a guarantee. This module turns it into a mechanical check
 * that runs on every proposal before it is ever shown to a client.
 *
 * A proposal that fails here is dropped or demoted to class C ("needs
 * you") — never rendered as an Upgrade button.
 */

/** Function words may be introduced freely: restructuring needs connective tissue. */
const FUNCTION_WORDS = new Set(`
a an the and or but nor so yet for of to in on at by from with without into onto
is are was were be been being am do does did done has have had having
it its this that these those there here they them their we us our you your
i me my he him his she her as if then than when while because since although
though while about above across after against along among around before behind
below beneath beside between beyond during except inside near outside over
through toward under until up upon within not no nor only just also very
can could may might must shall should will would
which who whom whose what where why how
each every both few more most other some such own same
one two three four five six seven eight nine ten
`.trim().split(/\s+/));

/** Anything with a digit is a factual claim: prices, counts, ratings, dates. */
const hasDigit = (w) => /\d/.test(w);

/** Normalize a token: lowercase, strip surrounding punctuation and quotes. */
function normalize(word) {
  return word
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%$]+$/gu, '');
}

/**
 * Light suffix stripping so "aligners" matches "aligner" and "milled"
 * matches "mill". Deliberately conservative — it is better to raise a
 * false violation a human dismisses than to let a fabrication through.
 */
function stem(word) {
  if (hasDigit(word)) return word;          // never stem a number
  let w = word;
  for (const suf of ['ations', 'ation', 'ingly', 'edly', 'ings', 'ing', 'ies', 'ied', 'es', 'ed', 'ly', 's']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      if (suf === 'ies') w += 'y';
      break;
    }
  }
  // Collapse a doubled final consonant left by the suffix ("fitted" -> "fitt"
  // -> "fit"), so it matches the base form the page actually uses.
  if (/([bdfglmnprt])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Tokenize prose into normalized, non-empty tokens. */
export function tokens(text) {
  return String(text || '')
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean);
}

/** Build the set of everything the page is allowed to draw from. */
export function sourceVocabulary(sourceText) {
  const exact = new Set();
  const stems = new Set();
  const numbers = new Set();
  for (const t of tokens(sourceText)) {
    exact.add(t);
    stems.add(stem(t));
    if (hasDigit(t)) numbers.add(t);
  }
  return { exact, stems, numbers };
}

/**
 * Verify that `proposal` introduces no content word or number absent from
 * `sourceText`.
 *
 * @param {string} sourceText  All visible copy on the page (not just the element).
 * @param {string} proposal    The rewrite being offered to the client.
 * @param {object} [opts]
 * @param {string[]} [opts.allow]   Extra permitted words (e.g. the brand name).
 * @param {boolean} [opts.strict]   Disable stemming; require exact matches.
 * @returns {{ok: boolean, violations: Array<{word: string, kind: string}>}}
 */
export function verifyCopyBound(sourceText, proposal, opts = {}) {
  const { allow = [], strict = false } = opts;
  const vocab = sourceVocabulary(sourceText);
  const allowed = new Set(allow.map(normalize).filter(Boolean));
  const allowedStems = new Set([...allowed].map(stem));

  const violations = [];
  const seen = new Set();

  for (const raw of tokens(proposal)) {
    if (seen.has(raw)) continue;
    seen.add(raw);

    if (allowed.has(raw)) continue;

    // Numbers are held to an exact standard, always — no stemming, no
    // function-word exemption. This is what stops a fabricated rating,
    // price, or patient count reaching a client.
    if (hasDigit(raw)) {
      if (!vocab.numbers.has(raw)) violations.push({ word: raw, kind: 'number' });
      continue;
    }

    if (FUNCTION_WORDS.has(raw)) continue;
    if (vocab.exact.has(raw)) continue;
    if (!strict && (vocab.stems.has(stem(raw)) || allowedStems.has(stem(raw)))) continue;

    violations.push({ word: raw, kind: 'word' });
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Gate a generated proposal before it becomes a review card.
 *
 * Returns the proposal annotated with its verification result and the
 * action class it is allowed to carry. A proposal that invents a number
 * is never merely downgraded — it is rejected outright, because a
 * fabricated figure is the one failure mode with legal exposure.
 */
export function gateProposal({ sourceText, before, after, checkId, allow = [] }) {
  const result = verifyCopyBound(sourceText, after, { allow });
  const invented = result.violations.filter((v) => v.kind === 'number');

  if (invented.length) {
    return {
      checkId, before, after,
      accepted: false,
      reason: `Rejected: introduces ${invented.length} number(s) not on the page (${invented.map((v) => v.word).join(', ')}).`,
      violations: result.violations,
    };
  }
  if (!result.ok) {
    return {
      checkId, before, after,
      accepted: false,
      reason: `Rejected: introduces wording not traceable to the page (${result.violations.slice(0, 6).map((v) => v.word).join(', ')}).`,
      violations: result.violations,
    };
  }
  return { checkId, before, after, accepted: true, violations: [] };
}
