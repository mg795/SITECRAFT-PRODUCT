'use strict';
/*
 * Turn what the extractor saw into SiteCraft components.
 *
 * This is the part of migration that decides the product. A migration that dumps
 * the source page into one editable HTML field demonstrates well and then falls
 * apart the first time a client touches it: there is nothing to duplicate, nothing
 * to permit, nothing to keep on the design rules. So every band of the page has to
 * come out the far side as a known component with named fields, or be marked as
 * something a person needs to look at. Those are the only two outcomes.
 *
 * Where the shape is not clear, this errs towards the plainer component and leaves
 * a note in the exception report. A section that came across as Text when it was
 * really Image and Text costs an administrator one reclassification. A section
 * invented as something it is not costs them a hunt.
 */

const { LIBRARY, normalisePerms, isDuplicatable } = require('./library');

const MIN_BODY_WORDS = 8;
const words = s => (s || '').trim().split(/\s+/).filter(Boolean).length;
const clip  = (s, n) => (s || '').length > n ? (s || '').slice(0, n - 1).trimEnd() + '…' : (s || '');

/* The picture a section is actually about, rather than the first one in the markup. */
function leadImage(sec){
  const usable = sec.images.filter(im => im.w >= 120 && im.h >= 120 || im.background);
  if (!usable.length) return null;
  return usable.slice().sort((a, b) => (b.background - a.background) || (b.w * b.h - a.w * a.h))[0];
}
const bodyOf = sec => sec.paras.join('\n\n');
const buttonOf = sec => sec.links.find(l => l.button) || null;

function imageField(im){
  if (!im) return null;
  return { src: im.src, alt: im.alt || '', w: im.w || 0, h: im.h || 0 };
}

/* ── which component is this? ── */
/*
 * The order matters and is deliberate: the most specific shape wins. A row of
 * dated cards is a blog listing before it is a set of featured items, and a set of
 * featured items before it is an image beside some text.
 */
/* Whether a band exists to hold somebody else's application rather than content. */
function isEmbedBand(sec){
  const live = (sec.embeds || []).filter(e => e.handling !== 'drop');
  if (!live.length) return false;
  /* a heading and a line of introduction still counts: the widget is the point */
  return sec.words < 40 && !sec.images.length && !sec.items;
}

function classify(sec, page, index, ctx = {}){
  if (isEmbedBand(sec)) return 'embed';
  const hasItems  = !!(sec.items && sec.items.length >= 2);
  const datedItems = hasItems && sec.items.filter(i => i.dated).length >= Math.ceil(sec.items.length / 2);
  const img   = leadImage(sec);
  const text  = sec.words;
  const heads = sec.headings.length;
  const btn   = buttonOf(sec);

  if (page.blog === 'post' && index === 0 && heads) return 'blog_post';
  if (datedItems || (hasItems && page.blog === 'listing')) return 'blog_listing';
  if (hasItems && sec.items.filter(i => i.title || i.image).length >= 2) return 'featured_item';

  /* The hero is the first band above the fold carrying the page's own headline —
     not simply the first band. A page whose cover photo could not be folded in
     still has its headline one band further down, and that is the hero. */
  const isHero = sec.hero && !ctx.heroTaken &&
                 sec.headings.some(h => h.level <= 2) &&
                 (img || text >= 6 || !!sec.eyebrow);
  if (isHero) return 'hero';

  if (img && (heads || text >= MIN_BODY_WORDS)) return 'image_text';
  if (img && !heads && text < MIN_BODY_WORDS) return 'image';
  if (!img && btn && text < 60 && heads) return 'cta';
  if (heads || text || sec.lists.length) return 'text';
  return null;
}

/* ── fields, one builder per type ── */
const BUILD = {
  hero(sec){
    const img = leadImage(sec);
    const btn = buttonOf(sec);
    const head = sec.headings[0];
    return {
      eyebrow:  sec.eyebrow || undefined,
      headline: head ? head.text : '',
      body:     bodyOf(sec) || undefined,
      image:    imageField(img) || undefined,
      ctaLabel: btn ? btn.label : undefined,
      ctaHref:  btn ? btn.href : undefined,
    };
  },
  text(sec){
    return {
      headline: sec.headings[0] ? sec.headings[0].text : undefined,
      body:     bodyOf(sec) || undefined,
      list:     sec.lists.length ? sec.lists[0] : undefined,
    };
  },
  image(sec){
    const img = leadImage(sec);
    return { image: imageField(img), caption: sec.paras[0] || undefined };
  },
  image_text(sec){
    const img = leadImage(sec);
    const btn = buttonOf(sec);
    return {
      headline: sec.headings[0] ? sec.headings[0].text : undefined,
      body:     bodyOf(sec) || undefined,
      image:    imageField(img),
      list:     sec.lists.length ? sec.lists[0] : undefined,
      ctaLabel: btn ? btn.label : undefined,
      ctaHref:  btn ? btn.href : undefined,
    };
  },
  cta(sec){
    const btn = buttonOf(sec);
    return {
      headline: sec.headings[0] ? sec.headings[0].text : '',
      body:     bodyOf(sec) || undefined,
      ctaLabel: btn ? btn.label : '',
      ctaHref:  btn ? btn.href : '',
    };
  },
  featured_item(sec){
    return {
      headline: sec.headings[0] ? sec.headings[0].text : undefined,
      items: sec.items.map(it => ({
        title: it.title || '',
        body:  clip(it.body, 400) || undefined,
        image: imageField(it.image) || undefined,
        href:  it.href || undefined,
        meta:  it.meta || undefined,
      })),
    };
  },
  blog_listing(sec){
    return {
      headline: sec.headings[0] ? sec.headings[0].text : undefined,
      body: bodyOf(sec) || undefined,
      source: 'Every published post on this site',
    };
  },
  embed(sec){
    const e = (sec.embeds || []).filter(x => x.handling !== 'drop')[0] || {};
    return {
      vendor: e.vendor || 'Unknown',
      feature: e.feature || 'Embedded Application',
      /* only something SiteCraft is willing to keep carries its address forward */
      src: e.handling === 'embed' ? (e.source || '') : '',
      headline: sec.headings[0] ? sec.headings[0].text : undefined,
      /* whatever the band said around the widget is still the client's copy */
      body: bodyOf(sec) || undefined,
    };
  },
  blog_post(sec, page){
    const img = leadImage(sec);
    const dated = (page.meta.schema || []).map(s => s && s.datePublished).find(Boolean);
    return {
      title:  sec.headings[0] ? sec.headings[0].text : page.name,
      image:  imageField(img) || undefined,
      body:   bodyOf(sec) || undefined,
      author: undefined,
      date:   dated || undefined,
    };
  },
};

/* A component is only worth making if it holds something. */
function isEmpty(type, fields){
  const def = LIBRARY[type];
  return !Object.keys(def.fields).some(k => {
    if (!def.fields[k].optional && fields[k] !== undefined) return true;
    return fields[k] !== undefined && fields[k] !== '' &&
           !(Array.isArray(fields[k]) && !fields[k].length);
  });
}

/* Anything required by the library but missing on the page is worth saying out
   loud, because that is exactly what an administrator will otherwise find by
   clicking through every page. */
function shortfalls(type, fields){
  const def = LIBRARY[type], out = [];
  const empty = (k) => {
    const f = def.fields[k], v = fields[k];
    return v === undefined || v === '' || (Array.isArray(v) && !v.length) ||
           (f && f.kind === 'image' && (!v || !v.src));
  };
  for (const [k, f] of Object.entries(def.fields)){
    if (f.optional || !f.editable) continue;
    if (empty(k)) out.push(k);
  }
  /* a group where any one member will do: a heading over a list needs no paragraph */
  for (const group of def.requires || [])
    if (group.every(empty)) out.push(group.join(' or '));
  return out;
}

/*
 * A full-bleed picture directly above the page's headline is one hero, not a photo
 * and then a paragraph. Builders lay it out as two bands because the picture has to
 * run to the edges and the words must not; SiteCraft should not inherit that.
 */
function mergeCover(sections){
  const out = sections.slice();
  const a = out[0], b = out[1];
  if (!a || !b) return out;
  const coverOnly = a.hero && !a.headings.length && a.words < 4 && a.images.length && !a.items;
  const headsNext = b.headings.some(h => h.level <= 2) && b.hero;
  /* Only when the headline band has no picture of its own. A Hero holds one image,
     so folding a cover into a band that already has one would quietly lose the
     other; two components is the honest answer there. */
  if (!coverOnly || !headsNext || b.images.length) return out;
  b.images = a.images.concat(b.images);
  out.shift();
  return out;
}

/* ── third-party features become components of their own ── */
/*
 * Never silently dropped and never rebuilt. A booking tool or an IDX feed keeps its
 * place on the page as a component an administrator has to decide about, so the
 * page it came from does not quietly lose the thing the business runs on.
 */
function embedComponents(page, prefix, placed){
  return page.thirdParty
    .filter(t => (t.kind === 'embed' || t.kind === 'form') && t.handling !== 'drop')
    .filter(t => !(placed && placed.has(t.source)))
    .map((t, i) => ({
      id: prefix + '-tp' + (i + 1),
      type: 'embed',
      fields: { vendor: t.vendor, feature: t.feature, src: t.handling === 'embed' ? t.source : '' },
      perms: null,
      duplicatable: false,
      status: 'review',
      review: {
        reason: t.handling === 'embed'
          ? 'Can be kept as the embed it already is, once approved.'
          : 'SiteCraft will not rebuild this. Decide whether to keep the embed or replace it.',
        where: t.where, source: t.source, kind: t.kind,
      },
    }));
}

/*
 * componentize(page, opts) -> { components, notes }
 *
 * `notes` are facts for the exception report. Nothing here throws away a section:
 * one that cannot be classified still comes through, as a Text component carrying
 * whatever was in it, with a note saying it needs a look.
 */
function componentize(page, opts = {}){
  const prefix = opts.prefix || page.key;
  const components = [], notes = [], placed = new Set();
  let n = 0;

  let heroTaken = false;
  mergeCover(page.sections).forEach((sec, index) => {
    const type = classify(sec, page, index, { heroTaken });
    if (type === 'hero') heroTaken = true;
    if (!type){
      notes.push({ kind:'section_skipped', page: page.key, detail: sec.cls || sec.tag,
                   message: 'A band of the page held nothing SiteCraft could carry across.' });
      return;
    }
    const fields = BUILD[type](sec, page);
    if (isEmpty(type, fields)){
      notes.push({ kind:'section_skipped', page: page.key, detail: sec.cls || sec.tag,
                   message: 'A band of the page came out empty and was left behind.' });
      return;
    }
    const id = prefix + '-' + (++n);
    const missing = type === 'embed' ? [] : shortfalls(type, fields);
    const comp = {
      id, type,
      fields,
      perms: normalisePerms(type, opts.perms && opts.perms[id]),
      duplicatable: isDuplicatable(type),
      status: missing.length ? 'review' : 'ok',
      source: { tag: sec.tag, cls: sec.cls, top: sec.top, height: sec.height, columns: sec.columns },
    };
    if (sec.hero) comp.hero = 1;
    if (type === 'embed'){
      const e = (sec.embeds || []).filter(x => x.handling !== 'drop')[0] || {};
      comp.status = 'review';
      comp.review = {
        reason: e.handling === 'embed'
          ? 'Can be kept as the embed it already is, once approved.'
          : 'SiteCraft will not rebuild this. Decide whether to keep the embed or replace it.',
        where: sec.headings[0] ? sec.headings[0].text : sec.cls, source: e.source || '', kind: e.kind || 'embed',
      };
      placed.add(e.source || '');
    }
    if (missing.length){
      comp.review = { reason: 'Nothing on the page filled: ' + missing.join(', ') + '.', missing };
      notes.push({ kind:'component_incomplete', page: page.key, component: id,
                   detail: type + ': ' + missing.join(', '),
                   message: 'A component came across without something it needs.' });
    }
    /* A band with more pictures than its component can hold loses the rest. That is
       sometimes right and sometimes a card grid that was not recognised, so it is
       never done quietly. */
    const held = 1 + (type === 'featured_item' ? (fields.items || []).length : 0);
    if (sec.images.length > held)
      notes.push({ kind:'images_dropped', page: page.key, component: id,
                   detail: (sec.images.length - held) + ' of ' + sec.images.length + ' pictures',
                   message: 'A band held more pictures than this component shows.' });

    /* pictures with nothing behind them are the commonest fault of all */
    sec.images.forEach(im => {
      if (!im.loaded && !im.background)
        notes.push({ kind:'image_missing', page: page.key, component: id, detail: im.src,
                     message: 'A picture on the source page did not load.' });
      if (!im.hasAlt && !im.background)
        notes.push({ kind:'alt_missing', page: page.key, component: id, detail: im.src,
                     message: 'A picture has no description, so search engines and screen readers cannot read it.' });
    });
    if (sec.tables.length)
      notes.push({ kind:'table_unsupported', page: page.key, component: id,
                   detail: sec.tables.length + ' table(s)',
                   message: 'A table was found. Phase 1 has no table component, so it came across as text.' });
    components.push(comp);
  });

  components.push(...embedComponents(page, prefix, placed));
  page.thirdParty.filter(t => t.handling === 'drop').forEach(t => {
    notes.push({ kind:'script_dropped', page: page.key, detail: t.vendor + ' (' + t.feature + ')',
                 message: 'Third-party code was found and deliberately not carried across.' });
  });
  page.thirdParty.filter(t => t.handling !== 'drop').forEach(t => {
    notes.push({ kind:'third_party', page: page.key, detail: t.vendor + ' — ' + t.feature,
                 message: 'A third-party feature needs a decision before this site goes to the client.',
                 where: t.where, source: t.source });
  });

  return { components, notes };
}

module.exports = { componentize, classify, embedComponents, leadImage, shortfalls, mergeCover };
