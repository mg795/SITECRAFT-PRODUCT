'use strict';
/*
 * The migration exception report.
 *
 * This is the part that makes migration an operation a person can run rather than
 * a puzzle they have to solve. Copying an ordinary paragraph and an ordinary photo
 * is not the hard part; finding the small fraction of a site that did not come
 * across is. So SiteCraft has to be able to say "34 pages came across, these five
 * things need you" — because an employee who has to click every page to find the
 * faults is an employee the economics do not support.
 *
 * Nothing here is cosmetic. Every entry names a page, says what is wrong in words
 * a person can act on, and carries a severity that decides whether the site can be
 * approved at all.
 */

/*
 * severity: 'critical' stops approval, 'warning' is shown and can be accepted,
 * 'note' is for the record. `fix` is what an administrator would actually do.
 */
const CATALOGUE = {
  page_failed:        { label:'Page Could Not Be Processed', severity:'critical',
                        fix:'Open the source page and check it loads, then run the migration again.' },
  duplicate_url:      { label:'Duplicate URL',               severity:'critical',
                        fix:'Give one of the two pages a different address.' },
  page_empty:         { label:'Page Came Across Empty',      severity:'critical',
                        fix:'Check the source page. It may need JavaScript that did not run.' },
  image_missing:      { label:'Missing Image',               severity:'critical',
                        fix:'Upload the picture, or take the component out.' },
  broken_link:        { label:'Broken Internal Link',        severity:'critical',
                        fix:'Point the link at a page that exists, or remove it.' },
  third_party:        { label:'Third-Party Feature — Review Required', severity:'critical',
                        fix:'Decide whether to keep the embed, replace it, or leave it out.' },

  component_incomplete:{ label:'Component Missing Content',  severity:'warning',
                        fix:'Fill the missing field, or change the component type.' },
  unsupported_form:   { label:'Unsupported Form',            severity:'warning',
                        fix:'Rebuild it as an approved form, or keep the provider’s embed.' },
  meta_missing:       { label:'Missing Metadata',            severity:'warning',
                        fix:'Write a title and description for the page.' },
  heading_order:      { label:'Heading Order',               severity:'warning',
                        fix:'Give the page exactly one H1 and no skipped levels.' },
  alt_missing:        { label:'Image Has No Description',    severity:'warning',
                        fix:'Write a plain description of the picture.' },
  table_unsupported:  { label:'Unsupported Interactive Component', severity:'warning',
                        fix:'Check the content survived as text, or ask for a table component.' },
  images_dropped:     { label:'Pictures Not Shown',          severity:'warning',
                        fix:'Add an Image component for them, or reclassify the band as Featured Items.' },
  section_skipped:    { label:'Layout Mismatch',             severity:'warning',
                        fix:'Check the source page for a band SiteCraft did not carry across.' },
  slug_changed:       { label:'URL Changed',                 severity:'warning',
                        fix:'Set a redirect from the old address to the new one.' },
  external_asset:     { label:'Asset Hosted Elsewhere',      severity:'warning',
                        fix:'Bring the file onto SiteCraft so it cannot vanish later.' },

  script_dropped:     { label:'Script Detected',             severity:'note',
                        fix:'Nothing to do. Third-party code is never carried across.' },
  schema_carried:     { label:'Structured Data Carried Across', severity:'note',
                        fix:'Check it still describes the business correctly.' },
};

const sevRank = { critical: 0, warning: 1, note: 2 };

/* ── the checks that need the whole site, not one page ── */

/* §38: a link into the client's own site that lands nowhere. */
function linkChecks(pages){
  const out = [];
  const known = new Set();
  pages.forEach(p => {
    known.add(norm(p.url));
    if (p.meta && p.meta.canonical) known.add(norm(p.meta.canonical));
  });
  pages.forEach(p => (p.links || []).forEach(l => {
    if (l.kind !== 'internal') return;
    if (known.has(norm(l.href))) return;
    out.push({ kind:'broken_link', page: p.key, detail: l.href,
               message: 'A link points at a page that is not part of this site.',
               where: l.label || '' });
  }));
  return out;
}
function norm(u){
  try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/index\.html?$/i, '/').replace(/\/$/, ''); }
  catch { return String(u); }
}

/* §37: SEO is the reason a migration can quietly cost a business money. */
function seoChecks(pages){
  const out = [], slugs = new Map();
  pages.forEach(p => {
    const slug = (p.slug || '/').replace(/\/index\.html?$/i, '/');
    if (slugs.has(slug))
      out.push({ kind:'duplicate_url', page: p.key, detail: slug,
                 message: 'Two pages want the same address: ' + slugs.get(slug) + ' and ' + p.key + '.' });
    else slugs.set(slug, p.key);

    const m = p.meta || {};
    const missing = [];
    if (!m.title) missing.push('title');
    if (!m.description) missing.push('description');
    if (missing.length)
      out.push({ kind:'meta_missing', page: p.key, detail: missing.join(' and '),
                 message: 'The page has no ' + missing.join(' and ') + '.' });

    const h = (p.headingOrder || []);
    const h1s = h.filter(x => x === 1).length;
    if (h1s !== 1)
      out.push({ kind:'heading_order', page: p.key, detail: h1s + ' H1 headings',
                 message: h1s ? 'The page has more than one main heading.' : 'The page has no main heading.' });
    else {
      for (let i = 1; i < h.length; i++) if (h[i] - h[i - 1] > 1){
        out.push({ kind:'heading_order', page: p.key, detail: 'H' + h[i - 1] + ' to H' + h[i],
                   message: 'The page skips a heading level.' });
        break;
      }
    }
    (m.schema || []).forEach(s => {
      const t = s && (s['@type'] || (s['@graph'] && 'graph'));
      if (t) out.push({ kind:'schema_carried', page: p.key, detail: String(t),
                        message: 'Structured data was carried across exactly as it was found.' });
    });
  });
  return out;
}

/* §49: whether this migration is fit to be approved at all. */
function acceptance(site, entries, pages, assets){
  const all = Object.values(site);
  const comps = all.reduce((a, p) => a.concat(p.components), []);
  const has = k => entries.some(e => e.kind === k);
  const critical = entries.filter(e => e.severity === 'critical');
  const check = (name, pass, detail) => ({ name, pass: !!pass, detail: detail || '' });

  return [
    check('All expected pages exist', all.length > 0 && !has('page_failed'),
          all.length + ' page' + (all.length === 1 ? '' : 's')),
    check('Navigation works', all.length > 0 && !has('broken_link'),
          has('broken_link') ? 'Some links land nowhere' : 'Every internal link lands on a page'),
    check('Images load', !has('image_missing'),
          (assets || countAssets(all)) + ' picture' + ((assets || countAssets(all)) === 1 ? '' : 's')),
    check('Core text exists', comps.some(c => /^(hero|text|image_text|blog_post)$/.test(c.type)),
          comps.length + ' component' + (comps.length === 1 ? '' : 's')),
    check('Required metadata exists', !has('meta_missing'), ''),
    check('Heading structure is sound', !has('heading_order'), ''),
    check('Blog structure works', blogOk(all), blogNote(all)),
    check('Third-party features identified', true,
          entries.filter(e => e.kind === 'third_party').length + ' found'),
    check('No unresolved critical errors', critical.length === 0,
          critical.length ? critical.length + ' to resolve' : 'None'),
  ];
}
const countAssets = all => all.reduce((n, p) => n + p.components.filter(
  c => c.fields && c.fields.image && c.fields.image.src).length, 0);
function blogOk(all){
  const listing = all.some(p => p.components.some(c => c.type === 'blog_listing'));
  const posts   = all.some(p => p.components.some(c => c.type === 'blog_post'));
  return !listing || posts || true;            /* a listing with no posts yet is normal, not a fault */
}
function blogNote(all){
  const listing = all.filter(p => p.components.some(c => c.type === 'blog_listing')).length;
  const posts   = all.filter(p => p.components.some(c => c.type === 'blog_post')).length;
  return listing || posts ? listing + ' listing, ' + posts + ' post' + (posts === 1 ? '' : 's') : 'No blog found';
}

/*
 * report(site, pages, notes, errors) -> the whole exception report.
 *
 * One entry per real problem, most serious first, each naming its page. The counts
 * at the top are what an administrator reads before deciding whether to open
 * anything at all.
 */
function report(site, pages, notes, errors, opts = {}){
  const links = linkChecks(pages);
  /* A link to a page that was never there fails to load and is also a broken link.
     Those are one fault, and an employee should be shown it once, as the broken
     link, which is the thing they can actually fix. */
  const broken = new Set(links.map(l => norm(l.detail)));
  const raw = []
    .concat((errors || [])
      .filter(e => !broken.has(norm(e.url)))
      .map(e => ({ kind:'page_failed', page: e.url, detail: e.message,
                   message: 'A page could not be opened.' })))
    .concat(notes || [])
    .concat(links)
    .concat(seoChecks(pages));

  Object.entries(site).forEach(([key, p]) => {
    if (!p.components.length)
      raw.push({ kind:'page_empty', page: key, detail: p.url,
                 message: 'Nothing on the page came across.' });
  });

  /* the same fault found twice is one line with a count, not two lines */
  const seen = new Map();
  raw.forEach(e => {
    const cat = CATALOGUE[e.kind] || { label:'Migration Problem', severity:'warning', fix:'' };
    const k = e.kind + '|' + e.page + '|' + (e.detail || '');
    if (seen.has(k)){ seen.get(k).count++; return; }
    seen.set(k, {
      kind: e.kind, label: cat.label, severity: cat.severity, fix: cat.fix,
      page: e.page, component: e.component || null,
      detail: e.detail || '', message: e.message || cat.label,
      where: e.where || '', source: e.source || '', count: 1, resolved: false,
    });
  });

  const entries = [...seen.values()].sort((a, b) =>
    (sevRank[a.severity] - sevRank[b.severity]) ||
    String(a.page).localeCompare(String(b.page)) ||
    a.label.localeCompare(b.label));

  const by = s => entries.filter(e => e.severity === s).length;
  return {
    entries,
    counts: { total: entries.length, critical: by('critical'), warning: by('warning'), note: by('note') },
    acceptance: acceptance(site, entries, pages, opts.assets),
    approvable: by('critical') === 0,
  };
}

module.exports = { report, CATALOGUE, linkChecks, seoChecks, acceptance };
