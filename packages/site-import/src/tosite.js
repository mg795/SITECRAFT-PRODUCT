'use strict';
/*
 * Turn the pages an import brought back into the site model the editor renders.
 *
 * The editor keeps a site as an object of pages keyed by a short name, each with a
 * display name, a value from 1 to 3, and the components in reading order. Nothing
 * here invents a number: an imported component carries no scores, because scoring
 * belongs to the boost engine and the junior editor has no boost. Pages carry the
 * page's address, meta and tags alongside, which the editor ignores today and will
 * want the moment it can publish.
 */

const MAX_PAGES = 12;
const RESERVED  = new Set(['home']);

/* A key a person would recognise in a page list, from the address. */
function keyFor(url, isEntry){
  if (isEntry) return 'home';
  let path;
  try { path = new URL(url).pathname; } catch { path = String(url); }
  const parts = path.replace(/\.(html?|php|aspx?)$/i, '').split('/').filter(Boolean);
  if (!parts.length) return 'home';
  const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return last || 'page';
}

/* Two pages can want the same key. The first one keeps it. */
function uniqueKeys(pages){
  const taken = new Set(), out = [];
  for (const p of pages){
    let k = keyFor(p.url, p.isEntry);
    if (!p.isEntry && RESERVED.has(k)) k = k + '-page';
    if (taken.has(k)){
      let n = 2;
      while (taken.has(k + '-' + n)) n++;
      k = k + '-' + n;
    }
    taken.add(k);
    out.push({ ...p, key: k });
  }
  return out;
}

/* The entry page first, then the pages that matter most, then the rest as found. */
function order(pages){
  return pages
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.isEntry - a.p.isEntry) || (b.p.value - a.p.value) || (a.i - b.i))
    .map(x => x.p);
}

/* Only the fields the editor reads, so an import cannot smuggle anything else in. */
function cleanComp(c){
  const out = { id: c.id, lbl: c.lbl, t: c.t, text: c.text };
  if (c.hero) out.hero = 1;
  if (c.t === 'img'){
    out.src = c.src;
    out.alt = c.alt || '';
    if (c.dim) out.dim = { w: c.dim.w, h: c.dim.h };
  }
  return out;
}

/*
 * pages: what the crawler collected, each one the output of extractPage.
 * Returns { site, report } — the model to render, and what to tell the
 * administrator about what came across and what did not.
 */
function toSite(pages, opts = {}){
  const max = opts.maxPages || MAX_PAGES;
  const kept = order(uniqueKeys(pages.filter(p => p && Array.isArray(p.comps)))).slice(0, max);

  const site = {};
  const seenSrc = new Set();
  for (const p of kept){
    const comps = [];
    for (const c of p.comps){
      /* One photo used on five pages is one photo, and belongs to the first. */
      if (c.t === 'img'){
        if (seenSrc.has(c.src)) continue;
        seenSrc.add(c.src);
      }
      comps.push(cleanComp({ ...c, id: p.key + '-' + (comps.length + 1) }));
    }
    site[p.key] = {
      name:  p.name,
      value: p.value,
      url:   p.url,
      meta:  p.meta || {},
      tags:  p.tags || [],
      links: p.links || [],
      comps,
    };
  }

  const all = Object.values(site);
  return {
    site,
    report: {
      pages:      all.length,
      dropped:    Math.max(0, pages.length - all.length),
      components: all.reduce((n, p) => n + p.comps.length, 0),
      photos:     all.reduce((n, p) => n + p.comps.filter(c => c.t === 'img').length, 0),
      headings:   all.reduce((n, p) => n + p.comps.filter(c => /^h[12]$/.test(c.t)).length, 0),
      words:      all.reduce((n, p) => n + p.comps.reduce((w, c) =>
                    w + (c.t === 'img' ? 0 : c.text.trim().split(/\s+/).filter(Boolean).length), 0), 0),
      untitled:   all.reduce((n, p) => n + p.comps.filter(c => c.t === 'img' && !c.alt).length, 0),
    },
  };
}

module.exports = { toSite, keyFor, uniqueKeys, order, cleanComp, MAX_PAGES };
