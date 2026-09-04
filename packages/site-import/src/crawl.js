'use strict';
/*
 * Bring a client's site across, one rendered page at a time.
 *
 * This is the one part of an import that has to run on a server. A browser page
 * cannot fetch another origin, so the editor can never do this itself; and the
 * pages have to be *rendered*, not just downloaded, because Squarespace, Wix and
 * every WordPress page builder write their content in with JavaScript. So: a
 * headless browser opens the page, the extractor runs inside it, and what comes
 * back is a model. The caller supplies the browser, which keeps this file free of
 * a hard dependency and lets the tests drive it against fixtures on disk.
 */

const fs = require('fs');
const path = require('path');
const { toSite } = require('./tosite');

const EXTRACT = fs.readFileSync(path.join(__dirname, 'extract.js'), 'utf8');

const DEFAULTS = {
  maxPages: 8,
  settleMs: 400,          /* let a builder's scripts put the content in */
  timeoutMs: 20000,
  viewport: { width: 1280, height: 900 },
};

/* Pages worth taking when there are more links than budget. */
const WORTH = /(service|about|contact|team|practice|listing|propert|program|donate|pricing|treatment|menu|blog)/i;

function rank(href){
  try {
    const u = new URL(href);
    const depth = u.pathname.split('/').filter(Boolean).length;
    return (WORTH.test(u.pathname) ? 0 : 1) * 10 + depth;
  } catch { return 99; }
}

/*
 * Where a page is fetched from and what it should be called are not always the
 * same address. A site is often rendered through a preview host, a staging domain
 * or, in the tests, a folder on disk, while the model has to carry the address the
 * client's customers actually type. `as` is that address: everything is fetched
 * where it lives and recorded where it belongs.
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
 * crawl(browser, startUrl, opts) -> { site, report, pages, errors }
 *
 * `browser` is anything that can hand back a Playwright-shaped page. Nothing here
 * writes to disk or to the network beyond the pages it is asked for, and a page
 * that fails is recorded and stepped over rather than ending the run: a client's
 * site with one broken link should still import.
 */
async function crawl(browser, startUrl, opts = {}){
  const opt = { ...DEFAULTS, ...opts };
  const page = await browser.newPage({ viewport: opt.viewport });
  const { toModel, toReal } = addressing(startUrl, opt.as);
  const seen = new Set(), pages = [], errors = [];

  try {
    const entry = await readPage(page, startUrl, toModel(startUrl), 'home', true, opt);
    seen.add(entry.url);
    pages.push(entry);

    const queue = (entry.links || [])
      .map(l => l.href)
      .filter(h => !seen.has(h))
      .sort((a, b) => rank(a) - rank(b));

    for (const href of queue){
      if (pages.length >= opt.maxPages) break;
      if (seen.has(href)) continue;
      seen.add(href);
      try {
        pages.push(await readPage(page, toReal(href), href, 'p' + pages.length, false, opt));
      } catch (e) {
        errors.push({ url: href, message: e.message });
      }
    }
  } finally {
    await page.close();
  }

  const { site, report } = toSite(pages, { maxPages: opt.maxPages });
  return { site, report: { ...report, visited: seen.size, errors: errors.length }, pages, errors };
}

module.exports = { crawl, rank, addressing, DEFAULTS };
