# AEO / SEO Visibility Knowledge Base

**Purpose.** This is the reference Sitecraft uses when it is asked to make AEO or SEO
suggestions or edits to a site it is installed on. It defines what we check for, what we
fix, how we fix it, and the boundaries we never cross.

**Scope constraint that governs everything below.** Sitecraft works *within the copy that
already exists on the host website*. It restructures, tightens, and marks up what is
already there. It does not invent facts, claims, statistics, credentials, prices, or
review counts. Every rule in this document is written to be executable under that
constraint.

---

## 0. Provenance — read this first

This knowledge base was assembled by auditing the ReadTomato codebase directly. It is
honest about which parts are established practice and which parts are new.

| Source | What it gave us | Status |
|---|---|---|
| `rt-website-2026/site/blog/*.html` | The 9-field metadata standard, verbatim, written into the markup as locked HTML comments | **Ours, as-built** |
| `rt-website-2026/site/blog/*.html` + `about/client-testimonials.html` | Article / BreadcrumbList / Organization / AggregateRating / Person schema patterns | **Ours, as-built** |
| Blog H2 and body structure across 7 posts | The answer-shaped content pattern | **Ours, as-built (consistent enough to be a rule)** |
| `RT WEB - design doctrine.md` | Writing principles: compression, fragments, no verbal clutter | **Ours, written doctrine** |
| `products/{hot-take-engine,instant-take,web-reno}.html` | The stated service promise — what we tell clients we do | **Ours, stated** |
| Severity model, FAQ/Service/LocalBusiness schema, execution workflow, guardrails | Not present anywhere in the codebase | **New — proposed here to close gaps** |

**There is no pre-existing formal AEO/SEO framework, rubric, or guidelines document
anywhere in the repositories reachable from this session.** The standard exists as
*convention encoded in markup* — disciplined and consistent, but never written down as a
spec. This document is the first time it has been. Anything marked **New** above is my
proposal, not established ReadTomato doctrine, and should be reviewed before it is
treated as canon.

---

## 1. The model

Two surfaces, one body of work.

**SEO** — being retrievable and rankable by a crawler. Titles, descriptions, canonicals,
headings, internal links, crawl signals.

**AEO** — being *quotable* by an answer engine (ChatGPT, Perplexity, Google AI Overviews).
Answer engines lift short, self-contained chunks. They do not lift vibes.

The doctrine already in the codebase states the AEO thesis directly:

> "AI systems pull short chunks that read like clean definitions. Build pages that answer
> one question at a time. Use clear headers and short paragraphs. When you lead with
> structure, you increase your odds of being cited."

> "If your advice could apply to any city, AI will not pick you."

> "AI search is not the enemy. It is a new distribution layer."

The operating principle that falls out of this: **structure is the product.** Most AEO
work is not new writing. It is cutting existing copy into retrievable units, labelling
them honestly, and making the entity behind them unambiguous. That is exactly the work
Sitecraft can do inside existing copy.

---

## 2. What we check for

52 checks in five layers. Machine-readable definitions with detection logic and severity
live in [`rubric.json`](./rubric.json); this section is the human-readable rationale.

### Layer 1 — Metadata integrity (the locked 9-field standard)

This is the one genuinely locked standard we have. It appears verbatim in every blog post:

> `YOAST CORE METADATA — every blog post must have all 9 fields below. Per-post values;
> structure is locked.`

| # | Field | Rule (as written in our own markup) |
|---|---|---|
| 1 | SEO title | 50–60 chars, keyword near front |
| 2 | Meta description | 140–155 chars, focus keyword once |
| 3 | Slug / canonical | short, lowercase, keyword-rich |
| 4 | Focus keyphrase | exactly one primary phrase per page |
| 5 | Related keyphrases | supporting variations + intent terms |
| 6 | Excerpt | 20–30 words |
| 7 | Category | one primary bucket |
| 8 | Tags | 5–8 terms |
| 9 | Featured image alt | describes naturally + names topic |

Plus the supporting block that ships alongside it every time: `robots`, `author`,
`keywords`, full Open Graph, Twitter card.

**We check:** all 9 present; each within its stated bound; focus keyphrase actually
appears in title, description, H1 and first 100 words; canonical is absolute, self-
referencing and trailing-slash consistent; OG/Twitter titles and images resolve and match
the page.

### Layer 2 — Structured data

Types we actually deploy, with the pattern we deploy them in:

- **Article** — `@id` anchored `#article`, headline, description, ImageObject (1200×630),
  datePublished + dateModified, author as `@type: Person` with its own `@id` and
  `worksFor` pointing at the org node, publisher referencing `@id:
  https://readtomato.com/#organization`, `mainEntityOfPage`, articleSection, keywords,
  wordCount, inLanguage.
- **BreadcrumbList** — Home → Section → Page, position-ordered, last item without `item`.
- **Organization** — `@id` `#organization`, name, alternateName, url, logo, telephone,
  email, description.
- **AggregateRating + Review** — on the testimonials page; 102 Review nodes each with
  Rating and Person author.

**We check:** JSON-LD parses; `@id` graph is internally consistent (author/publisher refs
resolve to real nodes); no orphan or duplicated `@id`; dates ISO-8601 with offset; image
dimensions declared; `dateModified` ≥ `datePublished`; schema claims match visible page
content.

> **Hard rule on ratings.** `AggregateRating` and `Review` markup must correspond to
> reviews that genuinely exist and are visible on the page. Sitecraft must **never**
> generate, extrapolate, or inflate rating values or review counts. This is the single
> highest-risk area in the whole rubric — fabricated review markup is a manual-action
> offence and a legal exposure, not merely a ranking risk.

### Layer 3 — Answer-shaped content (the AEO core)

Derived from the consistent structure across all 7 blog posts:

- **H2s are declarative claim sentences, not labels.** Real examples: *"Your Local
  Authority Must Look Quotable, Not Pretty"*, *"Proof Beats Promises Because It Shortens
  Research"*, *"Transparent Pricing Lowers Fear Of Regret"*. Each H2 is a standalone
  assertion an engine can quote. This is the highest-leverage AEO pattern we have and it
  is applied with real discipline.
- **One idea per section.** "Teach one thing. Then stop."
- **Short paragraphs, 2–4 sentences.** Chunk-sized by design.
- **A direct-answer opening.** Lead paragraph states the shift in two or three sentences
  before any elaboration.
- **Specificity as a moat.** Name the neighbourhood, the commute, the tradeoff.
- **A numbered execution block near the end.** Every post has one — "Do This 5-Step
  'AI-Ready' Update This Week", "A Trust Stack You Can Publish This Week", "A Phone-Only
  Filming Checklist".
- **Target answer length 40–60 words** for anything FAQ-shaped. Stated explicitly in our
  own copy: *"Rewrite your top 10 FAQs as 40–60 word answers."*
- **A repeatable page template.** Our own stated four-part unit: *"Who it fits," "What it
  costs," "What surprises people," "Next step."*

**We check:** exactly one H1; no heading level skips; H2s parse as claims rather than
one-word labels; paragraphs under ~80 words; FAQ answers in the 40–60 word band; a
definition or direct answer inside the first 100 words; presence of at least one
list/steps block on long-form pages; no orphaned "click here" anchors.

### Layer 4 — Entity & trust integrity (E-E-A-T)

The doctrine leans hard on proof: *"Proof beats promises"*, *"Deep FAQs signal honesty"*,
*"Use AI, but keep human ownership visible."*

**We check:** author byline present and matching the Person schema; author bio describes
the *actual named author*; author `@id` stable across posts; publisher/org details
consistent site-wide (name, phone, email, logo); claims that imply data carry a visible
source; testimonials attributed to a real named person.

### Layer 5 — Technical & crawl hygiene

**We check:** `lang` attribute; one canonical per page; robots directives sane and not
accidentally `noindex`; image `alt` present and matching the image actually rendered; OG
image resolves; internal links resolve; heading/anchor IDs unique; page reachable from
nav or a hub page.

---

## 3. What we fix — the action catalogue

Every action is classified by how far it goes. This classification is what makes Sitecraft
safe to run semi-autonomously.

### Class A — Autonomous (mechanical, reversible, no new claims)

Sitecraft may apply these without asking.

| Action | Detail |
|---|---|
| Tighten title to 50–60 chars | Reorder and trim existing words; keyword to front; keep brand suffix |
| Rewrite description to 140–155 | Compose **only** from sentences already on the page |
| Add self-referencing canonical | Derive from the page's own URL |
| Add missing OG/Twitter block | Mirror the page's existing title/description/hero image |
| Add BreadcrumbList schema | Derive from the site's real nav path |
| Add Article/WebPage schema | Populate strictly from on-page values |
| Fix heading level skips | Re-tag; never re-word |
| Split over-long paragraphs | Break at existing sentence boundaries only |
| Fix alt text that mismatches its image | Describe the image actually referenced |
| Normalise dates to ISO-8601 | Format change only |
| Fix `@id` graph inconsistencies | Repoint refs to existing nodes |

### Class B — Propose-with-diff (rewording; needs a human yes)

Sitecraft drafts, shows a before/after, and waits.

| Action | Detail |
|---|---|
| Convert label H2s into claim H2s | *"Our Process"* → *"Our Process Removes The Three Delays That Cost You Patients"* — only if the page already supports the claim |
| Reshape an FAQ answer to 40–60 words | Compress existing answer; no new facts |
| Add a direct-answer lead paragraph | Assembled from content already further down the page |
| Restructure a section into the four-part unit | Who it fits / What it costs / What surprises people / Next step |
| Convert prose into a numbered steps block | Steps must already exist in the prose |
| Add FAQPage schema | Only over Q&A **visibly present** on the page |
| Tighten copy per the writing doctrine | Remove filler, throat-clearing, agency cliché |

### Class C — Flag only (never auto-edit)

Sitecraft reports and stops.

- Any missing fact — price, credential, statistic, service area, hours
- Any `AggregateRating` / `Review` / rating value or count
- Author identity, credentials, or bio corrections
- Claims needing legal or medical review (dental, medspa, senior living especially)
- Canonical changes that would redirect or de-index an existing ranking page
- Anything requiring a new page, a URL change, or content the site does not have

---

## 4. How we do it — execution rules

1. **Read before write.** Parse the page, build a model of its existing claims, then act
   only within that model.
2. **Copy-bound sourcing.** Every word Sitecraft emits into user-visible content must be
   traceable to copy already on the page. When it cannot be, the action is Class C.
3. **Structure before prose.** Prefer re-tagging, splitting and marking up over rewriting.
   The cheapest AEO win is nearly always a heading fix or a schema addition, not new text.
4. **One page, one focus keyphrase.** If two pages compete for the same phrase, flag the
   cannibalisation; do not silently re-target one.
5. **Preserve voice.** The doctrine is explicit: compressed, high-signal, fragments over
   blocks, no inflated claims, no trend language. Rewrites that read like generic SEO copy
   are failures even when they score well.
6. **Never trade honesty for a check.** A page that scores 100% on the rubric while
   overstating what the business does is a worse outcome than a page that scores 60%.
7. **Diff, don't replace.** Every change is a minimal, reviewable diff with a stated
   reason and the check ID it satisfies.
8. **Idempotent.** Re-running Sitecraft on a fixed page produces no further changes.

### Severity model

| Severity | Meaning | Examples |
|---|---|---|
| **P0** | Actively harmful or deceptive | Fabricated review markup; accidental `noindex`; schema contradicting visible content |
| **P1** | Blocks visibility | No canonical; broken JSON-LD; missing/duplicate H1; missing title or description |
| **P2** | Materially weakens AEO | Label H2s; wall-of-text paragraphs; no direct answer; FAQ present but unmarked |
| **P3** | Polish | Length bands; tag counts; OG image dimensions |

Order of work: P0 → P1 → P2 → P3. Within a tier, Class A before Class B.

### Per-page workflow

```
1. PARSE      extract metadata, schema graph, heading tree, copy inventory
2. AUDIT      run all 52 checks → findings with severity + check ID
3. CLASSIFY   assign each finding an action class (A / B / C)
4. APPLY      execute Class A automatically
5. PROPOSE    present Class B as before/after diffs
6. FLAG       report Class C with the reason it cannot be auto-fixed
7. VERIFY     re-parse; confirm JSON-LD still valid, copy claims unchanged, no regressions
8. REPORT     what changed, what needs a decision, what is blocked
```

---

## 5. Guardrails — the never list

- Never invent a fact, number, price, credential, date, or location.
- Never create or alter `AggregateRating`, `Review`, rating values, or review counts.
- Never add schema describing something not visible on the page.
- Never change an author's identity, bio, or credentials.
- Never add `noindex`, or change a canonical in a way that de-indexes a live page.
- Never keyword-stuff. One focus keyphrase, used naturally.
- Never delete existing copy to hit a length target — compress instead.
- Never let a rubric score justify a claim the business cannot support.

---

## 6. Worked example — the ReadTomato site audited against its own rubric

Running this rubric against `rt-website-2026` shows why the codified version is needed. The
standard is excellent where it is applied and simply absent everywhere else.

**Coverage: 8 of 26 pages instrumented.** All 7 blog posts plus the testimonials page carry
canonical + OG + JSON-LD + robots. The other 18 — every market page, every product page,
every partner page, the homepage, contact, and both index pages — carry a bare `<title>`
and `<meta name="description">` and nothing else. No canonical, no Open Graph, no
structured data.

That includes the commercial pages. `products/web-reno.html` sells AI visibility to dental
practices — *"AI visibility structure added so ChatGPT and Google recommend your
practice"* — and has no structured data of its own.

**Length compliance against the locked 9-field bounds: 1 of 26 pages passes both.** Only
`products/web-reno.html` (54-char title, 154-char description) is inside both bands. Blog
titles run 64–77 chars against a stated 50–60. Marketing page titles run short (28–42).
Descriptions range 113–193 against a stated 140–155.

**No FAQPage schema anywhere on the site** — despite our own doctrine naming deep FAQs as a
primary AEO and trust mechanism, and instructing clients to rewrite their top 10 FAQs as
40–60 word answers.

**Two content-integrity defects, both P1:**

1. `blog/ai-search-for-seattle-real-estate-leads.html:563-565` — the hero image `src` and
   `alt` are both carried over from the *trust-in-high-ticket-decisions* post. The alt text
   reads "Trust in high-ticket decisions wins the deal" on a page about Seattle AI search,
   and it contradicts the `og:image` and Article schema, which both correctly point at
   `RT-BLOG-ai-answers-win-first-click.webp`.

2. The author bio beginning *"Marshall leads new business development and partnerships…"*
   appears under **six different bylines** — Jim Cronin, Ashley Alexander, Rob Saxe, Sherry
   Sanchez, Joshua Marshall and Marshall Gill. Each post carries correct `Person` schema
   with a distinct `@id`, so the structured data and the visible bio actively contradict
   each other on five of six posts. This is the exact E-E-A-T failure the doctrine warns
   against — *"keep human ownership visible"* — and it is machine-readable.

**What's genuinely strong:** 85 of 85 images carry alt text. The answer-shaped H2 discipline
holds across all 7 posts without exception. The `@id` graph linking author → organization is
correctly formed. Where the standard is applied, it is applied well.

The pattern is consistent: **the discipline lives in the blog pipeline and stops at its
edge.** That is precisely the gap Sitecraft is built to close.

---

## 7. Files

- [`README.md`](./README.md) — this document
- [`rubric.json`](./rubric.json) — all 52 checks, machine-readable: id, layer, severity,
  action class, detection logic, fix strategy
