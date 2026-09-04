'use strict';
/*
 * Walk a client's site and bring every page of it across.
 *
 * This is the one part of a migration that has to run on a server. A browser page
 * may not read another origin, so the editor can never fetch a client's site
 * itself; and the pages have to be RENDERED, not merely downloaded, because
 * Squarespace, Wix and every WordPress page builder write their content in with
 * JavaScript. So a headless browser opens each page and the extractor runs inside
 * it. The caller supplies the browser, which keeps this file free of a hard
 * dependency and lets the tests drive it against fixtures on disk.
 *
 * The crawl is breadth-first from the entry page, following links found on every
 * page rather than only on the first: a blog post is two links deep on almost every
 * site there is, and a crawl that stops at one level never sees the blog at all.
 * It never leaves the authorised domain.
 */

const fs = require('fs');
const path = require('path');
const { toSite } = require('./tosite');

const EXTRACT = fs.readFileSync(path.join(__dirname, 'extract.js'), 'utf8');

const DEFAULTS = {
  maxPages: 12,
  settleMs: 400,          /* let a builder's scripts put the content in */
  timeoutMs: 20000,
  viewport: { width: 1280, height: 900 },
  sitemap: true,
};

/* Which pages to take first when there are more links than budget. A site's own
   services and team pages earn their place ahead of the fourteenth blog post. */
const WORTH = /(service|about|contact|team|practice|listing|propert|program|donate|pricing|treatment|menu|staff|our-)/i;
const BLOGGY = /\/(blog|news|posts?|articles?|stories|insights|updates)(\/|$)/i;

function rank(href){
  try {
    const u = new URL(href);
    const depth = u.pathname.split('/').filter(Boolean).length;
    const worth = WORTH.test(u.pathname) ? 0 : BLOGGY.test(u.pathname) ? 1 : 2;
    return worth * 10 + depth;
  } catch { return 99; }
}

/*
 * Where a page is fetched from and what it should be called are not always the same
 * address. A site is often rendered through a preview host, a staging domain or, in
 * the tests, a folder on disk, while the model has to carry the address the client's
 * customers actually type. `as` is that address: everything is fetched where it
 * lives and recorded where it belongs.
 */
function addressing(startUrl, as){
  if (!as) return { toModel: u => u, toReal: u => u };
  const home = as.endsWith('/') ? as : as + '/';
  const root = startUrl.slice(0, startUrl.lastIndexOf('/') + 1);
  return {
    toModel: u => { try { return new URL(u.startsWith(root) ? u.slice(root.length) : u, home).href; }
                    catch { return u; } },
    toReal:  m => m.startsWith(home) ? root + m.slice(home.length) : m,
  };
}

async function readPage(page, real, model, key, isEntry, opt){
  await page.goto(real, { waitUntil: 'load', timeout: opt.timeoutMs });
  await page.waitForTimeout(opt.settleMs);
  await page.addScriptTag({ content: EXTRACT });
  const out = await page.evaluate(
    ([u, o]) => window.SitecraftExtract.extractPage(document, window, u, o),
    [model, { key, isEntry }]);
  out.isEntry = isEntry;
  return out;
}

/*
 * A sitemap is the site telling you what it has, which beats guessing from links.
 *
 * It gets a page of its own. Most sites do not have one, and a navigation that
 * fails leaves the tab resolving an error page, which then interrupts whatever the
 * crawl navigates to next — every page after the attempt fails, for a reason that
 * has nothing to do with the page.
 */
async function sitemapUrls(browser, startUrl, opt){
  if (!opt.sitemap) return [];
  let page;
  try {
    page = await browser.newPage();
    const at = new URL('/sitemap.xml', startUrl).href;
    const res = await page.goto(at, { waitUntil:'domcontentloaded', timeout: 8000 });
    if (!res || !res.ok()) return [];
    const xml = await page.content();
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]).slice(0, 200);
  } catch { return []; }
  finally { if (page) await page.close().catch(() => {}); }
}

/*
 * A page that fails leaves the tab sitting on the browser's own error page, and
 * that pending navigation then interrupts whatever the crawl opens next. One
 * genuinely missing page would otherwise take an innocent page down with it and
 * report the wrong one as broken. So a failure is cleaned up before the next page,
 * and an interrupted navigation — which is never the page's own fault — is tried
 * once more before it is believed.
 */
async function tryPage(page, real, model, key, opt){
  for (let attempt = 0; attempt < 2; attempt++){
    try {
      return await readPage(page, real, model, key, false, opt);
    } catch (e) {
      /* the browser's own error page arrives after the throw, so settle before
         steering away from it, and again before anything else is opened */
      await page.waitForTimeout(60).catch(() => {});
      await page.goto('about:blank', { waitUntil:'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(60).catch(() => {});
      const interrupted = /interrupted by another navigation/i.test(e.message || '');
      if (!interrupted || attempt === 1) throw e;
    }
  }
}

/*
 * crawl(browser, startUrl, opts) -> the same object toSite returns, plus what
 * happened during the walk. A page that fails is recorded and stepped over rather
 * than ending the run: a client's site with one broken link should still import,
 * and the failure belongs in the exception report where somebody will see it.
 */
async function crawl(browser, startUrl, opts = {}){
  const opt = { ...DEFAULTS, ...opts };
  const page = await browser.newPage({ viewport: opt.viewport });
  const { toModel, toReal } = addressing(startUrl, opt.as);
  const origin = (() => { try { return new URL(toModel(startUrl)).origin; } catch { return null; } })();

  const seen = new Set(), pages = [], errors = [];
  const queued = new Set();
  const frontier = [];
  const offer = href => {
    if (!href || seen.has(href) || queued.has(href)) return;
    try { if (origin && new URL(href).origin !== origin) return; } catch { return; }
    queued.add(href);
    frontier.push(href);
  };

  try {
    const entryModel = toModel(startUrl);
    const entry = await readPage(page, startUrl, entryModel, 'home', true, opt);
    seen.add(entry.url);
    pages.push(entry);

    /* what the site says about itself first, then what its pages link to */
    for (const u of await sitemapUrls(browser, entryModel, opt)) offer(u);
    entry.links.filter(l => l.kind === 'internal').forEach(l => offer(l.href));

    while (frontier.length && pages.length < opt.maxPages){
      frontier.sort((a, b) => rank(a) - rank(b));
      const href = frontier.shift();
      if (seen.has(href)) continue;
      seen.add(href);
      try {
        const got = await tryPage(page, toReal(href), href, 'p' + pages.length, opt);
        pages.push(got);
        got.links.filter(l => l.kind === 'internal').forEach(l => offer(l.href));
      } catch (e) {
        errors.push({ url: href, message: firstLine(e.message) });
      }
    }
  } finally {
    await page.close();
  }

  const out = toSite(pages, { maxPages: opt.maxPages, errors, perms: opt.perms });
  out.pages = pages;
  out.errors = errors;
  out.summary = { ...out.summary, visited: seen.size, failed: errors.length,
                  notVisited: Math.max(0, frontier.length) };
  out.source = { startUrl, as: opt.as || null, maxPages: opt.maxPages };
  return out;
}
const firstLine = m => String(m || '').split('\n')[0].slice(0, 200);

module.exports = { crawl, rank, addressing, DEFAULTS };
