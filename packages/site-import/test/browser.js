'use strict';
/* Playwright is the caller's to install; this only has to find it. */
function playwright(){
  const tried = [];
  for (const name of [process.env.PLAYWRIGHT_PATH, 'playwright', 'playwright-core'].filter(Boolean)){
    try { return require(name); } catch { tried.push(name); }
  }
  console.error('These tests render real pages, so they need Playwright:\n  npm i playwright\n' +
                'or set PLAYWRIGHT_PATH to an installed copy. Tried: ' + tried.join(', '));
  process.exit(1);
}
/* CHROMIUM_PATH covers a machine where the browser is not where Playwright looks. */
const launch = () => playwright().chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

module.exports = { playwright, launch };
