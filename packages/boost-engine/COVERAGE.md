# Check coverage — what runs where

The 52 rubric checks do not cost the same. Some are a string comparison; some
need a language model; some need a crawl of the whole site. That split drives
the latency and the per-page cost of the Boost panel, so it is worth being
precise about.

**27 of 52 are implemented and tested in this package today.** All of them are
deterministic: no model call, no network, no other pages. They run in
single-digit milliseconds on a page model, which means they can run on every
edit without the client noticing.

## Tier 1 — deterministic, single page (implemented)

Runs locally, instantly, on every keystroke if you want.

`META-01` `META-02` `META-04` `META-05` `META-07` `META-15` `META-16` `META-18`
`SCHEMA-01` `SCHEMA-02` `SCHEMA-03` `SCHEMA-04` `SCHEMA-05` `SCHEMA-08` `SCHEMA-10`
`AEO-01` `AEO-02` `AEO-05` `AEO-07` `AEO-10`
`EEAT-02` `EEAT-04`
`TECH-01` `TECH-02` `TECH-03` `TECH-04` `TECH-07`

Two of these exist because they caught real defects on the ReadTomato site:
`TECH-04` (the same alt text on two different images) and `EEAT-02` (one
biography under six bylines).

## Tier 2 — deterministic, not yet built

No model needed. These are ordinary work, listed roughly by value per hour.

| Check | Why it is not done yet |
|---|---|
| `META-03`, `META-06`, `META-09` | Need a focus-keyphrase source. Either the client declares one or we derive it — that decision is unmade. |
| `META-11`, `META-12`, `META-13`, `META-10` | Excerpt, category, tags. Depend on the host CMS's taxonomy, which differs per install. |
| `META-14` | Alt text *quality* (does it name the topic?) is Tier 3; alt *presence* is already `TECH-03`. |
| `META-17` | Twitter card completeness. Same shape as `META-16`; ten minutes. |
| `SCHEMA-06` | ImageObject dimensions — needs image metadata the page model does not yet carry. |
| `SCHEMA-07` | Schema-vs-visible-content agreement. Partly deterministic (headline vs H1, dates, author name); the semantic half is Tier 3. |
| `META-08` | Slug quality. Flag-only, so low urgency. |

## Tier 3 — needs a language model

These are judgement calls. A regex cannot decide whether a heading makes a
claim or whether advice is generic.

| Check | The judgement |
|---|---|
| `AEO-03` | Is this H2 a quotable claim or a bare label? **The highest-value check in the rubric**, and irreducibly a model call. |
| `AEO-04` | Does the opening actually answer something in the first 100 words? |
| `AEO-06` | Does this section carry more than one idea? |
| `AEO-08` | Is there a real execution block, or just prose that resembles one? |
| `AEO-09` | Would this advice apply unchanged to any city or business? |
| `EEAT-05` | Does this claim need clinical or legal review? Flag-only, and the cost of a miss is high, so bias toward flagging. |

**Every class-B proposal is also Tier 3.** Detecting that a paragraph is 95
words is free; rewriting it is not. Budget one model call per proposal, not per
check.

The safety property that makes Tier 3 usable: whatever the model returns goes
through `verifyCopyBound` before it becomes a card. A rewrite that invents a
word is dropped; one that invents a *number* is rejected outright. The model is
never trusted to have obeyed the copy-bound constraint — it is checked.

## Tier 4 — needs more than one page

These cannot be answered from the page in front of you.

| Check | What it needs |
|---|---|
| `TECH-05` | Fetch each internal link, or a site link graph. |
| `TECH-06` | Fetch the OG image. |
| `TECH-08` | The site's nav and inbound link graph. |
| `TECH-09` | Every page's focus keyphrase, to detect cannibalisation. |
| `SCHEMA-09` | The Organization node on every page, to detect drift. |
| `EEAT-03` | Every page's author `@id`s. |

These belong in a site-level scan that runs on install and on a schedule — not
in the edit view. Surfacing them in the panel is fine; computing them there is
not.

## What this means for the panel

- Tier 1 findings can appear **instantly**, with no spinner and no cost.
- Tier 3 should run **once per page open**, not per keystroke, and its results
  should be cached against a hash of the page copy.
- Tier 4 belongs to a **background site scan**; the panel reads its output.

Building it in that order also means the panel is useful before any model is
wired up at all — 27 checks and every class-A fix work with the engine alone.
