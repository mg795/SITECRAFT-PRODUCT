/**
 * The audit runner and the DOM adapter.
 *
 * The engine deliberately does not take a Document. It takes a PageModel —
 * a plain object — so the same checks run in a browser, in a worker, on a
 * server, or in tests with no DOM at all. `fromDocument` is the only piece
 * that knows about the browser, and it is thin enough to re-write for
 * whatever the host CMS gives you.
 */

import { ALL_CHECKS } from './checks.js';
import { gateProposal } from './verify.js';
import { diffWords, retention } from './diff.js';

const SEVERITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
const CLASS_ORDER = { A: 0, B: 1, C: 2 };

/**
 * @typedef {object} PageModel
 * @property {string}  url
 * @property {string}  lang
 * @property {string}  title
 * @property {object}  metas              name/property -> content
 * @property {string}  canonical
 * @property {number}  canonicalCount
 * @property {object[]} jsonld            parsed nodes; parse failures carry __parseError
 * @property {object[]} headings          {level, text, id}
 * @property {object[]} paragraphs        {text, id, hasSource}
 * @property {object[]} bands             {text, id, hasSource}  callouts / trust strips
 * @property {object[]} images            {src, alt, id}
 * @property {object[]} links             {href, text}
 * @property {object[]} faqs              {q, a, id}
 * @property {object[]} authors           {name, bio}
 * @property {number}  visibleReviewCount
 * @property {string}  bodyText           all visible copy — the copy-bound source
 */

/** Extract a PageModel from a live Document. */
export function fromDocument(doc, { root = doc.body } = {}) {
  const metas = {};
  for (const m of doc.querySelectorAll('meta[name], meta[property]')) {
    const k = m.getAttribute('name') || m.getAttribute('property');
    if (k && !(k in metas)) metas[k] = m.getAttribute('content') || '';
  }

  const jsonld = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(s.textContent);
      for (const n of Array.isArray(parsed) ? parsed : [parsed]) {
        if (n && n['@graph']) jsonld.push(...n['@graph']);
        else jsonld.push(n);
      }
    } catch (e) {
      jsonld.push({ __parseError: e.message });
    }
  }

  const canonicals = doc.querySelectorAll('link[rel="canonical"]');
  const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const hasSource = (el) =>
    !!el.querySelector('cite, a[href], [data-source]') || /source:|according to/i.test(el.textContent || '');

  const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h, i) => ({
    level: Number(h.tagName[1]),
    text: text(h),
    id: h.id || h.dataset.el || `h-${i}`,
  }));

  // An FAQ pair is a heading immediately followed by prose.
  const faqs = [];
  for (const h of root.querySelectorAll('h3,h4')) {
    const q = text(h);
    const next = h.nextElementSibling;
    if (/\?\s*$/.test(q) && next && next.tagName === 'P') {
      faqs.push({ q, a: text(next), id: next.id || next.dataset.el || null });
    }
  }
  const faqAnswerIds = new Set(faqs.map((f) => f.id).filter(Boolean));

  const paragraphs = [...root.querySelectorAll('p')]
    .map((p, i) => ({ text: text(p), id: p.id || p.dataset.el || `p-${i}`, hasSource: hasSource(p) }))
    .filter((p) => p.text && !faqAnswerIds.has(p.id));

  return {
    url: doc.location?.href || '',
    lang: doc.documentElement.getAttribute('lang') || '',
    title: (doc.querySelector('title')?.textContent || '').trim(),
    metas,
    canonical: canonicals[0]?.getAttribute('href') || '',
    canonicalCount: canonicals.length,
    jsonld,
    headings,
    paragraphs,
    bands: [...root.querySelectorAll('[data-band], .band, aside')].map((b, i) => ({
      text: text(b), id: b.id || b.dataset.el || `band-${i}`, hasSource: hasSource(b),
    })),
    images: [...root.querySelectorAll('img')].map((img, i) => ({
      src: img.getAttribute('src') || '',
      alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
      id: img.id || `img-${i}`,
    })),
    links: [...root.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), text: text(a) })),
    faqs,
    authors: [...root.querySelectorAll('[data-author]')].map((a) => ({
      name: a.dataset.author,
      bio: text(a.querySelector('[data-author-bio]') || a),
    })),
    visibleReviewCount: root.querySelectorAll('[data-review], .review').length,
    bodyText: text(root),
  };
}

/**
 * Run every deterministic check and return findings in working order:
 * P0 first, and within a tier, the things Sitecraft can fix itself before
 * the things that need a human.
 */
export function audit(page, opts = {}) {
  const findings = ALL_CHECKS.flatMap((fn) => {
    try {
      return fn(page, opts) || [];
    } catch (e) {
      return [{
        checkId: 'ENGINE', severity: 'P3', actionClass: 'C',
        label: 'Engine', message: `Check "${fn.name}" failed: ${e.message}`,
      }];
    }
  });

  findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    || (CLASS_ORDER[a.actionClass] - CLASS_ORDER[b.actionClass])
    || a.checkId.localeCompare(b.checkId));

  return findings;
}

/** Roll findings up into the three groups the Boost panel renders. */
export function summarize(findings) {
  return {
    auto: findings.filter((f) => f.actionClass === 'A'),
    review: findings.filter((f) => f.actionClass === 'B'),
    blocked: findings.filter((f) => f.actionClass === 'C'),
    worst: findings.length ? findings[0].severity : null,
  };
}

/**
 * Turn a class-B finding plus a candidate rewrite into a review card —
 * but only if the rewrite survives the copy-bound verifier.
 *
 * This is the choke point. Whether the rewrite came from a template or a
 * language model, it does not reach a client without passing through here.
 */
export function buildCard(finding, candidate, page, { allow = [] } = {}) {
  const before = finding.current ?? '';
  const gate = gateProposal({
    sourceText: page.bodyText || '',
    before,
    after: candidate,
    checkId: finding.checkId,
    allow,
  });

  if (!gate.accepted) {
    return {
      ...finding,
      actionClass: 'C',
      rejected: true,
      message: `${finding.message} ${gate.reason}`,
    };
  }

  const runs = diffWords(before, candidate);
  return {
    ...finding,
    before,
    after: candidate,
    runs,
    retention: retention(runs),
  };
}
