'use strict';
/*
 * Assemble the pages a crawl collected into one SiteCraft site.
 *
 * The shape is Site → Pages → Components → Fields, and it is the same shape all
 * the way down whether the page came from a realtor's template or a charity's
 * hand-written HTML. Nothing is stored as a slab of markup. That structure is what
 * later makes it possible to say "this field is editable, this component may be
 * duplicated, this page inherits the site's design rules" — none of which can be
 * said about an HTML blob.
 *
 * The site also carries its own design rules, read off the source rather than
 * invented, so a client changing words can never change how the site looks.
 */

const { componentize } = require('./componentize');
const { report } = require('./exceptions');
const { afterMigration } = require('./status');
const { LIBRARY } = require('./library');

const MAX_PAGES = 12;
const RESERVED  = new Set(['home']);

/* A key a person would recognise in a page list, taken from the address. */
function keyFor(url, isEntry){
  if (isEntry) return 'home';
  let path;
  try { path = new URL(url).pathname; } catch { path = String(url); }
  const parts = path.replace(/\.(html?|php|aspx?)$/i, '').split('/').filter(Boolean);
  if (!parts.length) return 'home';
  const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return last || 'page';
}
function uniqueKeys(pages){
  const taken = new Set(), out = [];
  for (const p of pages){
    let k = keyFor(p.url, p.isEntry);
    if (!p.isEntry && RESERVED.has(k)) k = k + '-page';
    if (taken.has(k)){ let n = 2; while (taken.has(k + '-' + n)) n++; k = k + '-' + n; }
    taken.add(k);
    out.push({ ...p, key: k });
  }
  return out;
}
/* The entry page first, then the pages that matter most, then the rest as found. */
const order = pages => pages
  .map((p, i) => ({ p, i }))
  .sort((a, b) => (b.p.isEntry - a.p.isEntry) || (b.p.value - a.p.value) || (a.i - b.i))
  .map(x => x.p);

/*
 * The site's design rules (§17).
 *
 * Taken from the entry page, which is where a template shows its hand, and filled
 * from the others only where the entry page was silent. Clients inherit these and
 * have no field anywhere that can change them.
 */
function designSystem(pages){
  const base = (pages.find(p => p.isEntry) || pages[0] || {}).design || {};
  const out = JSON.parse(JSON.stringify(base));
  for (const p of pages){
    const d = p.design; if (!d) continue;
    for (const k of ['body','h1','h2','h3','button','link'])
      if (!out[k] && d[k]) out[k] = d[k];
    if (!out.maxWidth && d.maxWidth) out.maxWidth = d.maxWidth;
    if (d.fonts) out.fonts = [...new Set([...(out.fonts || []), ...d.fonts])].filter(Boolean).slice(0, 3);
  }
  return out;
}

/*
 * A flat reading of a page, derived from its components rather than kept beside
 * them. The editor renders from this; the components remain the one truth, so a
 * change to a field cannot leave the two disagreeing.
 */
function flatten(page){
  const out = [];
  const add = (id, lbl, t, text, extra) => {
    if (text === undefined || text === null || text === '') return;
    out.push(Object.assign({ id, lbl, t, text }, extra || {}));
  };
  const img = (id, f, lbl) => f && f.src && out.push({
    id, lbl: lbl || 'Feature Photo', t:'img', src: f.src, alt: f.alt || '',
    dim: { w: f.w || 0, h: f.h || 0 }, text: f.alt || 'Photo' });

  page.components.forEach(c => {
    const f = c.fields, h = c.hero ? { hero:1 } : {};
    switch (c.type){
      case 'hero':
        add(c.id + '-k', 'Eyebrow', 'kick', f.eyebrow, h);
        add(c.id + '-h', 'Heading', 'h1', f.headline, h);
        add(c.id + '-b', 'Body Copy', 'p', f.body, h);
        img(c.id + '-i', f.image);
        add(c.id + '-c', 'Button', 'band', f.ctaLabel);
        break;
      case 'blog_post':
        add(c.id + '-h', 'Heading', 'h1', f.title, h);
        img(c.id + '-i', f.image);
        add(c.id + '-b', 'Body Copy', 'p', f.body);
        break;
      case 'image':
        img(c.id + '-i', f.image);
        add(c.id + '-c', 'Caption', 'band', f.caption);
        break;
      case 'cta':
        add(c.id + '-h', 'Heading', 'h2', f.headline, h);
        add(c.id + '-b', 'Body Copy', 'p', f.body);
        add(c.id + '-c', 'Button', 'band', f.ctaLabel);
        break;
      case 'featured_item':
        add(c.id + '-h', 'Heading', 'h2', f.headline, h);
        (f.items || []).forEach((it, n) => {
          add(c.id + '-i' + n, 'Featured Item', 'band', it.title);
          img(c.id + '-i' + n + 'p', it.image, 'Item Photo');
        });
        break;
      case 'blog_listing':
        add(c.id + '-h', 'Heading', 'h2', f.headline, h);
        add(c.id + '-b', 'Body Copy', 'p', f.body);
        add(c.id + '-s', 'Blog Listing', 'band', f.source);
        break;
      case 'embed':
        add(c.id + '-h', 'Heading', 'h2', f.headline, h);
        add(c.id + '-b', 'Body Copy', 'p', f.body);
        add(c.id + '-e', 'Third-Party Feature', 'band', f.vendor + ', ' + f.feature);
        break;
      default:                                    /* text and image_text */
        add(c.id + '-h', 'Heading', 'h2', f.headline, h);
        add(c.id + '-b', 'Body Copy', 'p', f.body, h);
        img(c.id + '-i', f.image);
        (f.list || []).forEach((li, n) => add(c.id + '-l' + n, 'List Item', 'band', li));
    }
  });
  return out;
}

/*
 * toSite(pages, opts) -> { site, design, report, status, library, summary }
 *
 * `site` is the pages, keyed. Each page carries its components, and a flat reading
 * of them for the editor. `report` is the exception report, which is the thing an
 * administrator actually opens first.
 */
function toSite(pages, opts = {}){
  const max = opts.maxPages || MAX_PAGES;
  const usable = pages.filter(p => p && Array.isArray(p.sections));
  const kept = order(uniqueKeys(usable)).slice(0, max);

  const site = {}, notes = [], assets = new Map();
  for (const p of kept){
    const { components, notes: pageNotes } = componentize(p, { prefix: p.key, perms: opts.perms });
    notes.push(...pageNotes);
    /* One photo used on five pages is one asset used five times, and stays on all
       five: taking it off four of them to avoid repeating it would break four
       components to tidy a list. It is counted once, in the asset register. */
    components.forEach(c => {
      const f = c.fields;
      if (f.image && f.image.src) assets.set(f.image.src, (assets.get(f.image.src) || 0) + 1);
      (f.items || []).forEach(it => { if (it.image && it.image.src)
        assets.set(it.image.src, (assets.get(it.image.src) || 0) + 1); });
    });
    const page = {
      key: p.key, name: p.name, slug: p.slug, value: p.value, url: p.url,
      isEntry: !!p.isEntry, blog: p.blog || null,
      meta: p.meta || {}, tags: p.tags || [], links: p.links || [],
      components,
      approved: false,
    };
    page.comps = flatten(page);
    site[p.key] = page;
  }

  const rep = report(site, kept, notes, opts.errors || [], { assets: assets.size });
  const all = Object.values(site);
  const comps = all.reduce((a, p) => a.concat(p.components), []);
  const used = [...new Set(comps.map(c => c.type))];

  return {
    site,
    assets: [...assets].map(([src, uses]) => ({ src, uses })),
    design: designSystem(kept),
    report: rep,
    status: afterMigration(rep),
    library: used.map(t => ({ type: t, label: LIBRARY[t].label, count: comps.filter(c => c.type === t).length })),
    summary: {
      pages: all.length,
      dropped: Math.max(0, usable.length - all.length),
      components: comps.length,
      photos: assets.size,
      photoUses: [...assets.values()].reduce((a, b) => a + b, 0),
      words: comps.reduce((n, c) => n + wordsIn(c.fields), 0),
      thirdParty: comps.filter(c => c.type === 'embed').length,
      duplicatable: comps.filter(c => c.duplicatable).length,
      needReview: comps.filter(c => c.status === 'review').length,
    },
  };
}
function wordsIn(fields){
  let n = 0;
  const count = v => { if (typeof v === 'string') n += v.trim().split(/\s+/).filter(Boolean).length; };
  Object.values(fields || {}).forEach(v => {
    if (Array.isArray(v)) v.forEach(x => typeof x === 'object' ? Object.values(x).forEach(count) : count(x));
    else if (v && typeof v === 'object') count(v.alt);
    else count(v);
  });
  return n;
}

module.exports = { toSite, keyFor, uniqueKeys, order, flatten, designSystem, MAX_PAGES };
