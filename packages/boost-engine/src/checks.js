/**
 * Deterministic checks.
 *
 * These are the rubric checks that can be decided from the page model
 * alone — no model call, no network. They are cheap, instant, and they
 * are the ones that should run on every keystroke in the edit view.
 *
 * Checks needing judgement (is this H2 a claim? is this advice generic?)
 * live in llm-checks and carry a cost; see COVERAGE.md for the split.
 *
 * Every check returns findings shaped:
 *   { checkId, severity, actionClass, elementId, label, message, current }
 */

const F = (checkId, severity, actionClass, o) => ({ checkId, severity, actionClass, ...o });
const words = (s) => (String(s || '').trim() ? String(s).trim().split(/\s+/).length : 0);

/* ── Layer 1: metadata ───────────────────────────────────────────── */

export function metaChecks(page) {
  const out = [];
  const title = page.title || '';
  const desc = page.metas?.description || '';

  if (!title.trim()) {
    out.push(F('META-01', 'P1', 'A', { label: 'Page title', message: 'This page has no title.' }));
  } else if (title.length < 50 || title.length > 60) {
    out.push(F('META-02', 'P3', 'B', {
      label: 'Page title',
      current: title,
      message: `${title.length} characters. The band is 50–60 with the key phrase near the front.`,
    }));
  }

  if (!desc.trim()) {
    out.push(F('META-04', 'P1', 'A', { label: 'Meta description', message: 'This page has no meta description.' }));
  } else if (desc.length < 140 || desc.length > 155) {
    out.push(F('META-05', 'P3', 'B', {
      label: 'Meta description',
      current: desc,
      message: `${desc.length} characters. The band is 140–155.`,
    }));
  }

  if (!page.canonical) {
    out.push(F('META-07', 'P1', 'A', {
      label: 'Page head',
      message: 'No canonical link, so search engines may treat this page as a duplicate.',
    }));
  } else if (!/^https?:\/\//i.test(page.canonical)) {
    out.push(F('META-07', 'P1', 'A', {
      label: 'Page head',
      current: page.canonical,
      message: 'The canonical link is relative. It must be an absolute URL.',
    }));
  }

  const robots = page.metas?.robots || '';
  if (/noindex/i.test(robots)) {
    out.push(F('META-15', 'P0', 'A', {
      label: 'Page head',
      current: robots,
      message: 'This page is set to noindex — search engines are being told to ignore it.',
    }));
  }

  for (const [key, id] of [['og:title', 'META-16'], ['og:description', 'META-16'], ['og:image', 'META-16']]) {
    if (!page.metas?.[key]) {
      out.push(F(id, 'P2', 'A', { label: 'Social preview', message: `Missing ${key}.` }));
    }
  }

  // Social metadata that disagrees with the page it describes.
  const h1 = page.headings?.find((h) => h.level === 1);
  if (page.metas?.['og:title'] && h1 && page.metas['og:title'].trim() === '') {
    out.push(F('META-18', 'P1', 'A', { label: 'Social preview', message: 'og:title is empty.' }));
  }

  return out;
}

/* ── Layer 2: structured data ────────────────────────────────────── */

export function schemaChecks(page) {
  const out = [];
  const nodes = page.jsonld || [];

  for (const n of nodes) {
    if (n.__parseError) {
      out.push(F('SCHEMA-01', 'P1', 'A', {
        label: 'Structured data',
        message: `A JSON-LD block does not parse: ${n.__parseError}`,
      }));
    }
  }

  const valid = nodes.filter((n) => !n.__parseError);
  const types = new Set(valid.map((n) => n['@type']).filter(Boolean));
  const PRIMARY = ['Article', 'WebPage', 'Service', 'Product', 'LocalBusiness', 'FAQPage', 'Organization'];
  if (valid.length === 0 || !PRIMARY.some((t) => types.has(t))) {
    out.push(F('SCHEMA-02', 'P1', 'A', {
      label: 'Structured data',
      message: 'No primary entity schema on a substantive page.',
    }));
  }

  if (!types.has('BreadcrumbList')) {
    out.push(F('SCHEMA-03', 'P2', 'A', { label: 'Structured data', message: 'No BreadcrumbList schema.' }));
  }

  // @id graph integrity: every reference must resolve to a defined node.
  const defined = new Set(valid.map((n) => n['@id']).filter(Boolean));
  const refs = [];
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, val] of Object.entries(v)) {
      if (k === '@id' && typeof val === 'string') refs.push(val);
      else walk(val);
    }
  };
  valid.forEach((n) => { for (const [k, v] of Object.entries(n)) if (k !== '@id') walk(v); });
  for (const r of new Set(refs)) {
    if (!defined.has(r)) {
      out.push(F('SCHEMA-04', 'P1', 'A', {
        label: 'Structured data',
        current: r,
        message: `A schema reference points at "${r}", which is not defined on this page.`,
      }));
    }
  }

  // Dates.
  for (const n of valid) {
    const pub = n.datePublished;
    const mod = n.dateModified;
    const iso = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z))?$/;
    if (pub && !iso.test(pub)) {
      out.push(F('SCHEMA-05', 'P2', 'A', { label: 'Structured data', current: pub, message: 'datePublished is not ISO-8601.' }));
    }
    if (pub && mod && iso.test(pub) && iso.test(mod) && new Date(mod) < new Date(pub)) {
      out.push(F('SCHEMA-05', 'P2', 'A', { label: 'Structured data', message: 'dateModified is earlier than datePublished.' }));
    }
  }

  // Ratings without visible reviews — the highest-risk finding in the rubric.
  const rated = valid.filter((n) => n.aggregateRating || n['@type'] === 'AggregateRating');
  if (rated.length && (page.visibleReviewCount || 0) === 0) {
    out.push(F('SCHEMA-10', 'P0', 'C', {
      label: 'Structured data',
      message: 'Rating markup is present but no reviews are visible on the page. Sitecraft will not generate or adjust rating data.',
    }));
  }
  for (const n of rated) {
    const ar = n.aggregateRating || n;
    const claimed = Number(ar.reviewCount);
    if (Number.isFinite(claimed) && page.visibleReviewCount > 0 && claimed !== page.visibleReviewCount) {
      out.push(F('SCHEMA-10', 'P0', 'C', {
        label: 'Structured data',
        message: `Markup claims ${claimed} reviews but ${page.visibleReviewCount} are visible on the page.`,
      }));
    }
  }

  // FAQ present in the copy but never marked up.
  if ((page.faqs?.length || 0) > 0 && !types.has('FAQPage')) {
    out.push(F('SCHEMA-08', 'P2', 'B', {
      label: 'Questions section',
      message: `${page.faqs.length} question-and-answer pairs are visible but not marked up as an FAQ.`,
    }));
  }

  return out;
}

/* ── Layer 3: answer-shaped content ──────────────────────────────── */

export function contentChecks(page, { maxParagraphWords = 80, faqBand = [40, 60] } = {}) {
  const out = [];
  const hs = page.headings || [];

  const h1s = hs.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    out.push(F('AEO-01', 'P1', 'A', { label: 'Headings', message: 'This page has no H1.' }));
  } else if (h1s.length > 1) {
    out.push(F('AEO-01', 'P1', 'A', {
      label: 'Headings',
      message: `${h1s.length} H1 headings. A page should have exactly one.`,
    }));
  }

  for (let i = 1; i < hs.length; i++) {
    if (hs[i].level - hs[i - 1].level > 1) {
      out.push(F('AEO-02', 'P2', 'A', {
        elementId: hs[i].id,
        label: `Heading ${hs[i].level}`,
        current: hs[i].text,
        message: `Jumps from H${hs[i - 1].level} to H${hs[i].level}, skipping a level.`,
      }));
    }
  }

  for (const p of page.paragraphs || []) {
    const n = words(p.text);
    if (n > maxParagraphWords) {
      out.push(F('AEO-05', 'P2', 'B', {
        elementId: p.id,
        label: 'Paragraph',
        current: p.text,
        message: `${n} words in one paragraph. Long blocks give an answer engine no clean chunk to lift.`,
      }));
    }
  }

  for (const f of page.faqs || []) {
    const n = words(f.a);
    if (n < faqBand[0] || n > faqBand[1]) {
      out.push(F('AEO-07', 'P2', 'B', {
        elementId: f.id,
        label: 'FAQ answer',
        current: f.a,
        message: `${n} words. Answers of ${faqBand[0]}–${faqBand[1]} words are the ones that get quoted whole.`,
      }));
    }
  }

  for (const l of page.links || []) {
    if (/^(click here|read more|learn more|here|more)$/i.test(String(l.text || '').trim())) {
      out.push(F('AEO-10', 'P3', 'A', {
        label: 'Link',
        current: l.text,
        message: 'Anchor text does not say where the link goes.',
      }));
    }
  }

  return out;
}

/* ── Layer 5: technical ──────────────────────────────────────────── */

export function technicalChecks(page) {
  const out = [];

  if (!page.lang) {
    out.push(F('TECH-01', 'P2', 'A', { label: 'Page head', message: 'No lang attribute on the html element.' }));
  }
  if ((page.canonicalCount || 0) > 1) {
    out.push(F('TECH-02', 'P1', 'A', {
      label: 'Page head',
      message: `${page.canonicalCount} canonical links. There must be exactly one.`,
    }));
  }

  const noAlt = (page.images || []).filter((i) => i.alt == null);
  if (noAlt.length) {
    out.push(F('TECH-03', 'P2', 'A', {
      label: `${noAlt.length} image${noAlt.length === 1 ? '' : 's'}`,
      message: `${noAlt.length} image${noAlt.length === 1 ? ' has' : 's have'} no alt description.`,
    }));
  }

  // Alt text duplicated across different images is the copy-paste signature
  // that produced the live defect on the ReadTomato blog.
  const byAlt = new Map();
  for (const img of page.images || []) {
    if (!img.alt) continue;
    const k = img.alt.trim().toLowerCase();
    if (!byAlt.has(k)) byAlt.set(k, []);
    byAlt.get(k).push(img);
  }
  for (const [, group] of byAlt) {
    const distinctSrc = new Set(group.map((g) => g.src));
    if (group.length > 1 && distinctSrc.size > 1) {
      out.push(F('TECH-04', 'P1', 'A', {
        label: 'Image alt text',
        current: group[0].alt,
        message: `The same alt text is on ${group.length} different images.`,
      }));
    }
  }

  const ids = (page.headings || []).map((h) => h.id).filter(Boolean);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const id of new Set(dupes)) {
    out.push(F('TECH-07', 'P3', 'A', { label: 'Headings', current: id, message: `Duplicate id "${id}".` }));
  }

  return out;
}

/* ── Layer 4: entity & trust (deterministic subset) ──────────────── */

export function trustChecks(page) {
  const out = [];

  // An unsourced statistic. Deliberately narrow: a bare number next to a
  // claim verb, with no cite/source anywhere in the block.
  for (const p of [...(page.paragraphs || []), ...(page.bands || [])]) {
    const stat = /\b\d+(\.\d+)?\s*(%|percent|out of \d+|in \d+)\b/i.test(p.text)
      || /\b\d{2,}\+?\s+(patients|clients|customers|reviews|families)\b/i.test(p.text);
    if (stat && !p.hasSource) {
      out.push(F('EEAT-04', 'P2', 'C', {
        elementId: p.id,
        label: 'Statistic',
        current: p.text,
        message: 'A figure is stated with no source on the page. Sitecraft cannot source this — it needs a fact the page does not contain.',
      }));
    }
  }

  // The same bio under different bylines — the live ReadTomato defect.
  const byBio = new Map();
  for (const a of page.authors || []) {
    if (!a.bio) continue;
    const k = a.bio.trim().toLowerCase();
    if (!byBio.has(k)) byBio.set(k, new Set());
    byBio.get(k).add(a.name);
  }
  for (const [, names] of byBio) {
    if (names.size > 1) {
      out.push(F('EEAT-02', 'P1', 'C', {
        label: 'Author',
        message: `The same biography appears under ${names.size} different names (${[...names].join(', ')}).`,
      }));
    }
  }

  return out;
}

export const ALL_CHECKS = [metaChecks, schemaChecks, contentChecks, technicalChecks, trustChecks];
