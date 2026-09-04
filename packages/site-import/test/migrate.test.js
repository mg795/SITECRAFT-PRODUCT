/*
 * A whole migration, end to end, over a site on disk: crawl, extract, componentize,
 * exception report, acceptance. Every step a production import takes runs here
 * except the network hop itself.
 *
 *   node packages/site-import/test/migrate.test.js
 */
const path = require('path');
const { launch } = require('./browser');
const { crawl, rank, addressing } = require('../src/crawl');
const { toSite, keyFor, uniqueKeys } = require('../src/tosite');
const { LIBRARY, editableFields, normalisePerms } = require('../src/library');
const { classify, shortfalls } = require('../src/componentize');
const { can, afterMigration, STATES } = require('../src/status');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};
const FIX = path.join(__dirname, 'fixtures');
const typesOn = (site, key) => site[key].components.map(c => c.type);
const find = (site, key, type) => site[key].components.find(c => c.type === type);

(async () => {
  /* ── things that need no browser ── */
  console.log('\nthe whitelist');
  ok('nothing is editable unless the library says so',
     editableFields('embed').join(',') === 'headline,body', editableFields('embed'));
  ok('there is no field anywhere for a font, a width or a stylesheet',
     !Object.values(LIBRARY).some(d => Object.keys(d.fields).some(k => /font|width|css|style|class/i.test(k))));
  ok('an administrator can switch a field off',
     !editableFields('hero', { image:false }).includes('image'));
  ok('an administrator cannot switch a locked field on',
     normalisePerms('embed', { src:true, vendor:true }) === null);
  ok('a permission for a field that does not exist is dropped',
     normalisePerms('hero', { nonsense:false }) === null);
  ok('only some components may be duplicated',
     LIBRARY.text.duplicatable && LIBRARY.featured_item.duplicatable && !LIBRARY.hero.duplicatable);

  console.log('\nkeys and ordering');
  ok('the entry page is home', keyFor('https://x.test/anything/', true) === 'home');
  ok('a path becomes its last part', keyFor('https://x.test/services/') === 'services');
  ok('an extension is dropped', keyFor('https://x.test/about-us.html') === 'about-us');
  ok('a clash is numbered',
     uniqueKeys([{url:'https://x.test/a/team/'},{url:'https://x.test/b/team/'}]).map(p=>p.key).join(',') === 'team,team-2');
  ok('nothing else may claim home',
     uniqueKeys([{url:'https://x.test/',isEntry:true},{url:'https://x.test/home/'}]).map(p=>p.key).join(',') === 'home,home-page');
  ok('a service page is crawled before a deep one', rank('https://x.test/services/') < rank('https://x.test/a/b/c/'));
  ok('a page is fetched where it lives and recorded where it belongs',
     addressing('file:///tmp/s/index.html', 'https://c.test/').toModel('file:///tmp/s/about.html')
       === 'https://c.test/about.html');

  console.log('\nmigration status');
  ok('a site cannot be approved with critical exceptions left',
     !can('review','approved',{ criticalCount:3, reviewed:true }).ok);
  ok('a site cannot be approved before it is reviewed',
     !can('review','approved',{ criticalCount:0, reviewed:false }).ok);
  ok('a reviewed, clean site can be approved',
     can('review','approved',{ criticalCount:0, reviewed:true }).ok);
  ok('a client cannot be invited to an unapproved site',
     !can('review','client_ready',{}).ok);
  ok('going live is never a step migration can take',
     !can('client_ready','live',{}).ok && can('client_ready','live',{ deployApproved:true }).ok);
  ok('migration itself never reaches approved',
     !Object.values(STATES).some(s => s.next.includes('live') && s.label === 'Processing'));
  ok('a clean reconstruction still stops at reconstructed',
     afterMigration({ counts:{ critical:0, total:0 } }) === 'reconstructed');
  ok('anything found sends it to issues',
     afterMigration({ counts:{ critical:0, total:2 } }) === 'issues');

  /* ── the whole thing, in a browser ── */
  const b = await launch();

  console.log('\na dentist’s site, migrated');
  const out = await crawl(b, 'file://' + path.join(FIX, 'dental', 'index.html'),
                          { settleMs: 100, as: 'https://northgate-dental.test/', maxPages: 12 });
  const site = out.site, keys = Object.keys(site);

  ok('every page came across', out.summary.pages === 8, keys);
  ok('the entry page is first and is home', keys[0] === 'home', keys);
  ok('pages two links deep came across too',
     keys.includes('whitening-myths') && keys.includes('broken-tooth'), keys);
  ok('a link to a page that never existed did not take a real page down with it',
     keys.includes('blog'), keys);
  ok('the crawl stayed on the client’s domain',
     Object.values(site).every(p => p.url.startsWith('https://northgate-dental.test/')));

  console.log('\nstructured reconstruction');
  ok('no page is stored as one slab of markup',
     Object.values(site).every(p => Array.isArray(p.components) && !('html' in p)));
  ok('every component is a known library type',
     Object.values(site).flatMap(p => p.components).every(c => !!LIBRARY[c.type]),
     Object.values(site).flatMap(p => p.components).map(c => c.type).filter(t => !LIBRARY[t]));
  ok('the home page is a hero, a set of items, an embed and a call to action',
     typesOn(site,'home').join(',') === 'hero,featured_item,embed,cta', typesOn(site,'home'));
  ok('the hero keeps its eyebrow, its headline and its button',
     (h => h.fields.eyebrow === 'Northgate, Seattle' && /finishes in one visit/.test(h.fields.headline)
        && h.fields.ctaLabel === 'Book an appointment')(find(site,'home','hero')),
     find(site,'home','hero').fields);
  ok('a full-bleed cover photo is folded into the hero, not left as a stray picture',
     !!find(site,'home','hero').fields.image.src.match(/practice-front/),
     find(site,'home','hero').fields.image);
  ok('a row of three cards is one Featured Items component with three items',
     find(site,'home','featured_item').fields.items.length === 3);
  ok('each item keeps its own title, words and picture',
     find(site,'home','featured_item').fields.items.every(i => i.title && i.body && i.image.src));
  ok('a picture beside words is Image and Text',
     typesOn(site,'services').includes('image_text'), typesOn(site,'services'));
  ok('a heading over a list is Text and is not called incomplete',
     (t => t && t.status === 'ok' && t.fields.list.length === 3)(find(site,'services','text')),
     find(site,'services','text'));
  ok('a telephone call to action keeps its tel: link',
     find(site,'home','cta').fields.ctaHref === 'tel:+12065550142');
  ok('the blog index is a Blog Listing that fills itself',
     typesOn(site,'blog').join(',') === 'blog_listing', typesOn(site,'blog'));
  ok('the listing keeps its own introduction',
     /Short pieces/.test(find(site,'blog','blog_listing').fields.body || ''),
     find(site,'blog','blog_listing').fields);
  ok('an article is a Blog Post', typesOn(site,'whitening-myths').join(',') === 'blog_post');
  ok('the article keeps its featured image', !!find(site,'whitening-myths','blog_post').fields.image.src);
  ok('a client may duplicate a service card but not a hero',
     find(site,'home','featured_item').duplicatable === true && find(site,'home','hero').duplicatable === false);
  ok('the editor still gets a flat reading of every page',
     Object.values(site).every(p => Array.isArray(p.comps) && p.comps.length));
  ok('the flat reading is derived, so nothing can disagree with the components',
     site.home.comps.some(c => c.text === 'Dentistry that finishes in one visit'));

  console.log('\nthird-party features are an exception, never a copy');
  const maps = find(site,'home','embed'), cal = site.contact.components.find(c => c.fields.vendor === 'Calendly');
  ok('a map stays in the band it was in, under its own heading',
     maps.fields.headline === 'Where to find us', maps.fields);
  ok('and keeps the words that were around it', /5th Avenue NE/.test(maps.fields.body || ''));
  ok('a map may be kept as the embed it already is', maps.fields.src.includes('google.com/maps'));
  ok('a booking tool is never rebuilt and never carries its address forward',
     cal && cal.fields.src === '' && cal.status === 'review', cal && cal.fields);
  ok('an off-site form is a third-party feature, not a form SiteCraft made',
     site.contact.components.some(c => c.fields.vendor === 'HubSpot'));
  ok('nothing third-party is editable by a client',
     Object.values(site).flatMap(p => p.components).filter(c => c.type === 'embed')
       .every(c => !editableFields('embed').includes('src')));
  ok('a tracking script is never made into a component',
     !Object.values(site).flatMap(p => p.components).some(c => /Tag Manager/.test(JSON.stringify(c.fields))));

  console.log('\nthe exception report');
  const rep = out.report, kinds = rep.entries.map(e => e.kind);
  ok('it found the picture with no file behind it', kinds.includes('image_missing'),
     rep.entries.map(e => e.kind + ':' + e.page));
  ok('it named the page the picture is on',
     rep.entries.find(e => e.kind === 'image_missing').page === 'services');
  ok('it found the link to a page that does not exist', kinds.includes('broken_link'));
  ok('a page that never existed is reported once, as the broken link',
     rep.entries.filter(e => /pricing/.test(String(e.detail))).length === 1,
     rep.entries.filter(e => /pricing/.test(String(e.detail))));
  ok('it found the page with no description', kinds.includes('meta_missing'));
  ok('it found the heading level the blog skips', kinds.includes('heading_order'));
  ok('every third-party feature is on it',
     rep.entries.filter(e => e.kind === 'third_party').length === 3,
     rep.entries.filter(e => e.kind === 'third_party').map(e => e.detail));
  ok('the tracking script is recorded as dropped, not as a problem',
     rep.entries.some(e => e.kind === 'script_dropped' && e.severity === 'note'));
  ok('structured data is noted so somebody checks it',
     rep.entries.some(e => e.kind === 'schema_carried'));
  ok('every entry says what to do about it', rep.entries.every(e => e.fix && e.message));
  ok('every entry names its page', rep.entries.every(e => e.page));
  ok('the most serious come first',
     rep.entries[0].severity === 'critical' && rep.entries[rep.entries.length-1].severity === 'note');
  ok('the counts add up',
     rep.counts.critical + rep.counts.warning + rep.counts.note === rep.counts.total &&
     rep.counts.total === rep.entries.length, rep.counts);

  console.log('\nacceptance, and what it refuses');
  ok('a site with critical exceptions cannot be approved', rep.approvable === false);
  ok('migration left it in Issues Found', out.status === 'issues', out.status);
  ok('the acceptance list covers what the brief asks for', rep.acceptance.length >= 9, rep.acceptance.length);
  ok('it says images do not all load', !rep.acceptance.find(c => c.name === 'Images load').pass);
  ok('it says navigation does not work', !rep.acceptance.find(c => c.name === 'Navigation works').pass);
  ok('it does not claim pages are missing when they are not',
     rep.acceptance.find(c => c.name === 'All expected pages exist').pass);
  ok('it recognises the blog', rep.acceptance.find(c => c.name === 'Blog structure works').pass);

  console.log('\nthe site’s design rules');
  ok('the fonts are the site’s own', out.design.fonts[0] === 'Georgia', out.design.fonts);
  ok('the accent is the button colour', out.design.colors.accent === '#0f7b8a', out.design.colors);
  ok('the content width is kept', out.design.maxWidth === 1080);
  ok('a client has no field that can change any of it',
     !Object.values(LIBRARY).some(d => Object.values(d.fields).some(f => f.editable && /^(color|font|width)/.test(f.kind))));

  console.log('\na charity’s site, to prove none of this is fixture-shaped');
  const c2 = await crawl(b, 'file://' + path.join(FIX, 'site', 'index.html'),
                         { settleMs: 80, as: 'https://harbourlight.test/', maxPages: 8 });
  ok('three pages came across', c2.summary.pages === 3, Object.keys(c2.site));
  ok('a hand-written page with no sections at all is still split into bands',
     c2.site.services.components.length === 4, typesOn(c2.site,'services'));
  ok('a cover photo that cannot be folded in is kept as its own picture, not dropped',
     typesOn(c2.site,'home')[0] === 'image' &&
     /shelter-night/.test(c2.site.home.components[0].fields.image.src), typesOn(c2.site,'home'));
  ok('and the headline band below it is still the hero, with its kicker',
     find(c2.site,'home','hero').fields.eyebrow === 'Dundee, since 1998',
     find(c2.site,'home','hero').fields);
  ok('a band with no paragraph carries no empty body field',
     find(c2.site,'home','text').fields.body === undefined,
     find(c2.site,'home','text').fields);
  ok('a photo used on two pages stays on both',
     Object.values(c2.site).flatMap(p => p.components)
       .filter(x => x.fields.image && /dorm/.test(x.fields.image.src)).length === 2);
  ok('and is counted once as an asset',
     c2.assets.filter(a => /dorm/.test(a.src)).length === 1 &&
     c2.assets.find(a => /dorm/.test(a.src)).uses === 2, c2.assets);
  ok('no page is empty', Object.values(c2.site).every(p => p.components.length));

  await b.close();
  console.log('\n' + pass + ' passing, ' + fail + ' failing');
  process.exit(fail ? 1 : 0);
})();
