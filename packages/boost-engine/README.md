# @sitecraft/boost-engine

The audit engine behind the Boost panel. Runs the rubric checks against a page
and gates every proposed rewrite through the copy-bound verifier.

No dependencies. ES modules. `npm test` runs 38 tests with Node's built-in
runner.

```
npm test        # 38 passing
```

## Why it takes a PageModel, not a Document

The engine never touches the DOM. It takes a **PageModel** — a plain object —
so the same checks run in the browser, in a worker, on a server, or in tests
with no DOM at all.

`fromDocument(document)` is the only browser-aware code, and it is thin enough
to rewrite against whatever the host CMS actually gives you. If Sitecraft reads
content through an API rather than the rendered page, write a second adapter
and every check keeps working unchanged.

```js
import { fromDocument, audit, summarize, buildCard } from '@sitecraft/boost-engine';

const page     = fromDocument(document);
const findings = audit(page);          // ordered: P0 first, class A before B
const { auto, review, blocked } = summarize(findings);
```

`summarize` returns exactly the three groups the panel renders:

| Group | Action class | In the panel |
|---|---|---|
| `auto` | A | "Already fixed" — applied without asking |
| `review` | B | "Review" — a before/after card with an Upgrade button |
| `blocked` | C | "Needs you" — reported with the reason it cannot be fixed |

## The verifier is the point

`verifyCopyBound` is what makes this safe to point at a client's live website.

The rubric says Sitecraft may only emit words traceable to copy already on the
page. A prompt asking a model to obey that is not a guarantee. This turns it
into a check:

```js
verifyCopyBound(pageText, 'Same-day crowns and clear aligners for Northgate families');
// → { ok: true, violations: [] }

verifyCopyBound(pageText, 'Rated 4.9 stars by 812 patients');
// → { ok: false, violations: [{ word: '4.9', kind: 'number' },
//                             { word: '812', kind: 'number' }] }
```

Three rules:

1. **Function words are free.** Restructuring needs connective tissue, so
   articles, prepositions and auxiliaries can be introduced.
2. **Content words must trace to the page**, allowing light stemming so
   "aligner" matches "aligners" and "milled" matches "mill". Pass
   `{ strict: true }` to require exact matches.
3. **Numbers are exact, always.** No stemming, no exemption. This is what stops
   a fabricated rating, price, or patient count reaching a client.

`buildCard` is the choke point every proposal passes through:

```js
const card = buildCard(finding, candidateRewrite, page);
// accepted → { ...finding, before, after, runs, retention }
// rejected → { ...finding, actionClass: 'C', rejected: true }  // no `after` to apply
```

A rejected proposal is **demoted to class C, and carries no applyable value** —
it cannot become an Upgrade button by accident. A proposal inventing a number
is rejected outright rather than downgraded, because that is the one failure
mode with legal exposure.

This holds whether the rewrite came from a template or a language model. The
model is never trusted to have obeyed the constraint; it is checked.

> It earns its keep immediately: run against the Boost panel prototype, the
> verifier rejected three of that prototype's own four suggestions — including
> a heading ending "Under One Roof" when "roof" appears nowhere in the page
> copy. All four were rewritten to pass.

## Coverage

27 of the rubric's 52 checks are implemented and tested. See
[COVERAGE.md](./COVERAGE.md) for the full split — what is deterministic, what
needs a model call, and what needs a site-wide crawl. The short version:

- **Tier 1** (implemented): instant, free, run on every edit.
- **Tier 3** (needs a model): `AEO-03` and friends, plus *every* class-B
  rewrite. One call per proposal. Cache against a hash of the page copy.
- **Tier 4** (needs a crawl): belongs in a background site scan, not the edit
  view.

The panel is useful before any model is wired up — 27 checks and every class-A
fix work with the engine alone.

## Files

| Path | What |
|---|---|
| `src/audit.js` | Runner, `fromDocument` adapter, `summarize`, `buildCard` |
| `src/checks.js` | The deterministic checks, grouped by rubric layer |
| `src/verify.js` | Copy-bound verifier and the proposal gate |
| `src/diff.js` | Word-level LCS diff for the before/after card |
| `test/engine.test.js` | 38 tests, including adversarial cases against the verifier |

The rubric these implement is `docs/aeo-seo/rubric.json`; the reasoning behind
it is `docs/aeo-seo/README.md`.
