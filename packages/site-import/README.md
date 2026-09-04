# site-import

Bring a client's existing website into Sitecraft.

An administrator is given an address. This package opens that site, reads what is
on each page, and hands back the model the editor renders. Nothing is published
and the client's own site is never written to: an import is a copy to work on.

## Why it runs on a server

Two reasons, and both are hard limits rather than choices.

A page in a browser may not read another origin, so the editor can never fetch a
client's site itself. And the sites this is for — realtors, dentists, charities,
anyone on Squarespace, Wix or a WordPress page builder — put their content in with
JavaScript, so the HTML that comes off the wire is mostly empty. The pages have to
be *rendered* before there is anything to read.

So a headless browser opens each page and the extractor runs inside it. That is
the one seam that needs a server; everything on either side of it runs anywhere.

## The parts

| file | what it does |
| --- | --- |
| `src/extract.js` | Runs **inside** a rendered page. One document in, one page model out. Knows what is content and what is furniture. |
| `src/tosite.js` | Turns the pages a crawl collected into the site model the editor loads. Names the pages, keeps ids unique, drops a photo used twice. |
| `src/crawl.js` | Opens the entry page, follows the internal links worth following, and assembles the site. The caller supplies the browser. |
| `bin/import.js` | The same thing from a command line, for an administrator who can reach the client's site from their own machine. |

## Running it

```sh
node packages/site-import/bin/import.js northgate-dental.com --out client.json
```

Options: `--pages n` (default 8), `--out file.json` (default: stdout), `--as <url>`
for the address the site should be recorded under when it is fetched from
somewhere else — a preview host, a staging domain, a folder on disk.

It needs Playwright to render with: `npm i playwright`, or `PLAYWRIGHT_PATH` and
`--browser` pointing at a copy you already have.

## Loading it into the editor

Open the junior editor with `?admin` (or `#admin`, where the host keeps the query to itself; either one is remembered on that browser afterwards), go to **Your Account → Import a Client
Site**, and give it the address. It asks the import server at `/api/import?url=`.
Where that server is not reachable, it says so and takes the JSON this package
writes instead, which is the same model by the same route.

## What an import may carry

A component that reaches the editor holds `id`, `lbl`, `t`, `text` and, for a
photo, `src`, `alt` and `dim`. Nothing else. In particular an import carries **no
scores and no prices**: what a piece of content is worth is the boost engine's to
say, and the junior editor has no boost at all. An imported model is somebody
else's HTML, so the editor re-reads every field before it renders one: an unknown
component type is dropped rather than written into the page as a tag.

## Tests

```sh
npm test --prefix packages/site-import
# or one at a time
node packages/site-import/test/extract.test.js        # the extractor, against two real-shaped pages
node packages/site-import/test/crawl.test.js          # the crawler, end to end over a three page site
node packages/site-import/test/junior-import.test.js  # the import screen, driven as an administrator drives it
```

The fixtures are built to be awkward on purpose: a hero in a CSS background above
`<main>`, a kicker with no useful class, `<picture>` with a srcset, a 24px icon
next to a real photo, a WordPress sidebar and skip link, a cookie banner, and an
absolute CDN source sitting beside a relative upload.

Every step a production import takes runs in these tests except the network hop
itself: real pages, rendered in a real browser, read by the same code.
