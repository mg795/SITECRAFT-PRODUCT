/*
 * The extractor runs inside a page, so the tests do too: each fixture is loaded in
 * a real browser, the extractor is injected, and what it reports is checked. That
 * is the path a production import takes, with a fixture in place of a client's site.
 *
 *   node packages/site-import/test/extract.test.js
 */
const path = require('path');
const fs = require('fs');
const { launch } = require('./browser');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'extract.js'), 'utf8');
const FIX = path.join(__dirname, 'fixtures');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};

async function model(page, file, url, opts){
  await page.goto('file://' + path.join(FIX, file));
  await page.waitForTimeout(120);
  await page.addScriptTag({ content: SRC });
  return page.evaluate(([u, o]) => window.SitecraftExtract.extractPage(document, window, u, o), [url, opts || {}]);
}
const allText = m => m.sections.map(s =>
  [s.eyebrow, ...s.headings.map(h => h.text), ...s.paras, ...s.lists.flat()].join(' ')).join(' | ');
const allImages = m => m.sections.flatMap(s => s.images).map(i => i.src);

(async () => {
  const b = await launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => { fail++; console.log('  FAIL page error: ' + e.message); });

  /* ── a realtor's home page ── */
  console.log('\nrealtor.html');
  const r = await model(page, 'realtor.html', 'https://coastline-realty.test/', { key: 'home', isEntry: true });

  ok('page is named from the title', r.name === 'Coastline Realty', r.name);
  ok('the slug is taken from the address it is imported as', r.slug === '/', r.slug);
  ok('entry page is graded critical', r.value === 3, r.value);
  ok('description is carried across', r.meta.description.startsWith('Buying or selling'), r.meta.description);
  ok('canonical is carried across', r.meta.canonical === 'https://coastline-realty.test/', r.meta.canonical);

  const text = allText(r);
  ok('the h1 comes through',
     r.sections.some(s => s.headings.some(h => h.level === 1 && h.text === 'Find the house, not the listing')));
  ok('the kicker above it is an eyebrow',
     r.sections.some(s => s.eyebrow && s.eyebrow.startsWith('Jacksonville')),
     r.sections.map(s => s.eyebrow).filter(Boolean));
  ok('an eyebrow is not repeated as body copy', !r.sections.some(s => s.paras.some(p => p === s.eyebrow)));
  ok('the lede is body copy', /four hundred homes/.test(text));
  ok('the list comes through', r.sections.some(s => s.lists.some(l => l.length === 4)),
     r.sections.map(s => s.lists.map(l => l.length)));

  ok('nav links are not content', !/Sell Your Home/.test(text));
  ok('the footer address is not content', !/Independent Drive/.test(text));
  ok('the cookie banner is not content', !/cookies to improve/.test(text));

  const imgs = allImages(r);
  ok('photos are found', imgs.length >= 3, imgs);
  ok('image sources are absolute', imgs.every(s => s.startsWith('https://coastline-realty.test/')), imgs);
  ok('alt text is kept',
     r.sections.flatMap(s => s.images).some(i => i.alt.includes('Dana Whitfield on the porch')));
  ok('the srcset picks the largest', imgs.some(s => s.endsWith('map-2400.jpg')), imgs);
  ok('a 24px icon is not treated as a photo',
     !r.sections.flatMap(s => s.images).some(i => i.src.includes('icon-check') && i.w >= 120));
  ok('the CSS hero is found', imgs.some(s => s.endsWith('hero-beach-house.jpg')), imgs);

  ok('a page of bands is split into bands, not taken as one', r.sections.length >= 3, r.sections.length);
  ok('the hero band is marked as above the fold', r.sections.some(s => s.hero));
  ok('something below the fold is not', r.sections.some(s => !s.hero));

  const internal = r.links.filter(l => l.kind === 'internal').map(l => l.href);
  ok('internal links are listed', internal.some(h => h.endsWith('/listings/')), internal);
  ok('an external link is recorded as external',
     r.links.some(l => l.kind === 'external' && l.href.includes('facebook')));
  ok('an external link is not listed as internal', !internal.some(h => h.includes('facebook')));

  /* ── a dentist's service page, on WordPress ── */
  console.log('\ndentist.html');
  const d = await model(page, 'dentist.html', 'https://northgate-dental.test/services/', { key: 'services' });
  const dText = allText(d), dImgs = allImages(d);

  ok('a service page is graded support', d.value === 2, d.value);
  ok('the h1 comes through', /finishes in one visit/.test(dText));
  ok('both h2s come through',
     d.sections.filter(s => s.headings.some(h => h.level === 2)).length >= 2,
     d.sections.map(s => s.headings.map(h => h.text)));
  ok('the sidebar is not content', !/Monday to Thursday/.test(dText));
  ok('the footer heading is not content', !/Book an appointment/.test(dText));
  ok('the visually hidden skip link is not content', !/Skip to content/.test(dText));
  ok('the banner background is a photo', dImgs.some(s => s.includes('chair.jpg')), dImgs);
  ok('an absolute CDN source is left alone',
     dImgs.includes('https://cdn.northgate-dental.test/uploads/2023/chair.jpg'), dImgs);
  ok('a relative upload is resolved',
     dImgs.includes('https://northgate-dental.test/wp-content/uploads/2021/okafor.jpg'), dImgs);
  ok('blog tags are captured', d.tags.includes('Crowns') && d.tags.includes('Aligners'), d.tags);
  ok('the aligner list comes through', d.sections.some(s => s.lists.some(l => l.length === 3)));

  /* ── design rules, third-party features ── */
  console.log('\ndental/index.html');
  const n = await model(page, path.join('dental', 'index.html'), 'https://northgate-dental.test/',
                        { key: 'home', isEntry: true });

  ok('the site’s fonts are read off the page', n.design.fonts.includes('Georgia'), n.design.fonts);
  ok('the body colour is not taken from the eyebrow', n.design.colors.text === '#1e3040', n.design.colors);
  ok('the accent colour comes from the button', n.design.colors.accent === '#0f7b8a', n.design.colors);
  ok('the button treatment is captured',
     n.design.button && n.design.button.radius === '4px' && n.design.button.color === '#ffffff', n.design.button);
  ok('the content width is captured', n.design.maxWidth === 1080, n.design.maxWidth);

  const tp = n.thirdParty;
  ok('a map embed is found', tp.some(t => t.vendor === 'Google Maps' && t.feature === 'Map'), tp.map(t => t.vendor));
  ok('a map may be kept as an embed', tp.find(t => t.vendor === 'Google Maps').handling === 'embed');
  ok('a tracking script is found', tp.some(t => t.vendor === 'Google Tag Manager'), tp.map(t => t.vendor));
  ok('a tracking script is never carried across',
     tp.find(t => t.vendor === 'Google Tag Manager').handling === 'drop');
  ok('the site’s own scripts are not third parties', !tp.some(t => t.source.includes('northgate-dental.test')));
  ok('structured data is carried across as it stands',
     n.meta.schema.length === 1 && n.meta.schema[0]['@type'] === 'Dentist', n.meta.schema);

  ok('a card grid is seen as repeated items',
     n.sections.some(s => s.items && s.items.length === 3), n.sections.map(s => s.items && s.items.length));
  const cards = n.sections.find(s => s.items && s.items.length === 3).items;
  ok('each card keeps its own title, words and picture',
     cards.every(c => c.title && c.body && c.image && c.image.src), cards.map(c => c.title));
  ok('a real image reports that it loaded',
     n.sections.flatMap(s => s.images).filter(i => !i.background).every(i => i.loaded));

  console.log('\nedge cases');
  await page.setContent('<!doctype html><html><head><title>Empty</title></head><body></body></html>');
  await page.addScriptTag({ content: SRC });
  const empty = await page.evaluate(() => window.SitecraftExtract.extractPage(document, window, 'https://x.test/', {}));
  ok('an empty page returns an empty model', Array.isArray(empty.sections) && empty.sections.length === 0);
  ok('it still carries a name', empty.name === 'Empty', empty.name);

  await page.setContent('<!doctype html><html><body><main>' +
    '<h1>Only a heading &amp; an ampersand</h1><p>Short.</p>' +
    '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="pixel">' +
    '</main></body></html>');
  await page.addScriptTag({ content: SRC });
  const odd = await page.evaluate(() => window.SitecraftExtract.extractPage(document, window, 'https://x.test/', {}));
  ok('entities are decoded, not escaped', allText(odd).includes('& an ampersand'), allText(odd));
  ok('a data URI is never taken as a photo', !allImages(odd).some(s => s.startsWith('data:')));

  await b.close();
  console.log('\n' + pass + ' passing, ' + fail + ' failing');
  process.exit(fail ? 1 : 0);
})();
