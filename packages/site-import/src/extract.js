(function(){
'use strict';
/*
 * Read one rendered page of a client's site.
 *
 * This runs INSIDE the page, against a real Document. In production that page is a
 * headless browser pointed at the client's site; in tests it is a fixture loaded
 * from disk. Same code either way, which is the point: most small-business sites
 * are built on Squarespace, Wix or a WordPress page builder and put their content
 * in with JavaScript, so parsing the HTML that comes off the wire would miss it.
 *
 * What comes back is deliberately raw. This file reports what is on the page and
 * how it is laid out; deciding which SiteCraft component that amounts to is
 * componentize.js, in Node, where it can be read and argued with. Nothing here
 * copies markup: the output is text, sources, measurements and classifications.
 */

/* ── chrome: the parts of a page that belong to the site, not to the page ── */
const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','CANVAS',
                           'NAV','HEADER','FOOTER','ASIDE','SELECT','TEXTAREA']);
const SKIP_ROLES = new Set(['navigation','banner','contentinfo','complementary','search','menu','menubar','dialog']);
const CHROME = /(^|[\s_-])(nav|navbar|menu|header|footer|sidebar|breadcrumb|cookie|consent|popup|modal|newsletter|subscribe|social|share|skip-link|screen-reader|sr-only|visually-hidden)([\s_-]|$)/i;
/* "banner" is not on that list on purpose: a cookie banner is caught by "cookie",
   while page-banner and hero-banner are what themes call the cover photo. */

const MIN_PARAGRAPH_WORDS = 8;      /* shorter than this is a caption or a label */
const MIN_IMAGE_PX        = 120;    /* smaller than this is an icon or a spacer */
const MIN_SECTION_PX      = 48;     /* shorter than this is a rule or a spacer */
const MAX_SECTIONS        = 40;
const MAX_ITEMS           = 24;     /* repeated cards taken from one row */

/*
 * Third-party features, by who provides them.
 *
 * `handling` is the whole judgement: 'embed' may be preserved as the embed it
 * already is, 'review' is shown to an administrator to decide, and 'drop' is never
 * reproduced at all. Tracking is always dropped — carrying someone's analytics
 * across into a staging copy would send them fictitious traffic.
 */
const VENDORS = [
  { v:'Calendly',           f:'Scheduling',      h:'review', t:/calendly\.com/i },
  { v:'Acuity Scheduling',  f:'Scheduling',      h:'review', t:/acuityscheduling\.com/i },
  { v:'LocalMed',           f:'Scheduling',      h:'review', t:/localmed\.com/i },
  { v:'NexHealth',          f:'Patient Portal',  h:'review', t:/nexhealth\.com/i },
  { v:'SimplePractice',     f:'Patient Portal',  h:'review', t:/simplepractice\.com/i },
  { v:'DoctorLogic',        f:'Patient Portal',  h:'review', t:/doctorlogic\.com/i },
  { v:'Dentrix',            f:'Patient Portal',  h:'review', t:/dentrix|henryschein/i },
  { v:'IDX Broker',         f:'IDX',             h:'review', t:/idxbroker\.com/i },
  { v:'iHomefinder',        f:'IDX',             h:'review', t:/ihomefinder\.com/i },
  { v:'Showcase IDX',       f:'IDX',             h:'review', t:/showcaseidx\.com/i },
  { v:'RealScout',          f:'IDX',             h:'review', t:/realscout\.com/i },
  { v:'Zillow',             f:'Listings',        h:'review', t:/zillow(static)?\.com/i },
  { v:'Google Maps',        f:'Map',             h:'embed',  t:/(google\.[a-z.]+\/maps|maps\.google|maps\.googleapis)/i },
  { v:'Mapbox',             f:'Map',             h:'embed',  t:/mapbox\.com/i },
  { v:'YouTube',            f:'Video',           h:'embed',  t:/(youtube(-nocookie)?\.com|youtu\.be)/i },
  { v:'Vimeo',              f:'Video',           h:'embed',  t:/(player\.)?vimeo\.com/i },
  { v:'Intercom',           f:'Chat',            h:'review', t:/intercom(cdn)?\.(io|com)/i },
  { v:'Drift',              f:'Chat',            h:'review', t:/drift\.com/i },
  { v:'Tawk.to',            f:'Chat',            h:'review', t:/tawk\.to/i },
  { v:'Podium',             f:'Chat',            h:'review', t:/podium\.com/i },
  { v:'Birdeye',            f:'Reviews',         h:'review', t:/birdeye\.com/i },
  { v:'Trustpilot',         f:'Reviews',         h:'review', t:/trustpilot\.com/i },
  { v:'Yelp',               f:'Reviews',         h:'review', t:/yelp\.com/i },
  { v:'Shopify',            f:'Ecommerce',       h:'review', t:/shopify\.(com|dev)|myshopify/i },
  { v:'Stripe',             f:'Payments',        h:'review', t:/stripe\.(com|network)/i },
  { v:'Square',             f:'Payments',        h:'review', t:/squareup\.com/i },
  { v:'PayPal',             f:'Payments',        h:'review', t:/paypal(objects)?\.com/i },
  { v:'Mailchimp',          f:'Marketing',       h:'review', t:/(mailchimp|list-manage)\.com/i },
  { v:'Constant Contact',   f:'Marketing',       h:'review', t:/constantcontact\.com/i },
  { v:'HubSpot',            f:'Marketing',       h:'review', t:/(hs-scripts|hubspot|hsforms)\.(com|net)/i },
  { v:'Typeform',           f:'Form',            h:'review', t:/typeform\.com/i },
  { v:'JotForm',            f:'Form',            h:'review', t:/jotform\.com/i },
  { v:'Google Tag Manager', f:'Tracking',        h:'drop',   t:/googletagmanager\.com/i },
  { v:'Google Analytics',   f:'Tracking',        h:'drop',   t:/google-analytics\.com|gtag\/js/i },
  { v:'Meta Pixel',         f:'Tracking',        h:'drop',   t:/connect\.facebook\.net/i },
  { v:'Hotjar',             f:'Tracking',        h:'drop',   t:/hotjar\.com/i },
  { v:'LinkedIn Insight',   f:'Tracking',        h:'drop',   t:/snap\.licdn\.com/i },
];
const hostOf = u => { try { return new URL(u).hostname; } catch { return 'Off-site'; } };
const vendorOf = url => {
  for (const x of VENDORS) if (x.t.test(url)) return { vendor:x.v, feature:x.f, handling:x.h };
  return null;
};

/* ── small helpers ── */
const words = s => (s || '').trim().split(/\s+/).filter(Boolean).length;
const tidy  = s => (s || '').replace(/\s+/g, ' ').trim();
const abs   = (url, base) => { try { return new URL(url, base).href; } catch { return null; } };

/*
 * A computed style hands back a URL the browser has already resolved, against the
 * document's own address rather than against the address being imported. Those
 * differ whenever a page is rendered from somewhere other than where it lives: a
 * preview host, a staging domain, a folder on disk. Where the document resolved a
 * path against itself, resolve it again against the real site; a URL that already
 * points elsewhere, a CDN most often, is left exactly as it is.
 */
function rebase(href, doc, base){
  if (!href) return null;
  try {
    const home = new URL(doc.baseURI), here = new URL(base), u = new URL(href, doc.baseURI);
    return u.origin === home.origin && u.origin !== here.origin
      ? new URL(u.pathname + u.search, here).href
      : u.href;
  } catch { return abs(href, base); }
}

function isHidden(el, win){
  const cs = win.getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const r = el.getBoundingClientRect();
  return r.width < 1 || r.height < 1;
}
const mark = el => (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
function isChrome(el){
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (SKIP_ROLES.has(el.getAttribute('role'))) return true;
  return CHROME.test(mark(el));
}
function inChrome(el, root){
  for (let n = el; n && n !== root; n = n.parentElement) if (isChrome(n)) return true;
  return false;
}

/* The largest usable source in a srcset, so a clone takes the print-quality one. */
function fromSrcset(srcset, base){
  if (!srcset) return null;
  const best = srcset.split(',').map(part => {
    const [u, d] = part.trim().split(/\s+/);
    const n = d && d.endsWith('w') ? parseInt(d) : d && d.endsWith('x') ? parseFloat(d) * 1000 : 0;
    return { u, n: n || 0 };
  }).filter(x => x.u).sort((a, b) => b.n - a.n)[0];
  return best ? abs(best.u, base) : null;
}
/* A CSS background is how most builders place a hero. */
function fromBackground(el, win, doc, base){
  const bg = win.getComputedStyle(el).backgroundImage;
  if (!bg || bg === 'none') return null;
  const m = /url\((['"]?)(.*?)\1\)/.exec(bg);
  return m && m[2] && !m[2].startsWith('data:') ? rebase(m[2], doc, base) : null;
}

/*
 * The whole body, not <main>. Templates put the hero above <main> as often as
 * inside it, and scoping to <main> loses the headline and the cover photo, which
 * are the two things a client most wants to change. The chrome rules take out the
 * navigation, the sidebar and the footer wherever they sit.
 */
const contentRoot = doc => doc.body;

/* ── colours, so the design rules read as a person would write them ── */
function hex(css){
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(css || '');
  if (!m) return css && css.startsWith('#') ? css.toLowerCase() : '';
  if (m[4] !== undefined && +m[4] === 0) return '';                 /* transparent is not a colour */
  return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
}
const commonest = list => {
  const n = new Map();
  list.filter(Boolean).forEach(v => n.set(v, (n.get(v) || 0) + 1));
  return [...n].sort((a, b) => b[1] - a[1]).map(x => x[0]);
};

/* ── page level facts ── */
function pageMeta(doc, url){
  const get = sel => { const e = doc.querySelector(sel); return e ? tidy(e.getAttribute('content') || e.textContent) : ''; };
  const schema = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    /* carried across as it stands, never rewritten and never invented: a rating or
       a review count that SiteCraft made up would be a lie about a real business */
    try { schema.push(JSON.parse(s.textContent)); } catch { schema.push({ unparsed:true }); }
  });
  return {
    url,
    title:       tidy(doc.title),
    description: get('meta[name="description"]') || get('meta[property="og:description"]'),
    canonical:   (doc.querySelector('link[rel="canonical"]') || {}).href || url,
    ogTitle:     get('meta[property="og:title"]'),
    ogImage:     abs(get('meta[property="og:image"]'), url),
    robots:      get('meta[name="robots"]'),
    lang:        doc.documentElement.getAttribute('lang') || '',
    schema,
  };
}

function pageTags(doc){
  const out = new Set();
  doc.querySelectorAll('[rel~="tag"], .tag, .tags a, .post-categories a, .cat-links a, [class*="category"] a')
     .forEach(a => { const t = tidy(a.textContent); if (t && t.length < 40) out.add(t); });
  return [...out].slice(0, 20);
}

/* Every link on the page, sorted by what it is, so link checking has something to
   work from and so a client's phone number and email survive the move. */
function pageLinks(doc, url){
  const here = new URL(url), seen = new Map();
  doc.querySelectorAll('a[href]').forEach(a => {
    const raw = a.getAttribute('href') || '';
    const label = tidy(a.textContent).slice(0, 80);
    if (/^mailto:/i.test(raw)) return void seen.set(raw, { href:raw, label, kind:'email' });
    if (/^tel:/i.test(raw))    return void seen.set(raw, { href:raw, label, kind:'phone' });
    const href = abs(raw, url);
    if (!href || /^(javascript|#)/i.test(raw)) return;
    let u; try { u = new URL(href); } catch { return; }
    const asset = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp[34])$/i.test(u.pathname);
    const internal = u.origin === here.origin;
    u.hash = '';
    if (internal && u.href === here.href) return;
    if (!seen.has(u.href)) seen.set(u.href, {
      href: u.href, label,
      kind: asset ? 'file' : internal ? 'internal' : 'external',
    });
  });
  return [...seen.values()];
}

/* Whether a picture actually arrived. A source that renders nothing is the single
   commonest migration fault, and finding it here saves an employee a page hunt. */
function imageFacts(img, win, doc, base){
  const sets = [img.getAttribute('srcset')];
  const pic = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null;
  if (pic) [...pic.querySelectorAll('source')].forEach(s => sets.unshift(s.getAttribute('srcset')));
  const src = sets.map(x => fromSrcset(x, base)).find(Boolean) || abs(img.getAttribute('src'), base);
  if (!src || src.startsWith('data:')) return null;
  const attr = n => { const v = parseInt(img.getAttribute(n), 10); return v > 0 ? v : 0; };
  const box = img.getBoundingClientRect();
  /* An image the browser did not fetch reports a natural size of zero and lays out
     at the height of its alt text. The author's own width and height attributes are
     the better answer whenever the bitmap is not there to ask. */
  return {
    src,
    alt: tidy(img.getAttribute('alt')) || '',
    hasAlt: img.hasAttribute('alt'),
    w: img.naturalWidth || attr('width')  || Math.round(box.width),
    h: img.naturalHeight || attr('height') || Math.round(box.height),
    loaded: !!(img.complete && img.naturalWidth > 0),
    background: false,
  };
}

/* ── third-party features ── */
function thirdParty(doc, win, url){
  const out = [];
  const add = (o) => { if (!out.some(x => x.source === o.source && x.where === o.where)) out.push(o); };
  const where = el => {
    const h = el.closest('section, article, div[class]');
    return (h && tidy(mark(h)).slice(0, 60)) || el.tagName.toLowerCase();
  };

  doc.querySelectorAll('iframe[src], embed[src], object[data]').forEach(el => {
    const src = abs(el.getAttribute('src') || el.getAttribute('data'), url);
    if (!src) return;
    const v = vendorOf(src);
    add({ kind:'embed', vendor: v ? v.vendor : 'Unknown', feature: v ? v.feature : 'Embedded Application',
          handling: v ? v.handling : 'review', source: src, where: where(el),
          title: tidy(el.getAttribute('title')) || '' });
  });

  doc.querySelectorAll('script[src]').forEach(el => {
    const src = abs(el.getAttribute('src'), url);
    if (!src) return;
    let u; try { u = new URL(src); } catch { return; }
    if (u.origin === new URL(url).origin) return;      /* the site's own code is not a third party */
    const v = vendorOf(src);
    add({ kind:'script', vendor: v ? v.vendor : u.hostname, feature: v ? v.feature : 'Unknown Script',
          handling: v ? v.handling : 'review', source: src, where:'head or body', title:'' });
  });

  doc.querySelectorAll('form').forEach(el => {
    if (inChrome(el, doc.body)) return;
    const action = el.getAttribute('action') || '';
    const target = action ? abs(action, url) : url;
    const v = target ? vendorOf(target) : null;
    let offsite = false;
    try { offsite = !!target && new URL(target).origin !== new URL(url).origin; } catch {}
    const fields = el.querySelectorAll('input,select,textarea').length;
    add({ kind:'form', vendor: v ? v.vendor : (offsite ? 'Off-site' : 'The site itself'),
          feature: v ? v.feature : 'Form', handling:'review',
          source: target || '(no action)', where: where(el),
          title: tidy(el.getAttribute('name') || el.getAttribute('id') || '') , fields });
  });

  return out;
}

/* ── the site's design rules, read off the page rather than guessed ── */
function designRules(doc, win, root){
  const pick = sel => root.querySelector(sel) || doc.querySelector(sel);
  const styleOf = el => {
    if (!el) return null;
    const cs = win.getComputedStyle(el);
    return {
      family: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
      size:   Math.round(parseFloat(cs.fontSize) || 0),
      weight: cs.fontWeight,
      line:   cs.lineHeight,
      color:  hex(cs.color),
      transform: cs.textTransform === 'none' ? '' : cs.textTransform,
      tracking:  cs.letterSpacing === 'normal' ? '' : cs.letterSpacing,
    };
  };
  const buttons = [...doc.querySelectorAll('a,button')].filter(el => {
    if (inChrome(el, doc.body) || isHidden(el, win)) return false;
    const cs = win.getComputedStyle(el);
    return /btn|button|cta/i.test(mark(el)) || (hex(cs.backgroundColor) && parseFloat(cs.paddingLeft) >= 10);
  });
  const btn = buttons[0];
  const btnCs = btn ? win.getComputedStyle(btn) : null;
  const bgs = [...doc.querySelectorAll('section, main > div, .section')]
    .filter(el => !isHidden(el, win)).slice(0, 40)
    .map(el => hex(win.getComputedStyle(el).backgroundColor));
  const widths = [...doc.querySelectorAll('.wrap, .container, .inner, main > div > div, section > div')]
    .filter(el => !isHidden(el, win)).slice(0, 30)
    .map(el => Math.round(el.getBoundingClientRect().width))
    .filter(w => w > 320);

  /* The first <p> on a page is very often the eyebrow above the headline, which is
     small, coloured and upper-case — the least representative text on the site. The
     body style comes from the paragraph carrying the most words instead. */
  const paras = [...root.querySelectorAll('p')]
    .filter(el => !inChrome(el, doc.body) && !isHidden(el, win))
    .map(el => ({ el, n: words(el.textContent) }))
    .sort((a, b) => b.n - a.n);
  const body = styleOf((paras[0] && paras[0].n >= 8 ? paras[0].el : null) || pick('p') || doc.body);
  const h1 = styleOf(pick('h1')), h2 = styleOf(pick('h2')), h3 = styleOf(pick('h3'));
  return {
    fonts: commonest([h1 && h1.family, body && body.family]).slice(0, 2),
    body, h1, h2, h3,
    button: btn ? {
      background: hex(btnCs.backgroundColor), color: hex(btnCs.color),
      radius: btnCs.borderRadius, padding: btnCs.padding,
      weight: btnCs.fontWeight, transform: btnCs.textTransform === 'none' ? '' : btnCs.textTransform,
    } : null,
    colors: {
      page:   hex(win.getComputedStyle(doc.body).backgroundColor) || '#ffffff',
      text:   body ? body.color : '',
      accent: btn ? hex(btnCs.backgroundColor) : (h1 ? h1.color : ''),
      sections: commonest(bgs).filter(Boolean).slice(0, 4),
    },
    maxWidth: commonest(widths)[0] || null,
    link: styleOf(pick('main a[href], article a[href], p a[href]')),
  };
}

/* ── sections ── */
/*
 * A section is the band of a page a reader would point at: the hero, the row of
 * three services, the block of text beside a photo. Templates agree on almost
 * nothing about how they are marked up, so this looks at shape rather than class
 * names — and it does not assume a band is one element. Hand-written pages and
 * half the page builders in use put a whole page inside one <section>, with the
 * bands separated only by their headings. So a band here is a RUN of siblings,
 * which is the one description that covers both.
 */
function sectionish(el, win, rootW){
  const r = el.getBoundingClientRect();
  if (r.height < MIN_SECTION_PX || r.width < rootW * 0.45) return false;
  const heads = el.querySelectorAll('h1,h2,h3,h4').length;
  const imgs  = el.querySelectorAll('img,picture').length;
  const paras = [...el.querySelectorAll('p')].filter(p => words(p.textContent) >= 4).length;
  const lists = el.querySelectorAll('ul,ol').length;
  /* an empty band carrying a CSS background is a cover photo, not a spacer, and it
     is how most builders place the picture at the top of a page */
  const cover = win.getComputedStyle(el).backgroundImage !== 'none' && r.height >= MIN_IMAGE_PX;
  if (!(heads + imgs + paras + lists) && !cover) return false;
  /* a lone child that fills the parent IS the section: keep descending */
  const kids = [...el.children].filter(c => !isChrome(c) && !isHidden(c, win));
  if (kids.length === 1){
    const k = kids[0].getBoundingClientRect();
    if (k.height >= r.height * 0.88 && k.width >= r.width * 0.88) return false;
  }
  return true;
}

/* Step past wrappers that exist only to centre something. */
function unwrap(el, win){
  let host = el;
  for (let i = 0; i < 4; i++){
    const kids = [...host.children].filter(c => !isChrome(c) && !isHidden(c, win));
    if (kids.length !== 1 || /^H[1-6]$/.test(kids[0].tagName)) break;
    if (!kids[0].children.length) break;
    host = kids[0];
  }
  return host;
}

/*
 * Split one wide block into the bands its headings imply. The first heading does
 * not start a new band, because whatever sits above it — a kicker, an eyebrow, a
 * line of small type — belongs with it rather than with nothing.
 */
function splitByHeadings(el, win){
  const host = unwrap(el, win);
  const kids = [...host.children].filter(c => !isChrome(c) && !isHidden(c, win));
  const levels = kids.filter(c => /^H[1-6]$/.test(c.tagName)).map(c => +c.tagName[1]);
  if (levels.length < 2) return [[el]];
  /* The band boundary is not the shallowest heading on the page: a page that opens
     with one H1 and then runs on H2s would never split at all. It is the shallowest
     heading among everything AFTER the first, which is the level the page actually
     uses to change subject. */
  const top = Math.min.apply(null, levels.slice(1));
  const groups = [];
  let cur = [], curHasHeading = false;
  for (const k of kids){
    const boundary = /^H[1-6]$/.test(k.tagName) && +k.tagName[1] <= top;
    if (boundary && curHasHeading){ groups.push(cur); cur = []; curHasHeading = false; }
    if (boundary) curHasHeading = true;
    cur.push(k);
  }
  if (cur.length) groups.push(cur);
  return groups.length > 1 ? groups : [[el]];
}

function findSections(root, win){
  const wide = [];
  const rootW = root.getBoundingClientRect().width || win.innerWidth || 1280;
  const walk = el => {
    for (const ch of [...el.children]){
      if (wide.length >= MAX_SECTIONS) return;
      if (isChrome(ch) || isHidden(ch, win)) continue;
      /* A wrapper whose own children are bands is not itself a band. <main> holding
         three <section>s qualifies on every test that matters, and taking it would
         swallow all three into one; the children are the answer. */
      const kids = [...ch.children].filter(k => !isChrome(k) && !isHidden(k, win));
      const bandKids = kids.filter(k => sectionish(k, win, rootW)).length;
      if (sectionish(ch, win, rootW) && bandKids < 2) wide.push(ch);
      else walk(ch);
    }
  };
  walk(root);
  const out = [];
  for (const el of wide){
    for (const group of splitByHeadings(el, win)){
      if (out.length >= MAX_SECTIONS) break;
      out.push(group);
    }
  }
  return out;
}

/* ── reading a band ── */
/* A band is a list of elements, so every query runs over all of them at once. */
function qAll(nodes, sel){
  const out = [];
  for (const n of nodes){
    if (n.matches && n.matches(sel)) out.push(n);
    for (const m of n.querySelectorAll(sel)) if (!out.includes(m)) out.push(m);
  }
  return out;
}
function unionRect(nodes){
  let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
  for (const n of nodes){
    const r = n.getBoundingClientRect();
    top = Math.min(top, r.top); left = Math.min(left, r.left);
    right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
  }
  return { top, left, width: right - left, height: bottom - top };
}

/* A repeated row of the same shape is a card grid: services, properties, people. */
function repeatedItems(nodes, win, doc, base){
  const sig = el => el.tagName + '|' + (typeof el.className === 'string'
    ? el.className.split(/\s+/).filter(Boolean).sort().join('.') : '');
  let best = null;
  const consider = parent => {
    const kids = [...parent.children].filter(c => !isChrome(c) && !isHidden(c, win));
    if (kids.length < 2) return;
    const groups = new Map();
    kids.forEach(k => { const t = sig(k); if (!groups.has(t)) groups.set(t, []); groups.get(t).push(k); });
    for (const group of groups.values()){
      if (group.length < 2) continue;
      if (group.some(g => !g.querySelector('h1,h2,h3,h4,h5,a,img,p'))) continue;
      if (!best || group.length > best.length) best = group;
    }
  };
  nodes.forEach(consider);
  qAll(nodes, 'ul, ol, div, section').forEach(p => { if (best && best.length >= 3) return; consider(p); });
  if (!best || best.length < 2) return null;

  const items = best.slice(0, MAX_ITEMS).map(el => {
    const head = el.querySelector('h1,h2,h3,h4,h5,h6');
    const link = el.querySelector('a[href]');
    const img  = el.querySelector('img');
    const time = el.querySelector('time');
    const facts = img ? imageFacts(img, win, doc, base) : null;
    const bg = facts ? null : fromBackground(el, win, doc, base);
    const paras = [...el.querySelectorAll('p')].map(p => tidy(p.textContent)).filter(Boolean);
    const title = tidy(head && head.textContent) || (link ? tidy(link.textContent) : '');
    return {
      title,
      body: paras.filter(t => t !== title).join(' ').slice(0, 500),
      image: facts || (bg ? { src:bg, alt:'', hasAlt:false, w:0, h:0, loaded:true, background:true } : null),
      href: link ? abs(link.getAttribute('href'), base) : null,
      meta: tidy(time && (time.getAttribute('datetime') || time.textContent)) || '',
      dated: !!time,
    };
  }).filter(x => x.title || x.image || x.href);
  return items.length >= 2 ? items : null;
}

/* Whether something reads as a button rather than as a sentence with a link in it. */
function isButton(el, win){
  if (el.tagName === 'BUTTON') return true;
  if (/btn|button|cta/i.test(mark(el))) return true;
  const cs = win.getComputedStyle(el);
  return !!hex(cs.backgroundColor) && parseFloat(cs.paddingLeft) >= 10 && words(el.textContent) <= 6;
}

function readSection(nodes, win, doc, base, i, fold){
  const r = unionRect(nodes);
  const first = nodes[0];
  const headings = qAll(nodes, 'h1,h2,h3,h4,h5,h6')
    .filter(h => !isChrome(h) && !isHidden(h, win))
    .map(h => ({ level: +h.tagName[1], text: tidy(h.textContent) })).filter(h => h.text);
  const paras = qAll(nodes, 'p')
    .filter(p => !isChrome(p) && !isHidden(p, win))
    .map(p => tidy(p.textContent)).filter(Boolean);
  const lists = qAll(nodes, 'ul,ol')
    .filter(l => !isChrome(l) && !isHidden(l, win))
    .map(l => [...l.querySelectorAll('li')].map(li => tidy(li.textContent)).filter(Boolean))
    .filter(items => items.length);
  const tables = qAll(nodes, 'table').map(t =>
    [...t.querySelectorAll('tr')].map(tr => [...tr.children].map(td => tidy(td.textContent))));

  const images = [];
  qAll(nodes, 'img').forEach(img => {
    if (isChrome(img) || inChrome(img, doc.body)) return;
    const f = imageFacts(img, win, doc, base);
    if (f && !images.some(x => x.src === f.src)) images.push(f);
  });
  /* a hero is usually a CSS background rather than an <img> */
  for (const n of nodes){
    const bg = fromBackground(n, win, doc, base);
    if (bg && !images.some(x => x.src === bg)){
      const nr = n.getBoundingClientRect();
      images.unshift({ src:bg, alt:'', hasAlt:false, w:Math.round(nr.width), h:Math.round(nr.height),
                       loaded:true, background:true });
    }
  }

  const links = [];
  qAll(nodes, 'a[href]').forEach(a => {
    if (inChrome(a, doc.body) || isHidden(a, win)) return;
    const raw = a.getAttribute('href') || '';
    if (/^(javascript|#)/i.test(raw)) return;
    const href = /^(mailto|tel):/i.test(raw) ? raw : abs(raw, base);
    const label = tidy(a.textContent);
    if (!href || !label) return;
    if (!links.some(l => l.href === href)) links.push({ href, label, button: isButton(a, win) });
  });

  /* A kicker is short text sitting directly above a heading, which is how nearly
     every template writes one. It is recognised by position, because the class is
     different on every theme and often absent. */
  let eyebrow = '';
  const firstHead = qAll(nodes, 'h1,h2,h3')[0];
  if (firstHead){
    const before = firstHead.previousElementSibling;
    if (before && nodes.some(n => n === before || n.contains(before)) &&
        !isChrome(before) && !isHidden(before, win)){
      const t = tidy(before.textContent);
      if (t && words(t) <= 8 && !before.querySelector('img,a')) eyebrow = t;
    }
  }

  /* Third-party features are recorded where they sit, not only at page level: a
     booking widget under a "Book online" heading is that band, and losing its place
     would leave an empty heading on the page and the widget in a list somewhere. */
  const embeds = [];
  qAll(nodes, 'iframe[src], embed[src], object[data], form').forEach(el => {
    if (inChrome(el, doc.body)) return;
    const raw = el.tagName === 'FORM'
      ? (el.getAttribute('action') || '')
      : (el.getAttribute('src') || el.getAttribute('data') || '');
    const src = raw ? abs(raw, base) : '';
    const v = src ? vendorOf(src) : null;
    let offsite = false;
    try { offsite = !!src && new URL(src).origin !== new URL(base).origin; } catch {}
    embeds.push({
      kind: el.tagName === 'FORM' ? 'form' : 'embed',
      vendor: v ? v.vendor : (el.tagName === 'FORM' ? (offsite ? hostOf(src) : 'The site itself') : 'Unknown'),
      feature: v ? v.feature : (el.tagName === 'FORM' ? 'Form' : 'Embedded Application'),
      handling: v ? v.handling : 'review',
      source: src,
      title: tidy(el.getAttribute('title') || el.getAttribute('name') || el.getAttribute('id') || ''),
      fields: el.tagName === 'FORM' ? el.querySelectorAll('input,select,textarea').length : 0,
    });
  });
  /* a widget a script fills in later leaves its own marker in the markup */
  qAll(nodes, '[data-url], [class*="widget"]').forEach(el => {
    const src = abs(el.getAttribute('data-url') || '', base);
    const v = src ? vendorOf(src) : null;
    if (!v || embeds.some(e => e.source === src)) return;
    embeds.push({ kind:'embed', vendor:v.vendor, feature:v.feature, handling:v.handling,
                  source:src, title:'', fields:0 });
  });

  const cs = win.getComputedStyle(nodes.length === 1 ? first : (first.parentElement || first));
  return {
    i, tag: first.tagName, cls: tidy(mark(first)).slice(0, 80),
    nodes: nodes.length,
    eyebrow,
    top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height),
    hero: r.top < fold,
    columns: cs.display === 'grid'
      ? (cs.gridTemplateColumns || '').split(' ').filter(Boolean).length
      : (cs.display === 'flex' && cs.flexDirection === 'row' ? 2 : 1),
    headings, paras: paras.filter(p => p !== eyebrow), lists, tables, images, links, embeds,
    items: repeatedItems(nodes, win, doc, base),
    words: paras.filter(p => p !== eyebrow).reduce((n, p) => n + words(p), 0),
  };
}

/* How much a page matters, from where it sits rather than from what it says. */
function pageValue(url, isEntry){
  if (isEntry) return 3;
  let path; try { path = new URL(url).pathname.replace(/\/+$/, ''); } catch { path = String(url); }
  if (!path || /^\/index\.(html?|php)$/.test(path)) return 3;
  const depth = path.split('/').filter(Boolean).length;
  if (/(service|about|contact|team|practice|listing|propert|program|donate|treatment)/i.test(path)) return 2;
  return depth > 2 ? 1 : 2;
}

const slugOf = url => { try { return new URL(url).pathname || '/'; } catch { return '/'; } };

/* Blog shapes, which decide whether a page is an article or a list of them. */
const BLOGGY = /\/(blog|news|posts?|articles?|stories|insights|updates)(\/|$)/i;
function blogRole(doc, url, sections){
  const path = slugOf(url);
  const dated = /\/(19|20)\d\d\/\d{1,2}\//.test(path);
  const article = doc.querySelector('article');
  const hasDate = !!doc.querySelector('time, .entry-date, .published, .post-date');
  const listing = sections.some(s => s.items && s.items.length >= 2 && s.items.some(i => i.dated || BLOGGY.test(i.href || '')));
  if ((BLOGGY.test(path) || dated) && article && hasDate && !listing) return 'post';
  if (dated && hasDate) return 'post';
  if (listing) return 'listing';
  if (BLOGGY.test(path)) return 'listing';
  return null;
}

/* ── the one entry point ── */
function extractPage(doc, win, url, opts = {}){
  const key = opts.key || 'page';
  const root = contentRoot(doc);
  const fold = win.innerHeight || 800;
  const sections = findSections(root, win)
    .map((s, i) => readSection(s, win, doc, url, i, fold))
    .filter(s => s.headings.length || s.paras.length || s.images.length || s.lists.length || s.items);

  const assets = [];
  sections.forEach(s => s.images.forEach(im => {
    if (!assets.some(a => a.src === im.src)) assets.push(im);
  }));

  return {
    key,
    name: opts.name || tidy(doc.title).split(/[|–—·-]/)[0].trim() || 'Page',
    slug: slugOf(url),
    value: opts.value || pageValue(url, !!opts.isEntry),
    url,
    isEntry: !!opts.isEntry,
    meta:  pageMeta(doc, url),
    tags:  pageTags(doc),
    links: pageLinks(doc, url),
    thirdParty: thirdParty(doc, win, url),
    design: designRules(doc, win, root),
    sections,
    assets,
    blog: blogRole(doc, url, sections),
    headingOrder: [...doc.querySelectorAll('h1,h2,h3')]
      .filter(h => !inChrome(h, doc.body) && !isHidden(h, win))
      .map(h => +h.tagName[1]),
  };
}

const api = { extractPage, findSections, designRules, thirdParty, pageLinks, pageMeta, pageValue, VENDORS };
if (typeof module !== 'undefined') module.exports = api;
if (typeof window !== 'undefined') window.SitecraftExtract = api;
})();
