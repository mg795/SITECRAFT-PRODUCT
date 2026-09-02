import test from 'node:test';
import assert from 'node:assert/strict';

import { diffWords, beforeRuns, afterRuns, retention } from '../src/diff.js';
import { verifyCopyBound, gateProposal, tokens } from '../src/verify.js';
import { audit, summarize, buildCard } from '../src/audit.js';

/* ══════════════ diff ══════════════ */

test('diff: identical text produces one unchanged run', () => {
  const runs = diffWords('same day crowns', 'same day crowns');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].op, '=');
});

test('diff: rejoining each side reconstructs the original strings', () => {
  const a = 'Our practice offers a wide range of dental services';
  const b = 'We offer a range of general and cosmetic dental services';
  const runs = diffWords(a, b);
  assert.equal(beforeRuns(runs).map((r) => r.text).join(''), a);
  assert.equal(afterRuns(runs).map((r) => r.text).join(''), b);
});

test('diff: adjacent same-op tokens merge into one run', () => {
  const runs = diffWords('Our Services', 'Same-Day Crowns And Clear Aligners');
  // The multi-word insertion must arrive as one run, not one run per word.
  const inserts = runs.filter((r) => r.op === '+');
  assert.ok(
    inserts.some((r) => r.text.trim().split(/\s+/).length >= 4),
    `expected a merged multi-word insertion, got ${JSON.stringify(inserts)}`);
});

test('diff: retention reports how much of the original survived', () => {
  assert.equal(retention(diffWords('a b c', 'a b c')), 1);
  assert.equal(retention(diffWords('a b c d', 'x y z w')), 0);
});

test('diff: oversized input falls back instead of allocating a huge matrix', () => {
  const big = 'word '.repeat(5000);
  const runs = diffWords(big, big + 'tail');
  assert.equal(runs.length, 2);
  assert.equal(runs[0].op, '-');
  assert.equal(runs[1].op, '+');
});

/* ══════════════ copy-bound verifier ══════════════ */

const PAGE = `
  Gentle Family Dentistry in Northgate, Seattle.
  We have been caring for families across North Seattle since 2004.
  Same-day crowns, clear aligners, and emergency appointments.
  We mill crowns in our own lab. Most patients arrive with a damaged
  tooth and leave the same afternoon with the permanent crown fitted.
`;

test('verify: a rewrite built only from page words passes', () => {
  const r = verifyCopyBound(PAGE, 'Same-day crowns and clear aligners for Northgate families');
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test('verify: function words may be introduced freely', () => {
  const r = verifyCopyBound(PAGE, 'We mill the crowns in our own lab, so that patients can leave with a permanent crown');
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test('verify: an invented content word is caught', () => {
  const r = verifyCopyBound(PAGE, 'Same-day crowns and award-winning orthodontics');
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.word === 'orthodontics'));
});

test('verify: an invented number is caught and typed as a number', () => {
  const r = verifyCopyBound(PAGE, 'Trusted by 5000 families since 2004');
  assert.equal(r.ok, false);
  const nums = r.violations.filter((v) => v.kind === 'number');
  assert.equal(nums.length, 1);
  assert.equal(nums[0].word, '5000');
});

test('verify: a number already on the page is allowed through', () => {
  const r = verifyCopyBound(PAGE, 'Caring for families since 2004');
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test('verify: light stemming lets plurals and inflections match', () => {
  // "aligner" (singular) from "aligners"; "milled" from "mill"
  const r = verifyCopyBound(PAGE, 'Every aligner is milled in our own lab');
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test('verify: strict mode disables stemming', () => {
  const r = verifyCopyBound(PAGE, 'Every aligner is fitted', { strict: true });
  assert.equal(r.ok, false);
});

test('verify: the allow list admits a brand name absent from the copy', () => {
  const bad = verifyCopyBound(PAGE, 'Northgate Family Dental fits crowns');
  assert.equal(bad.ok, false);
  const good = verifyCopyBound(PAGE, 'Northgate Family Dental fits crowns', { allow: ['Dental'] });
  assert.equal(good.ok, true, JSON.stringify(good.violations));
});

/* ── the safety property that matters most ── */

test('gate: a fabricated rating is rejected outright, never downgraded', () => {
  const g = gateProposal({
    sourceText: PAGE,
    before: 'Patients trust us',
    after: 'Rated 4.9 stars by 812 patients',
    checkId: 'SCHEMA-10',
  });
  assert.equal(g.accepted, false);
  assert.match(g.reason, /number/i);
});

test('gate: a clean restructure is accepted', () => {
  const g = gateProposal({
    sourceText: PAGE,
    before: 'We mill crowns in our own lab.',
    after: 'We mill crowns in our own lab, so patients leave with a permanent crown the same afternoon.',
    checkId: 'AEO-05',
  });
  assert.equal(g.accepted, true, g.reason);
});

test('tokens: punctuation and smart quotes are stripped', () => {
  assert.deepEqual(tokens('“Hello,” world!'), ['hello', 'world']);
});

/* ══════════════ checks ══════════════ */

const basePage = () => ({
  url: 'https://example.com/services',
  lang: 'en',
  title: 'Family Dentist in Northgate, Seattle | Northgate Dental',
  metas: { description: 'x'.repeat(148), 'og:title': 'T', 'og:description': 'D', 'og:image': 'i.jpg' },
  canonical: 'https://example.com/services',
  canonicalCount: 1,
  jsonld: [
    { '@type': 'Article', '@id': '#a', author: { '@id': '#org' }, datePublished: '2026-01-02T08:00:00-05:00' },
    { '@type': 'Organization', '@id': '#org' },
    { '@type': 'BreadcrumbList' },
  ],
  headings: [{ level: 1, text: 'H', id: 'h1' }, { level: 2, text: 'S', id: 'h2' }],
  paragraphs: [{ text: 'short copy here', id: 'p1' }],
  bands: [],
  images: [{ src: 'a.jpg', alt: 'a', id: 'i1' }],
  links: [{ href: '/x', text: 'Our services' }],
  faqs: [],
  authors: [],
  visibleReviewCount: 0,
  bodyText: 'short copy here',
});

test('audit: a clean page produces no findings', () => {
  const f = audit(basePage());
  assert.deepEqual(f, [], JSON.stringify(f, null, 1));
});

test('audit: findings are ordered P0 first, then by action class', () => {
  const p = basePage();
  p.metas.robots = 'noindex';                       // P0/A
  p.title = 'Short';                                // P3/B
  p.headings = [];                                  // P1/A  (no H1)
  const f = audit(p);
  assert.equal(f[0].severity, 'P0');
  const sevs = f.map((x) => x.severity);
  assert.deepEqual(sevs, [...sevs].sort(), 'severities should be non-decreasing');
});

test('audit: title outside the 50-60 band is P3 class B', () => {
  const p = basePage();
  p.title = 'Home';
  const f = audit(p).find((x) => x.checkId === 'META-02');
  assert.ok(f);
  assert.equal(f.actionClass, 'B');
  assert.match(f.message, /4 characters/);
});

test('audit: a missing canonical is P1 and auto-fixable', () => {
  const p = basePage();
  p.canonical = '';
  const f = audit(p).find((x) => x.checkId === 'META-07');
  assert.equal(f.severity, 'P1');
  assert.equal(f.actionClass, 'A');
});

test('audit: noindex is the top-severity finding', () => {
  const p = basePage();
  p.metas.robots = 'noindex, follow';
  const f = audit(p).find((x) => x.checkId === 'META-15');
  assert.equal(f.severity, 'P0');
});

test('audit: an unresolved schema @id reference is reported', () => {
  const p = basePage();
  p.jsonld = [{ '@type': 'Article', '@id': '#a', publisher: { '@id': '#missing' } }, { '@type': 'BreadcrumbList' }];
  const f = audit(p).find((x) => x.checkId === 'SCHEMA-04');
  assert.ok(f, 'expected SCHEMA-04');
  assert.match(f.message, /#missing/);
});

test('audit: rating markup with no visible reviews is P0 and flag-only', () => {
  const p = basePage();
  p.jsonld.push({ '@type': 'Product', aggregateRating: { ratingValue: '5', reviewCount: '200' } });
  const f = audit(p).find((x) => x.checkId === 'SCHEMA-10');
  assert.equal(f.severity, 'P0');
  assert.equal(f.actionClass, 'C', 'rating findings must never be auto-fixable');
});

test('audit: visible FAQ with no FAQPage markup is proposed, not auto-applied', () => {
  const p = basePage();
  p.faqs = [{ q: 'Does it last?', a: 'y '.repeat(50).trim(), id: 'f1' }];
  const f = audit(p).find((x) => x.checkId === 'SCHEMA-08');
  assert.equal(f.actionClass, 'B');
});

test('audit: an over-long paragraph is caught with its word count', () => {
  const p = basePage();
  p.paragraphs = [{ text: 'word '.repeat(95).trim(), id: 'p1' }];
  const f = audit(p).find((x) => x.checkId === 'AEO-05');
  assert.match(f.message, /95 words/);
  assert.equal(f.elementId, 'p1');
});

test('audit: FAQ answers outside 40-60 words are flagged in both directions', () => {
  const p = basePage();
  p.faqs = [
    { q: 'Long?', a: 'w '.repeat(97).trim(), id: 'f1' },
    { q: 'Short?', a: 'Yes.', id: 'f2' },
  ];
  const hits = audit(p).filter((x) => x.checkId === 'AEO-07');
  assert.equal(hits.length, 2);
});

test('audit: heading level skips are detected', () => {
  const p = basePage();
  p.headings = [{ level: 1, text: 'A', id: 'a' }, { level: 4, text: 'B', id: 'b' }];
  const f = audit(p).find((x) => x.checkId === 'AEO-02');
  assert.match(f.message, /H1 to H4/);
});

test('audit: more than one H1 is reported', () => {
  const p = basePage();
  p.headings = [{ level: 1, text: 'A', id: 'a' }, { level: 1, text: 'B', id: 'b' }];
  const f = audit(p).find((x) => x.checkId === 'AEO-01');
  assert.match(f.message, /2 H1/);
});

test('audit: the same alt text on different images is caught (the live RT defect)', () => {
  const p = basePage();
  p.images = [
    { src: 'seattle.webp', alt: 'Trust in high-ticket decisions wins the deal', id: 'i1' },
    { src: 'trust.webp', alt: 'Trust in high-ticket decisions wins the deal', id: 'i2' },
  ];
  const f = audit(p).find((x) => x.checkId === 'TECH-04');
  assert.ok(f, 'expected duplicate-alt finding');
  assert.equal(f.severity, 'P1');
});

test('audit: identical alt on the same src is not flagged', () => {
  const p = basePage();
  p.images = [{ src: 'a.webp', alt: 'same', id: 'i1' }, { src: 'a.webp', alt: 'same', id: 'i2' }];
  assert.equal(audit(p).find((x) => x.checkId === 'TECH-04'), undefined);
});

test('audit: one bio under several bylines is caught (the live RT defect)', () => {
  const p = basePage();
  p.authors = [
    { name: 'Jim Cronin', bio: 'Marshall leads new business development.' },
    { name: 'Rob Saxe', bio: 'Marshall leads new business development.' },
  ];
  const f = audit(p).find((x) => x.checkId === 'EEAT-02');
  assert.equal(f.severity, 'P1');
  assert.equal(f.actionClass, 'C');
  assert.match(f.message, /Jim Cronin/);
});

test('audit: an unsourced statistic is flag-only', () => {
  const p = basePage();
  p.bands = [{ text: '9 out of 10 patients say they felt no pain', id: 'b1', hasSource: false }];
  const f = audit(p).find((x) => x.checkId === 'EEAT-04');
  assert.equal(f.actionClass, 'C');
});

test('audit: a sourced statistic is not flagged', () => {
  const p = basePage();
  p.bands = [{ text: '9 out of 10 patients felt no pain', id: 'b1', hasSource: true }];
  assert.equal(audit(p).find((x) => x.checkId === 'EEAT-04'), undefined);
});

test('audit: a broken JSON-LD block is reported rather than throwing', () => {
  const p = basePage();
  p.jsonld = [{ __parseError: 'Unexpected token }' }];
  const f = audit(p).find((x) => x.checkId === 'SCHEMA-01');
  assert.match(f.message, /Unexpected token/);
});

test('audit: a throwing check degrades to a finding instead of killing the run', () => {
  const p = basePage();
  p.images = {};   // technicalChecks calls .filter on this and throws
  const f = audit(p);
  assert.ok(f.some((x) => x.checkId === 'ENGINE'), 'expected an ENGINE finding');
});

/* ══════════════ summarize / buildCard ══════════════ */

test('summarize: splits findings into the panel three tabs', () => {
  const p = basePage();
  p.canonical = '';                                       // A
  p.title = 'Home';                                       // B
  p.bands = [{ text: '9 out of 10 patients agree', id: 'b', hasSource: false }];  // C
  const s = summarize(audit(p));
  assert.ok(s.auto.length && s.review.length && s.blocked.length);
});

test('buildCard: an accepted rewrite carries runs and retention', () => {
  const page = { bodyText: PAGE };
  const finding = { checkId: 'AEO-03', severity: 'P2', actionClass: 'B', current: 'Our Services' };
  const card = buildCard(finding, 'Same-day crowns and clear aligners', page);
  assert.equal(card.rejected, undefined);
  assert.ok(card.runs.length > 0);
  assert.equal(typeof card.retention, 'number');
});

test('buildCard: a rewrite that invents a number is demoted to class C', () => {
  const page = { bodyText: PAGE };
  const finding = { checkId: 'AEO-03', severity: 'P2', actionClass: 'B', current: 'Our Services', message: 'Label.' };
  const card = buildCard(finding, 'Trusted by 812 families', page);
  assert.equal(card.actionClass, 'C');
  assert.equal(card.rejected, true);
  assert.equal(card.after, undefined, 'a rejected rewrite must not carry an applyable value');
});
