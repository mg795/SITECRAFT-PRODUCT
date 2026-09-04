/*
 * The Read Tomato admin workflow, driven the way an employee drives it (§45):
 *
 *   Create Client → Confirm Authorisation → Start Migration → SiteCraft Crawls →
 *   SiteCraft Reconstructs → Exception Report → Review → Correct → Configure
 *   Editable/Duplicatable → Approve → Invite Client
 *
 * The migration model handed to the dashboard is made by the real crawler over the
 * real fixture, so this is the whole of Process A end to end.
 *
 *   node packages/site-import/test/admin.test.js
 */
const path = require('path');
const { launch } = require('./browser');
const { crawl } = require('../src/crawl');

const APP = 'file://' + path.resolve(__dirname, '..', '..', '..', 'app', 'sitecraft-admin.html');
const FIX = path.join(__dirname, 'fixtures');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};

(async () => {
  const b = await launch();

  console.log('\nthe migration this account will load');
  const mig = await crawl(b, 'file://' + path.join(FIX, 'dental', 'index.html'),
                          { settleMs: 100, as: 'https://northgate-dental.test/', maxPages: 12 });
  const model = JSON.stringify({ site: mig.site, design: mig.design, report: mig.report,
                                 summary: mig.summary, library: mig.library, assets: mig.assets });
  ok('it has critical exceptions to work through', mig.report.counts.critical === 5, mig.report.counts);

  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const state = () => page.evaluate(() => DB.accounts[0]);
  const body = () => page.locator('#app').innerText();

  await page.goto(APP);

  console.log('\ncreate client (§5)');
  ok('it opens on an empty account list', (await body()).includes('No accounts yet'));
  await page.click('#new');
  await page.click('#mk');
  ok('an empty form is refused', await page.locator('#e-business').isVisible());
  ok('and says what is missing per field',
     (await page.locator('#e-email').innerText()).includes('email address'));
  await page.fill('#f-url', 'not a website');
  await page.click('#mk');
  ok('a bad website address is refused',
     (await page.locator('#e-url').innerText()).includes("doesn't look like"));

  await page.fill('#f-business', 'Northgate Dental Care');
  await page.fill('#f-url', 'northgate-dental.test');
  await page.fill('#f-contactFirst', 'Amara');
  await page.fill('#f-contactLast', 'Okafor');
  await page.fill('#f-email', 'amara@northgate-dental.test');
  await page.selectOption('#f-category', 'Dentist');
  ok('the revision allowance defaults to three',
     await page.locator('#f-allowance').inputValue() === '3');
  await page.click('#mk');
  await page.waitForTimeout(120);
  let a = await state();
  ok('the account exists before any migration', !!a && a.migration === null, a && a.business);
  ok('it lands on the migration step', (await body()).includes('Authorisation'));
  ok('the source URL is normalised', a.url === 'https://northgate-dental.test/', a.url);

  console.log('\nauthorisation (§6)');
  ok('migration cannot begin without it', await page.locator('#mj').count() === 0);
  ok('the confirmation names the site and the client',
     (await body()).includes('northgate-dental.test') && (await body()).includes('Northgate Dental Care'));
  ok('the button is dead until the box is ticked', await page.locator('#doAuth').isDisabled());
  await page.check('#auth');
  ok('and live once it is', !(await page.locator('#doAuth').isDisabled()));
  await page.click('#doAuth');
  await page.waitForTimeout(100);
  a = await state();
  ok('who confirmed it is recorded', a.authorisation.by === 'mg@readtomato.com', a.authorisation);
  ok('when, and for which address', !!a.authorisation.at && a.authorisation.url === a.url);
  ok('and against which account', a.authorisation.account === a.id);
  ok('migration is only offered afterwards', await page.locator('#mj').count() === 1);

  console.log('\nstaging is explicit (§14)');
  ok('the screen says migration never touches the live site',
     /never writes to the client|separate, deliberate/.test(await body()), (await body()).slice(0, 400));

  console.log('\nload the migration (§7, §12)');
  await page.fill('#mj', 'not json');
  await page.click('#load');
  ok('rubbish is refused', (await page.locator('#toast').innerText()).includes('valid JSON'));
  await page.fill('#mj', JSON.stringify({ site:{ home:{} } }));
  await page.click('#load');
  ok('a model that is not a migration is refused',
     (await page.locator('#toast').innerText()).includes('not a Sitecraft migration'));
  await page.fill('#mj', model);
  await page.click('#load');
  await page.waitForTimeout(200);
  a = await state();
  ok('the migration is held against the account', !!a.migration && a.migration.summary.pages === 8);
  ok('a site with exceptions lands in Issues Found', a.status === 'issues', a.status);
  ok('a staging address is created', /staging\.sitecraft/.test(a.staging), a.staging);
  ok('and it is not the client’s own domain', !a.staging.includes('northgate-dental.test'), a.staging);

  console.log('\nthe exception report is what review opens with (§13)');
  let text = await body();
  ok('every exception is listed', (await page.locator('.exc').count()) === mig.report.entries.length,
     await page.locator('.exc').count());
  ok('the critical ones come first',
     (await page.locator('.exc').first().getAttribute('class')).includes('critical'));
  ok('each says what to do about it', text.includes('Upload the picture') || text.includes('Point the link'));
  ok('the missing picture is there', text.includes('did not load'));
  ok('the broken link is there', text.includes('pricing.html'));
  ok('the booking widget is there', text.includes('Calendly'));
  ok('nobody has to hunt through pages for them',
     text.includes('Nobody should have to find these by clicking through every page'));

  console.log('\nacceptance criteria (§49)');
  ok('the checklist is shown', await page.locator('.check').count() >= 9);
  ok('some checks are failing', await page.locator('.check.fail').count() >= 3);
  ok('Sitecraft checks, an administrator decides',
     text.includes('Sitecraft checks these. An administrator makes the decision'));

  console.log('\napproval is gated (§15)');
  ok('the approve button is dead', await page.locator('#approve').isDisabled());
  ok('and says why', /critical exception/.test(text), text.slice(text.indexOf('Approval')));
  await page.evaluate(() => { const a = DB.accounts[0];
    Object.values(a.migration.site).forEach(p => a.pagesApproved[p.key] = true); a.reviewed = true; save(); render(); });
  await page.waitForTimeout(100);
  ok('approving every page is still not enough while criticals stand',
     await page.locator('#approve').isDisabled());

  console.log('\nresolving exceptions');
  await page.locator('[data-res]').first().click();
  await page.waitForTimeout(100);
  ok('resolving asks what was actually done', await page.locator('#rn').isVisible());
  ok('and says Sitecraft cannot verify it',
     (await page.locator('#modal').innerText()).includes('cannot verify a fix it did not make'));
  await page.fill('#rn', 'Pointed the Fees link at the Services page');
  await page.locator('#modal [data-b="1"]').click();
  await page.waitForTimeout(120);
  a = await state();
  ok('the resolution records who and what',
     Object.values(a.resolved)[0].by === 'mg@readtomato.com' &&
     /Pointed the Fees link/.test(Object.values(a.resolved)[0].note), a.resolved);
  ok('and it is in the activity log', a.log.some(l => /Exception resolved/.test(l.what)));

  /* clear the rest the same way the interface does */
  await page.evaluate(() => { const a = DB.accounts[0];
    a.migration.report.entries.filter(e => e.severity === 'critical').forEach(e => {
      const k = e.kind + '|' + e.page + '|' + (e.detail || '');
      a.resolved[k] = a.resolved[k] || { by:'mg@readtomato.com', at:new Date().toISOString(), note:'fixed' };
    }); save(); render(); });
  await page.waitForTimeout(120);
  ok('with every critical resolved and every page reviewed, approval opens',
     !(await page.locator('#approve').isDisabled()));

  console.log('\nediting permissions are a whitelist (§19)');
  await page.click('[data-tab="editing"]');
  await page.waitForTimeout(150);
  text = await body();
  ok('it says nothing is editable unless turned on here',
     text.includes('Nothing is editable unless it is turned on here'));
  ok('there is no control anywhere for a font, a width or a stylesheet',
     !/\b(Font|Width|Stylesheet|CSS|Breakpoint)\b/.test(
       await page.locator('.comp .fl').allInnerTexts().then(x => x.join(' '))));
  const heroImage = await page.locator('[data-f$="|image"]').first();
  ok('a hero image starts editable', (await heroImage.innerText()).startsWith('✓'));
  await heroImage.click();
  await page.waitForTimeout(100);
  a = await state();
  const heroId = Object.keys(a.perms)[0];
  ok('an administrator can lock one field on one component',
     a.perms[heroId].image === false, a.perms);
  ok('and it is logged', a.log.some(l => /Field locked/.test(l.what)));
  await page.locator('[data-f$="|image"]').first().click();
  await page.waitForTimeout(100);
  a = await state();
  ok('and can open it again', !Object.keys(a.perms).length, a.perms);

  const dupBtn = page.locator('[data-dup]').first();
  ok('a component the library allows starts duplicatable', (await dupBtn.innerText()).includes('✓'));
  await dupBtn.click();
  await page.waitForTimeout(100);
  ok('an administrator can turn duplication off',
     (await state()).dup[Object.keys((await state()).dup)[0]] === false);
  ok('a hero offers no duplication control at all',
     (await page.locator('.comp').first().innerText()).includes('Cannot be duplicated'));

  console.log('\napprove and invite (§15, §20)');
  await page.click('[data-tab="client"]');
  await page.waitForTimeout(120);
  ok('a client cannot be invited before approval', await page.locator('#inv').isDisabled());
  ok('and it says why', (await body()).includes('only be invited to a site an administrator has approved'));
  await page.click('[data-tab="review"]');
  await page.waitForTimeout(120);
  await page.click('#approve');
  await page.waitForTimeout(120);
  a = await state();
  ok('approval records who and when', a.approved && a.approvedBy === 'mg@readtomato.com' && !!a.approvedAt);
  ok('the account is now Approved', a.status === 'approved', a.status);
  await page.click('[data-tab="client"]');
  await page.waitForTimeout(120);
  ok('now the client can be invited', !(await page.locator('#inv').isDisabled()));
  await page.click('#inv');
  await page.waitForTimeout(120);
  a = await state();
  ok('the invitation is recorded', a.invite === 'sent' && !!a.invitedAt);
  ok('the account is Ready for Client', a.status === 'client_ready', a.status);
  ok('and it is honest that the email needs a server',
     (await page.locator('#toast').innerText()).includes('needs the server'));
  ok('an invitation can be resent', await page.locator('#resend').count() === 1);
  await page.click('#markact');
  await page.waitForTimeout(100);
  ok('activation is recorded', (await state()).invite === 'activated');
  await page.click('#susp');
  await page.waitForTimeout(100);
  ok('a client can be suspended', (await state()).invite === 'suspended');

  console.log('\nreopening an exception withdraws approval');
  await page.click('[data-tab="review"]');
  await page.waitForTimeout(120);
  await page.locator('[data-unres]').first().click();
  await page.waitForTimeout(120);
  a = await state();
  ok('approval does not survive a reopened critical', a.approved === false, a.approved);
  ok('and the withdrawal is logged', a.log.some(l => /Approval withdrawn/.test(l.what)));

  console.log('\nrevision controls (§30–§33)');
  await page.click('[data-tab="overview"]');
  await page.waitForTimeout(120);
  text = await body();
  ok('a revision is defined as one publication', text.includes('one publication'));
  ok('and unused ones do not roll over', text.includes('do not roll over'));
  ok('and zero stops publishing, not working',
     text.includes('can still log in, edit, and preview'));
  await page.click('#revcfg');
  await page.waitForTimeout(100);
  await page.fill('#al', '5');
  await page.fill('#ex', '2');
  await page.locator('#modal [data-b="1"]').click();
  await page.waitForTimeout(120);
  a = await state();
  ok('an administrator can change the allowance and add extras',
     a.allowance === 5 && a.extra === 2, { allowance:a.allowance, extra:a.extra });
  ok('remaining is allowance plus extras less used',
     (await body()).includes('7'), (await body()).slice(0, 200));

  console.log('\nthe account list (§4)');
  await page.click('[data-go="accounts"]');
  await page.waitForTimeout(120);
  text = await body();
  const heads = (await page.locator('th').allInnerTexts()).join(' | ').toLowerCase();
  ['Business','Primary Contact','Websites','Migration','Client','Revisions','Last Login']
    .forEach(h => ok('the list has a column for ' + h.toLowerCase(), heads.includes(h.toLowerCase()), heads));
  ok('and shows the account on it', text.includes('Northgate Dental Care'));
  ok('with its source and staging addresses',
     text.includes('northgate-dental.test') && text.includes('staging.sitecraft'), text.slice(0, 400));
  ok('and does not put migration detail on it',
     !text.includes('Exception') && !text.includes('Calendly'), text.slice(0, 300));

  console.log('\nit survives a refresh (§41 in spirit)');
  await page.reload();
  await page.waitForTimeout(200);
  a = await state();
  ok('the account is still there', !!a && a.business === 'Northgate Dental Care');
  ok('so is its migration', !!a.migration && a.migration.summary.pages === 8);
  ok('so is its authorisation', !!a.authorisation);
  ok('so is its activity log', a.log.length > 6, a.log.length);
  ok('nothing threw at any point', errs.length === 0, errs);

  console.log('\nthe example account carries a real migration');
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p2 = await ctx2.newPage();
  const e2 = [];
  p2.on('pageerror', e => e2.push(e.message));
  await p2.goto(APP);
  await p2.click('#seed');
  await p2.waitForTimeout(150);
  ok('it lands on authorisation, not on a loaded site',
     await p2.locator('#auth').count() === 1 && await p2.locator('#ex').count() === 0);
  await p2.check('#auth');
  await p2.click('#doAuth');
  await p2.waitForTimeout(120);
  ok('the example migration is offered once authorisation is recorded',
     await p2.locator('#ex').count() === 1);
  await p2.click('#ex');
  await p2.waitForTimeout(250);
  const ex = await p2.evaluate(() => DB.accounts[0]);
  ok('it is the real eight-page migration', ex.migration.summary.pages === 8, ex.migration.summary);
  ok('with a real exception report', ex.migration.report.counts.critical === 5, ex.migration.report.counts);
  ok('and its planted faults',
     ex.migration.report.entries.some(x => x.kind === 'image_missing') &&
     ex.migration.report.entries.some(x => x.kind === 'broken_link'));
  ok('nothing threw loading it', e2.length === 0, e2);
  await ctx2.close();

  await b.close();
  console.log('\n' + pass + ' passing, ' + fail + ' failing');
  process.exit(fail ? 1 : 0);
})();
