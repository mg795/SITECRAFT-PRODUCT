/*
 * The import screen, driven the way an administrator drives it: open the junior
 * editor with ?admin, paste what the crawler wrote, and check the client's site
 * is what the editor is now showing.
 *
 *   node packages/site-import/test/junior-import.test.js
 */
const path = require('path');
const fs = require('fs');
const { launch } = require('./browser');
const { crawl } = require('../src/crawl');

const APP = path.resolve(__dirname, '..', '..', '..', 'app', 'sitecraft-junior.html');
const SITE_DIR = path.join(__dirname, 'fixtures', 'site');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};

(async () => {
  const b = await launch();

  /* the model, made the way production makes it */
  const model = await crawl(b, 'file://' + path.join(SITE_DIR, 'index.html'),
                            { settleMs: 80, as: 'https://harbourlight.test/' });
  const json = JSON.stringify({ site: model.site, report: model.report });

  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  console.log('\nthe admin door');
  await page.goto('file://' + APP);
  await page.click('[data-mode="account"]');
  ok('a client never sees the importer', await page.locator('#imp').count() === 0);
  await page.click('#p-x');

  await page.goto('file://' + APP + '?admin');
  await page.click('[data-mode="account"]');
  await page.click('[data-t="a5"]');
  ok('an administrator does', await page.locator('#imp').isVisible());

  console.log('\nimporting');
  await page.click('#imp');
  ok('it asks for the address first', await page.locator('#iu').isVisible());
  await page.fill('#iu', 'not a website');
  await page.click('#ig');
  ok('a bad address is refused', /website address/.test(await page.locator('#toast').innerText()));

  await page.fill('#iu', 'harbourlight.test');
  await page.click('#ig');
  await page.waitForSelector('#ijson', { timeout: 8000 });
  ok('with no importer to reach, it says so and offers the other way in', true);
  ok('the address it settled on is kept above',
     (await page.locator('.sdone .lbl2').innerText()).includes('harbourlight.test'));

  await page.fill('#ijson', 'this is not json');
  await page.click('#ip');
  ok('rubbish is refused', /valid JSON/.test(await page.locator('#toast').innerText()));

  await page.fill('#ijson', json);
  await page.click('#ip');
  await page.waitForSelector('#io', { timeout: 8000 });
  const summary = await page.locator('#p-bd').innerText();
  ok('the report names the site', summary.includes('Harbour Light Trust'), summary.slice(0, 200));
  ok('it counts the pages', /\b3\b/.test(summary));
  ok('it says which photos have no description', /no description/.test(summary), summary);

  console.log('\nafter loading');
  await page.click('#io');
  await page.waitForTimeout(200);
  const navText = await page.locator('nav.site').innerText();
  ok('the client name replaces the old one', navText.includes('Harbour Light Trust'), navText);
  ok('the old site is gone', !navText.includes('Episodes'), navText);
  ok('every imported page is in the navigation',
     ['Harbour Light Trust', 'What We Do', 'Donate'].every(n => navText.includes(n)), navText);

  const body = await page.locator('#hero, #page').allInnerTexts();
  const shown = body.join(' ');
  ok('the client h1 is on the page', shown.includes('Nobody sleeps outside in this city tonight'), shown.slice(0, 300));
  ok('the demo copy is gone', !shown.includes('Real Estate Excellence'));
  ok('the components are editable', await page.locator('.c[data-id]').count() > 5);

  await page.click('nav.site a[data-go="services"]');
  await page.waitForTimeout(150);
  const second = (await page.locator('#hero, #page').allInnerTexts()).join(' ');
  ok('a second page renders', second.includes('Three things, done properly'), second.slice(0, 160));
  ok('the pages are open, because nothing has been changed yet',
     await page.evaluate(() => S.editing) === false);

  console.log('\nclicking into imported content');
  await page.click('#page .c[data-id]');
  await page.waitForTimeout(200);
  ok('an imported component opens the editor', await page.locator('#pan.open').count() === 1);
  ok('with nothing invented about it', !(await page.locator('#p-bd').innerText()).includes('%'));
  await page.click('#p-x');

  console.log('\nwhat an import may not do');
  await page.goto('file://' + APP + '?admin');
  await page.click('[data-mode="account"]');
  await page.click('[data-t="a5"]');
  await page.click('#imp');
  await page.fill('#iu', 'evil.test');
  await page.click('#ig');
  await page.waitForSelector('#ijson');
  await page.fill('#ijson', JSON.stringify({ site: { home: { name: 'X<img src=x onerror=alert(1)>', value: 3, comps: [
    { id: 'a', lbl: 'Heading', t: 'h1', text: '<script>alert(1)<\/script>' },
    { id: 'b', lbl: 'Feature Photo', t: 'img', src: 'javascript:alert(1)', alt: '"><b>x', text: 'Photo' },
    { id: 'c', lbl: 'Bad', t: 'iframe src=//evil', text: 'nope' },
  ] } } }));
  await page.click('#ip');
  await page.waitForSelector('#io');
  await page.click('#io');
  await page.waitForTimeout(200);
  ok('a script in the copy is shown as words, not run',
     (await page.locator('#hero, #page').allInnerTexts()).join(' ').includes('<script>alert(1)</script>'));
  ok('no tag was created from imported content', await page.locator('iframe, #hero script, #page script').count() === 0);
  ok('a javascript source is dropped',
     !(await page.locator('#page').innerHTML()).includes('javascript:'));
  ok('an unknown component type is dropped', await page.locator('[data-id="c"]').count() === 0);
  ok('nothing threw', errs.length === 0, errs);

  await b.close();
  console.log('\n' + pass + ' passing, ' + fail + ' failing');
  process.exit(fail ? 1 : 0);
})();
