# SiteCraft Junior — Phase 1 against the build brief

Worked in the brief's own priority order (§51). This is where each section actually
stands, including the parts that are not built. Nothing below is marked done because
a screen exists; it is marked done because it works and is tested.

**Status key** — `done` · `partial` · `server` (blocked on infrastructure that does
not exist yet) · `todo`

## Priority 1 and 2: migration and structured reconstruction

| § | What the brief asks for | Status | Where |
| --- | --- | --- | --- |
| 2 | Migration and maintenance are separate processes | `done` | Two apps: `sitecraft-admin.html`, `sitecraft-junior.html` |
| 7 | Cloning means reproducing as a working SiteCraft site, not saving HTML | `done` | No markup is copied at any point |
| 8 | Crawl the publicly accessible pages | `done` | `crawl.js` — breadth-first, sitemap first, locked to the authorised domain |
| 9 | Preserve text, images, links, headings, lists, hierarchy, slugs, meta, alt, blog | `done` | Tables come across as text; there is no table component yet, and that is reported |
| 10 | Do not blindly copy code | `done` | Nothing executes. The output is text, sources, measurements and classifications |
| 11 | Third-party features are an exception, not a copy | `done` | 37 providers recognised; `embed` / `review` / `drop` |
| 13 | **Migration exception report** | `done` | `exceptions.js` — 18 kinds, severity-ranked, each with its page and its fix |
| 16 | Site → Pages → Components → Fields, never one HTML field | `done` | `componentize.js`, `tosite.js` |
| 17 | Site-level design rules | `done` | Read off the source: fonts, heading and body styles, button, accent, width |
| 18 | A deliberately small component library | `done` | 9 types, no more |
| 19 | **Editability is a whitelist** | `done` | `library.js` is the only place a field can be editable |
| 37 | SEO preservation | `partial` | Slugs, titles, descriptions, canonicals, H-order, alt and schema preserved and checked. **Redirects are not built** |
| 38 | Link validation | `done` | Broken internal links are critical exceptions |
| 49 | Migration acceptance criteria | `done` | Nine checks; `approvable` is false while any critical stands |

## Priority 3 and 4: admin review and client provisioning

| § | What the brief asks for | Status | Where |
| --- | --- | --- | --- |
| 4 | Admin dashboard, one row per account | `done` | Every column the brief lists. Migration detail stays inside the account |
| 5 | Create Client, before migration | `done` | Allowance defaults to 3, changeable per account |
| 6 | Website authorisation, recorded | `done` | Who, when, which URL, which account. Migration is not offered until it exists |
| 12 | Migration status | `done` | `status.js` — ten states, explicit transitions |
| 14 | Staging is explicit | `partial` | The model is staging-only and the state machine refuses `live` from anything migration can reach. **There is no actual hosting** |
| 15 | Admin review, then Approve Site for Client Access | `done` | Gated on: every critical resolved, every page reviewed. Reopening one withdraws approval |
| 20 | Invite the client | `partial` | Every state and transition works and is logged. **Sending the email needs a server** |
| 33 | Administrator revision controls | `done` | Allowance, extras, reset, no-limit |
| 40 | Client activity log | `partial` | Every administrator action is logged. Client actions arrive when there is a client session |
| 3 | Tenant isolation | `server` | Stated on the screen rather than implied. Cannot be honestly built in a browser |

## Priority 5 to 9: the client's half

| § | What the brief asks for | Status |
| --- | --- | --- |
| 21 | Client home screen | `todo` |
| 22 | Visual editing | `partial` — the junior editor already edits text and replaces images in place |
| 23 | Client design restrictions | `done` — by construction. There is no field for any of it |
| 24 | Image replacement | `partial` — upload, position and zoom work. Optimisation and responsive sets are `server` |
| 25 | Add a blog post | `todo` |
| 26 | Duplicate a section | `partial` — the flag is set per component and configurable; the action is `todo` |
| 27 | Duplicate a page | `todo` |
| 28 | Add a section from the library | `todo` |
| 29 | Draft system | `todo` |
| 30 | A revision is one publication | `done` as a definition, enforced in the admin |
| 31 | Revision confirmation before publishing | `todo` |
| 32 | Revision reset, no roll-over | `partial` — the reset action exists; the billing cycle is `server` |
| 34 | At zero: still work, cannot publish | `partial` — stated and designed; nothing to enforce until publishing exists |
| 35 | Version history and restore | `server` |
| 36 | **Atomic publication** | `server` — and it must not be attempted client-side |
| 41 | Autosave | `partial` — the admin survives a refresh; the client editor does not yet |
| 42 | Concurrent editing | `todo` |
| 43 | Failure handling | `partial` — migration and admin have real failure states; publishing has none to have |
| 39 | Responsive | `partial` — extraction runs at one viewport. Components inherit the design rules, so they stay responsive, but nothing checks tablet or mobile yet |

## §44 — deliberately not built

None of the excluded list has been started, and nothing here drifts towards it. There
is no drag-and-drop builder, no marketplace, no code editor, no blank canvas.

## §50 — definition of done

Not yet. The first half of the scenario works end to end and is tested: a Read Tomato
employee creates an account, records authorisation, migrates a real eight-page site,
reads the exception report, corrects and resolves, configures what is editable and
duplicatable, approves, and invites.

The second half — the client logging in, editing, drafting, previewing, publishing as
one change set, one revision deducted, stored in version history, restorable — needs
a server. Publishing without one would be theatre, and §36 is the reason: a publish
that half-succeeds and still charges a revision is worse than no publish at all.

## The open architectural decision

Where a finished SiteCraft site is hosted, and how a client's existing domain moves
onto it. Kept out of migration on purpose, as the brief asks. Nothing in this codebase
touches DNS, and `status.js` refuses the `live` transition from every state a
migration can reach, so that decision cannot be made accidentally.

## Running it

```sh
npm test --prefix packages/site-import     # 255 assertions
node packages/site-import/bin/import.js <url> --out client.json
```

Then open `app/sitecraft-admin.html`, create the client, record authorisation, and
paste the model.
