/*
 * The crawler, driven end to end against a three page site on disk. Every step a
 * production import takes runs here except the network hop itself: pages are
 * rendered in a real browser, the extractor runs inside them, links are followed,
 * and the result is the model the editor loads.
 *
 *   node packages/site-import/test/crawl.test.js
 */
const path = require('path');
const { launch } = require('./browser');
const { crawl, rank } = require('../src/crawl');
const { toSite, keyFor, uniqueKeys } = require('../src/tosite');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};

const SITE_DIR = path.join(__dirname, 'fixtures', 'site');

(async () => {
  console.log('\nkeys');
  ok('the entry page is home', keyFor('https://x.test/anything/', true) === 'home');
  ok('a path becomes its last part', keyFor('https://x.test/services/') === 'services');
  ok('an extension is dropped', keyFor('https://x.test/about-us.html') === 'about-us');
  ok('a root that is not the entry is still home', keyFor('https://x.test/') === 'home');
  ok('a clash is numbered',
     uniqueKeys([{url:'https://x.test/a/team/'},{url:'https://x.test/b/team/'}]).map(p => p.key)
       .join(',') === 'team,team-2');
  ok('nothing else may claim home',
     uniqueKeys([{url:'https://x.test/',isEntry:true},{url:'https://x.test/home/'}]).map(p => p.key)
       .join(',') === 'home,home-page');
  ok('a service page outranks a deep one', rank('https://x.test/services/') < rank('https://x.test/a/b/c/'));

  console.log('\ncrawl');
  const b = await launch();
  const out = await crawl(b, 'file://' + path.join(SITE_DIR, 'index.html'), { settleMs: 80, as: 'https://harbourlight.test/' });
  const keys = Object.keys(out.site);

  ok('every page came across', out.report.pages === 3, keys);
  ok('the entry page is first and is home', keys[0] === 'home', keys);
  ok('the linked pages are named from their address',
     keys.includes('services') && keys.includes('donate'), keys);
  ok('nothing failed', out.errors.length === 0, out.errors);
  ok('the entry page is graded critical', out.site.home.value === 3, out.site.home.value);

  const home = out.site.home;
  ok('the page is named from the title', home.name === 'Harbour Light Trust', home.name);
  ok('the h1 came across',
     home.comps.some(c => c.t === 'h1' && c.text === 'Nobody sleeps outside in this city tonight'));
  ok('the kicker is an eyebrow', home.comps.some(c => c.t === 'kick' && c.text.includes('since 1998')),
     home.comps.filter(c => c.t === 'kick').map(c => c.text));
  ok('the CSS hero came across',
     home.comps.some(c => c.t === 'img' && c.src === 'https://harbourlight.test/img/shelter-night.jpg'),
     home.comps.filter(c => c.t === 'img').map(c => c.src));
  ok('the list came across as three bands', home.comps.filter(c => c.t === 'band').length === 3,
     home.comps.filter(c => c.t === 'band').map(c => c.text));
  ok('the charity number in the footer is not content',
     !home.comps.some(c => /SC012345/.test(c.text)));
  ok('the navigation is not content', !home.comps.some(c => c.text === 'Donate'));

  const all = Object.values(out.site).flatMap(p => p.comps);
  ok('ids are unique across the whole site', new Set(all.map(c => c.id)).size === all.length);
  ok('every id names its page', all.every(c => c.id.startsWith(c.id.split('-')[0])));
  ok('a photo used on two pages is imported once',
     all.filter(c => c.src && c.src.endsWith('dorm.jpg')).length === 1,
     all.filter(c => c.t === 'img').map(c => c.src));
  ok('an off site link is not followed', !keys.some(k => /twitter/.test(k)), keys);
  ok('every page is recorded at the address it will be published under',
     Object.values(out.site).every(p => p.url.startsWith('https://harbourlight.test/')),
     Object.values(out.site).map(p => p.url));
  ok('so is every photo',
     all.filter(c => c.t === 'img').every(c => c.src.startsWith('https://harbourlight.test/')),
     all.filter(c => c.t === 'img').map(c => c.src));

  console.log('\nwhat the administrator is told');
  ok('photos are counted', out.report.photos === 3, out.report);
  ok('headings are counted', out.report.headings >= 6, out.report);
  ok('words are counted', out.report.words > 200, out.report.words);
  ok('untitled photos are counted', typeof out.report.untitled === 'number', out.report);

  console.log('\nwhat an import may carry');
  ok('a component carries only what the editor reads',
     all.every(c => Object.keys(c).every(k => ['id','lbl','t','text','hero','src','alt','dim'].includes(k))),
     all.find(c => Object.keys(c).some(k => !['id','lbl','t','text','hero','src','alt','dim'].includes(k))));
  ok('no imported component carries a score',
     all.every(c => c.s === undefined && c.u === undefined && c.price === undefined));
  ok('a page over the limit is dropped, not merged',
     toSite([{url:'https://x.test/',isEntry:true,name:'A',value:3,comps:[]},
             {url:'https://x.test/b/',name:'B',value:2,comps:[]}], {maxPages:1}).report.dropped === 1);

  await b.close();
  console.log('\n' + pass + ' passing, ' + fail + ' failing');
  process.exit(fail ? 1 : 0);
})();
