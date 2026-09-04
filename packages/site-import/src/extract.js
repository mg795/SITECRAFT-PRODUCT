(function(){
'use strict';
/*
 * Turn a rendered page into a Sitecraft page model.
 *
 * This runs INSIDE a page, against a real Document. In production that page is a
 * headless browser pointed at the client's site; in tests it is a fixture loaded
 * from disk. Same code either way, which is the point: most small-business sites
 * are built on Squarespace, Wix or a WordPress page builder and put their content
 * in with JavaScript, so parsing the HTML that comes off the wire would miss it.
 *
 * The output is what app/sitecraft.html renders. It carries a little more than the
 * editor currently uses (links, tags, meta) so an import does not have to be run
 * twice when the editor learns to use them.
 */

/* Chrome that belongs to the site, not to the page's content. */
const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','CANVAS','IFRAME',
                           'NAV','HEADER','FOOTER','ASIDE','FORM','BUTTON','SELECT','TEXTAREA']);
const SKIP_ROLES = new Set(['navigation','banner','contentinfo','complementary','search','menu','menubar','dialog']);
/* Words that mark a block as furniture wherever it sits in the tree. */
const CHROME = /(^|[\s_-])(nav|navbar|menu|header|footer|sidebar|breadcrumb|cookie|consent|popup|modal|newsletter|subscribe|social|share|skip-link|screen-reader|sr-only|visually-hidden)([\s_-]|$)/i;
/* "banner" is not on that list on purpose: a cookie banner is caught by "cookie",
 * while page-banner, hero-banner and banner-image are what WordPress themes call
 * the cover photo, which is the first thing a client wants to change. */

const MIN_PARAGRAPH_WORDS = 8;      /* shorter than this is a caption or a label */
const MIN_IMAGE_PX        = 120;    /* smaller than this is an icon or a spacer */
const MAX_COMPONENTS      = 60;     /* a page a person can actually work through */

const words = s => (s || '').trim().split(/\s+/).filter(Boolean).length;
const tidy  = s => (s || '').replace(/\s+/g, ' ').trim();

function isHidden(el, win){
  const cs = win.getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const r = el.getBoundingClientRect();
  return r.width < 1 || r.height < 1;
}

function isChrome(el){
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (SKIP_ROLES.has(el.getAttribute('role'))) return true;
  const mark = (el.className && typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
  return CHROME.test(mark);
}

/* Walk up: a heading inside a footer is still footer. */
function inChrome(el, root){
  for (let n = el; n && n !== root; n = n.parentElement) if (isChrome(n)) return true;
  return false;
}

const abs = (url, base) => { try { return new URL(url, base).href; } catch { return null; } };

/*
 * A computed style hands back a URL the browser has already resolved, against the
 * document's own address rather than against the address we are importing. Those
 * differ whenever the page is rendered from somewhere other than where it lives:
 * a saved snapshot, a staging host, a fixture on disk. Where the document resolved
 * a path against itself, resolve it again against the real site instead; a URL that
 * already points somewhere else, a CDN most often, is left exactly as it is.
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
function fromBackground(el, win, base){
  const bg = win.getComputedStyle(el).backgroundImage;
  if (!bg || bg === 'none') return null;
  const m = /url\((['"]?)(.*?)\1\)/.exec(bg);
  return m && m[2] && !m[2].startsWith('data:') ? rebase(m[2], el.ownerDocument, base) : null;
}

/*
 * The whole body, not <main>. Templates put the hero above <main> as often as
 * inside it, and scoping to <main> loses the headline and the cover photo, which
 * are the two things a client most wants to change. The chrome rules below take
 * out the navigation, the sidebar and the footer wherever they sit.
 */
const contentRoot = doc => doc.body;

function pageMeta(doc, url){
  const get = sel => { const e = doc.querySelector(sel); return e ? tidy(e.getAttribute('content') || e.textContent) : ''; };
  return {
    url,
    title:       tidy(doc.title),
    description: get('meta[name="description"]') || get('meta[property="og:description"]'),
    canonical:   (doc.querySelector('link[rel="canonical"]') || {}).href || url,
    ogTitle:     get('meta[property="og:title"]'),
    ogImage:     abs(get('meta[property="og:image"]'), url),
    lang:        doc.documentElement.getAttribute('lang') || '',
  };
}

/* Blog categories and tags, wherever the theme happens to keep them. */
function pageTags(doc){
  const out = new Set();
  doc.querySelectorAll('[rel~="tag"], .tag, .tags a, .post-categories a, .cat-links a, [class*="category"] a')
     .forEach(a => { const t = tidy(a.textContent); if (t && t.length < 40) out.add(t); });
  return [...out].slice(0, 20);
}

/* Internal links, so a crawl knows what else there is to bring across. */
function pageLinks(doc, url){
  const here = new URL(url), seen = new Map();
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = abs(a.getAttribute('href'), url);
    if (!href) return;
    const u = new URL(href);
    if (u.origin !== here.origin) return;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?|mp[34])$/i.test(u.pathname)) return;
    u.hash = '';
    if (u.href === here.href) return;
    if (!seen.has(u.href)) seen.set(u.href, tidy(a.textContent).slice(0, 60));
  });
  return [...seen].map(([href, label]) => ({ href, label }));
}

/*
 * The components themselves, in the order a reader meets them.
 *
 * An eyebrow is short text sitting directly above a heading, which is how nearly
 * every template writes a kicker; it is recognised by position rather than class,
 * since the class is different on every theme.
 */
function extractComponents(doc, win, url, prefix){
  const root = contentRoot(doc);
  const comps = [];
  const seenText = new Set();
  const seenSrc  = new Set();
  let n = 0;
  const fold = win.innerHeight || 800;

  const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_ELEMENT);
  const queue = [];
  for (let el = walker.currentNode; el; el = walker.nextNode()) queue.push(el);

  for (const el of queue){
    if (comps.length >= MAX_COMPONENTS) break;
    if (el === root) continue;
    if (inChrome(el, root)) continue;
    if (isHidden(el, win)) continue;

    const tag = el.tagName;
    const box = el.getBoundingClientRect();
    const hero = box.top < fold ? 1 : 0;
    const id = prefix + '-' + (++n);

    /* pictures, however the theme placed them */
    if (tag === 'IMG' || tag === 'PICTURE'){
      const img = tag === 'PICTURE' ? el.querySelector('img') : el;
      if (!img) continue;
      if (tag === 'IMG' && el.parentElement && el.parentElement.tagName === 'PICTURE') continue;
      const sets = tag === 'PICTURE'
        ? [...el.querySelectorAll('source')].map(s => s.getAttribute('srcset')).concat(img.getAttribute('srcset'))
        : [img.getAttribute('srcset')];
      const src = sets.map(x => fromSrcset(x, url)).find(Boolean) || abs(img.getAttribute('src'), url);
      if (!src || src.startsWith('data:') || seenSrc.has(src)) continue;
      /* An image the browser has not fetched reports a natural size of zero and lays
       * out at the height of its alt text, which would read as an icon. The width and
       * height attributes are the author's own statement of the intrinsic size, so
       * they are the better answer whenever the bitmap is not there to ask. */
      const attr = n => { const v = parseInt(img.getAttribute(n), 10); return v > 0 ? v : 0; };
      const w = img.naturalWidth || attr('width')  || box.width;
      const h = img.naturalHeight || attr('height') || box.height;
      if (w < MIN_IMAGE_PX || h < MIN_IMAGE_PX) continue;
      seenSrc.add(src);
      comps.push({ id, lbl:'Feature Photo', t:'img', hero, src,
                   alt: tidy(img.getAttribute('alt')) || '',
                   dim: { w: Math.round(w), h: Math.round(h) },
                   text: tidy(img.getAttribute('alt')) || 'Photo' });
      continue;
    }

    /* a background image standing in for a photo */
    if (!el.children.length || /hero|banner|masthead|jumbotron|cover/i.test(el.className || '')){
      const bg = fromBackground(el, win, url);
      if (bg && !seenSrc.has(bg) && box.width >= MIN_IMAGE_PX && box.height >= MIN_IMAGE_PX){
        seenSrc.add(bg);
        comps.push({ id, lbl:'Feature Photo', t:'img', hero, src:bg, alt:'',
                     dim:{ w: Math.round(box.width), h: Math.round(box.height) }, text:'Photo' });
        continue;
      }
    }

    /* text: only from the element that actually holds it */
    const own = tidy([...el.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join(' '));
    if (!own) continue;
    const key = own.toLowerCase();
    if (seenText.has(key)) continue;

    if (/^H[1-6]$/.test(tag)){
      seenText.add(key);
      comps.push({ id, lbl:'Heading', t: tag === 'H1' ? 'h1' : 'h2', hero, text: own });
      continue;
    }
    if (tag === 'LI'){
      seenText.add(key);
      comps.push({ id, lbl:'List Item', t:'band', hero, text: own });
      continue;
    }
    if (words(own) >= MIN_PARAGRAPH_WORDS){
      seenText.add(key);
      comps.push({ id, lbl:'Body Copy', t:'p', hero, text: own });
      continue;
    }
    /* short line directly above a heading: a kicker */
    const next = el.nextElementSibling;
    if (next && /^H[1-3]$/.test(next.tagName) && words(own) <= 8){
      seenText.add(key);
      comps.push({ id, lbl:'Eyebrow', t:'kick', hero, text: own });
    }
  }
  return comps;
}

/* How much a page matters, from where it sits rather than from what it says. */
function pageValue(url, isEntry){
  if (isEntry) return 3;
  const path = new URL(url).pathname.replace(/\/+$/, '');
  if (!path || path === '/index.html') return 3;
  const depth = path.split('/').filter(Boolean).length;
  if (/(service|about|contact|team|practice|listing|property|program|donate)/i.test(path)) return 2;
  return depth > 2 ? 1 : 2;
}

/* The one entry point: a rendered document in, one page of a Sitecraft site out. */
function extractPage(doc, win, url, opts = {}){
  const key = opts.key || 'page';
  return {
    key,
    name: opts.name || tidy(doc.title).split(/[|–—-]/)[0].trim() || 'Page',
    value: opts.value || pageValue(url, !!opts.isEntry),
    url,
    meta: pageMeta(doc, url),
    tags: pageTags(doc),
    links: pageLinks(doc, url),
    comps: extractComponents(doc, win, url, opts.prefix || key),
  };
}

if (typeof module !== 'undefined') module.exports = { extractPage, extractComponents, pageMeta, pageTags, pageLinks, pageValue };
if (typeof window !== 'undefined') window.SitecraftExtract = { extractPage };
})();
