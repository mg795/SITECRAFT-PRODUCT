# site-import

Migration: a client's existing website in, a structured SiteCraft website out.

This is **Process A** of SiteCraft Junior, the half a Read Tomato employee runs.
It is deliberately not the same thing as the editor a client later uses, and it
needs considerably more capability than that editor does.

    Crawl → Extract → Normalize → Reconstruct → Componentize → Validate

Nothing here writes to a client's live site, and nothing here can put a site on a
public domain. A migration produces a staging model and an exception report. That
is the whole of its authority.

## Why it runs on a server

Two hard limits, not preferences. A page in a browser may not read another origin,
so the editor can never fetch a client's site itself. And these sites — realtors,
dentists, charities, anyone on Squarespace, Wix or a WordPress page builder — put
their content in with JavaScript, so the HTML off the wire is nearly empty. The
pages have to be *rendered* before there is anything to read.

So a headless browser opens each page and the extractor runs inside it. That is the
one seam that needs a server; everything on either side of it runs anywhere.

## The parts

| file | what it does |
| --- | --- |
| `src/extract.js` | Runs **inside** a rendered page. Reports what is on it: bands, headings, copy, pictures, links, third-party features, and the site's own design rules. Reports; decides nothing. |
| `src/library.js` | The component library and the whitelist. The only place a field can be declared editable. |
| `src/componentize.js` | Bands in, SiteCraft components out. The part that decides the product. |
| `src/exceptions.js` | The migration exception report, link checking, SEO checking, and the acceptance criteria. |
| `src/status.js` | The migration state machine, including the two gates that stop a site reaching a client or a domain too early. |
| `src/tosite.js` | Assembles Site → Pages → Components, plus the site's design system. |
| `src/crawl.js` | Breadth-first over the authorised domain, sitemap first, links after. |
| `bin/import.js` | The whole thing from a command line. |

## Structured reconstruction

The source page does **not** come across as a slab of HTML. Every band of it
becomes a known component with named fields, or is reported as something a person
needs to look at. There is no third outcome, because an HTML blob cannot be
permitted, duplicated, or held to a design system — the three things the client
editor is built on.

Phase 1's library: Hero, Text, Image, Image and Text, Call to Action, Featured
Items, Blog Listing, Blog Post, and Third-Party Feature.

## The whitelist

Nothing is editable unless `library.js` says it is. There is no "everything except"
list anywhere, and no field for a font, a width, a colour, a breakpoint or a
stylesheet — those are not restricted, they simply are not part of a component. An
administrator can narrow what the library allows for one component; they cannot
widen it, and `normalisePerms` drops any attempt to.

## Third-party features

Never silently omitted, never blindly copied. Booking tools, IDX feeds, patient
portals, maps, chat, review widgets, payment and marketing forms are recognised by
provider and given one of three handlings:

- **embed** — may be kept as the embed it already is, once an administrator approves it (maps, video).
- **review** — SiteCraft will not rebuild it; an administrator decides (scheduling, IDX, portals, ecommerce, forms).
- **drop** — never carried across at all (analytics and tracking, always).

A third-party feature keeps its place on the page, under its own heading, with the
words that were around it. It becomes a component an administrator must decide
about, so the page does not quietly lose the thing the business runs on.

## The exception report

Mandatory, and the reason a migration is an operation rather than a puzzle. Copying
an ordinary paragraph is not the hard part; finding the fraction of a site that did
not come across is. The report says "8 pages came across, these five things need
you", worst first, each line naming its page and what to do about it.

`critical` stops approval. `warning` is shown and can be accepted. `note` is for the
record. Alongside it is the acceptance checklist from §49, and `approvable`, which
is false while any critical exception stands.

## Running it

```sh
node packages/site-import/bin/import.js northgate-dental.com --out client.json
```

Options: `--pages n` (default 8), `--out file.json` (default: stdout), `--as <url>`
for the address the site should be recorded under when it is fetched from somewhere
else — a preview host, a staging domain, a folder on disk.

It needs Playwright to render with: `npm i playwright`, or `PLAYWRIGHT_PATH` and
`--browser` pointing at a copy you already have.

## Tests

```sh
npm test --prefix packages/site-import
```

The fixtures are awkward on purpose. A realtor with a CSS hero above `<main>`, a
kicker with no useful class, `<picture>` with a srcset and a 24px icon beside a real
photo. A WordPress dentist with a sidebar, a skip link, and an absolute CDN source
next to a relative upload. A charity whose whole page is one `<section>`, with the
bands separated only by their headings. And an eight-page dental practice with a
booking widget, an off-site form, a map, a tracking script, a card grid, a blog, and
two planted faults: one picture with no file behind it and one link to a page that
does not exist.

Every step a production migration takes runs in these tests except the network hop:
real pages, rendered in a real browser, read by the same code.
