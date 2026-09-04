/*
 * The extractor runs inside a page, so the tests do too: each fixture is loaded
 * in a real browser, the extractor is injected, and the model it returns is
 * checked. That is the same path a production import takes, with a fixture in
 * place of the client's site.
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

(async () => {
  const b = await launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => { fail++; console.log('  FAIL page error: ' + e.message); });

  /* ── a realtor's home page ── */
  console.log('\nrealtor.html');
  const r = await model(page, 'realtor.html', 'https://coastline-realty.test/', { key: 'home', isEntry: true });
  const text = r.comps.map(c => c.text).join(' | ');

  ok('page is named from the title', r.name === 'Coastline Realty', r.name);
  ok('entry page is graded critical', r.value === 3, r.value);
  ok('description is carried across', r.meta.description.startsWith('Buying or selling'), r.meta.description);
  ok('canonical is carried across', r.meta.canonical === 'https://coastline-realty.test/', r.meta.canonical);

  ok('the h1 comes through', r.comps.some(c => c.t === 'h1' && c.text === 'Find the house, not the listing'));
  ok('the kicker above it is an eyebrow',
     r.comps.some(c => c.t === 'kick' && c.text.startsWith('Jacksonville')),
     r.comps.filter(c => c.t === 'kick').map(c => c.text));
  ok('the lede is body copy', r.comps.some(c => c.t === 'p' && c.text.includes('four hundred homes')));
  ok('list items come through as bands', r.comps.filter(c => c.t === 'band').length === 4,
     r.comps.filter(c => c.t === 'band').length);

  ok('nav links are not content', !/Sell Your Home/.test(text));
  ok('the footer address is not content', !/Independent Drive/.test(text));
  ok('the cookie banner is not content', !/cookies to improve/.test(text));

  const imgs = r.comps.filter(c => c.t === 'img');
  ok('photos are found', imgs.length >= 3, imgs.map(i => i.src));
  ok('image sources are absolute',
     imgs.every(i => i.src.startsWith('https://coastline-realty.test/')), imgs.map(i => i.src));
  ok('alt text is kept', imgs.some(i => i.alt.includes('Dana Whitfield on the porch')));
  ok('the srcset picks the largest', imgs.some(i => i.src.endsWith('map-2400.jpg')), imgs.map(i => i.src));
  ok('a 24px icon is not a feature photo', !imgs.some(i => i.src.includes('icon-check')));
  ok('the CSS hero is found', imgs.some(i => i.src.endsWith('hero-beach-house.jpg')), imgs.map(i => i.src));

  ok('hero components are marked', r.comps.some(c => c.hero === 1 && c.t === 'h1'));
  ok('below the fold is not', r.comps.some(c => c.hero === 0));

  const internal = r.links.map(l => l.href);
  ok('internal links are listed', internal.some(h => h.endsWith('/listings/')), internal);
  ok('external links are not', !internal.some(h => h.includes('facebook')), internal);
  ok('ids are unique', new Set(r.comps.map(c => c.id)).size === r.comps.length);
  ok('every component has text', r.comps.every(c => typeof c.text === 'string' && c.text.length > 0));

  /* ── a dentist's service page, on WordPress ── */
  console.log('\ndentist.html');
  const d = await model(page, 'dentist.html', 'https://northgate-dental.test/services/', { key: 'services' });

  ok('a service page is graded support', d.value === 2, d.value);
  ok('the h1 comes through', d.comps.some(c => c.t === 'h1' && c.text.includes('finishes in one visit')));
  ok('both h2s come through', d.comps.filter(c => c.t === 'h2').length >= 2,
     d.comps.filter(c => c.t === 'h2').map(c => c.text));
  ok('the sidebar is not content', !d.comps.some(c => /Monday to Thursday/.test(c.text)),
     d.comps.map(c => c.text).find(t => /Monday/.test(t)));
  ok('the footer heading is not content', !d.comps.some(c => c.text === 'Book an appointment'));
  ok('the visually hidden skip link is not content', !d.comps.some(c => /Skip to content/.test(c.text)));
  ok('the banner background is a photo', d.comps.some(c => c.t === 'img' && c.src.includes('chair.jpg')),
     d.comps.filter(c => c.t === 'img').map(c => c.src));
  ok('an absolute CDN source is left alone',
     d.comps.some(c => c.src === 'https://cdn.northgate-dental.test/uploads/2023/chair.jpg'));
  ok('a relative upload is resolved',
     d.comps.some(c => c.src === 'https://northgate-dental.test/wp-content/uploads/2021/okafor.jpg'),
     d.comps.filter(c => c.t === 'img').map(c => c.src));
  ok('blog tags are captured', d.tags.includes('Crowns') && d.tags.includes('Aligners'), d.tags);
  ok('the aligner list comes through', d.comps.filter(c => c.t === 'band').length === 3,
     d.comps.filter(c => c.t === 'band').map(c => c.text));

  /* ── things that should not crash it ── */
  console.log('\nedge cases');
  await page.setContent('<!doctype html><html><head><title>Empty</title></head><body></body></html>');
  await page.addScriptTag({ content: SRC });
  const empty = await page.evaluate(() => window.SitecraftExtract.extractPage(document, window, 'https://x.test/', {}));
  ok('an empty page returns an empty model', Array.isArray(empty.comps) && empty.comps.length === 0);
  ok('it still carries a name', empty.name === 'Empty', empty.name);

  await page.setContent('<!doctype html><html><body><main>' +
    '<h1>Only a heading &amp; an ampersand</h1><p>Short.</p>' +
    '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="pixel">' +
    '</main></body></html>');
  await page.addScriptTag({ content: SRC });
  const odd = await page.evaluate(() => window.SitecraftExtract.extractPage(document, window, 'https://x.test/', {}));
  ok('entities are decoded, not escaped', odd.comps.some(c => c.text.includes('& an ampersand')),
     odd.comps.map(c => c.text));
  ok('a one word paragraph is not body copy', !odd.comps.some(c => c.t === 'p'));
  ok('a data URI is not imported as a photo', !odd.comps.some(c => c.t === 'img'));

  await b.close();
  console.log('\n' + pass + ' passing, ' + fail + ' failing');
  process.exit(fail ? 1 : 0);
})();
