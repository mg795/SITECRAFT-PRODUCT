#!/usr/bin/env node
'use strict';
/*
 * Bring a client's site across from a command line.
 *
 *   node packages/site-import/bin/import.js https://northgate-dental.test/
 *   node packages/site-import/bin/import.js <url> --as https://client.com/ --pages 6 --out client.json
 *
 * What it writes is exactly what the editor's import screen reads, so an
 * administrator on a machine that can reach the client's site can run this and
 * paste the result in, with or without the import server running.
 */
const fs = require('fs');
const path = require('path');
const { crawl } = require('../src/crawl');

/* Playwright is the renderer, and it is the caller's to install: this package
   does not carry a browser of its own. */
function playwright(){
  const tried = [];
  for (const name of ['playwright', 'playwright-core']){
    try { return require(name); } catch (e) { tried.push(name); }
  }
  if (process.env.PLAYWRIGHT_PATH){
    try { return require(process.env.PLAYWRIGHT_PATH); } catch (e) { tried.push(process.env.PLAYWRIGHT_PATH); }
  }
  console.error('This needs Playwright to render the pages. Install it with:\n  npm i playwright\n' +
                'or point PLAYWRIGHT_PATH at an installed copy. Tried: ' + tried.join(', '));
  process.exit(1);
}

function args(argv){
  const out = { url: '', as: '', pages: 8, out: '', browser: process.env.CHROMIUM_PATH || '' };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (a === '--as')            out.as = argv[++i];
    else if (a === '--pages')    out.pages = parseInt(argv[++i], 10) || 8;
    else if (a === '--out')      out.out = argv[++i];
    else if (a === '--browser')  out.browser = argv[++i];
    else if (!a.startsWith('-') && !out.url) out.url = a;
  }
  return out;
}

(async () => {
  const opt = args(process.argv.slice(2));
  if (!opt.url){
    console.error('Usage: import.js <url> [--as <url>] [--pages n] [--out file.json]');
    process.exit(1);
  }
  const url = /^[a-z]+:\/\//i.test(opt.url) ? opt.url : 'https://' + opt.url;
  const { chromium } = playwright();
  const browser = await chromium.launch(opt.browser ? { executablePath: opt.browser } : {});
  try {
    const out = await crawl(browser, url, { maxPages: opt.pages, as: opt.as });
    const { site, design, report, summary, status, library, assets } = out;
    const json = JSON.stringify({ site, design, report, summary, status, library, assets,
                                  source: out.source }, null, 2);
    if (opt.out) fs.writeFileSync(path.resolve(opt.out), json);
    else process.stdout.write(json + '\n');

    /* The report goes to stderr so it can be read while the model goes to a file
       or down a pipe. It is the same list the review screen shows. */
    const say = m => console.error(m);
    say(`${summary.pages} pages, ${summary.components} components, ${summary.photos} pictures, ` +
        `${summary.words} words. Status: ${status}.`);
    say(library.map(l => `  ${String(l.count).padStart(3)} × ${l.label}`).join('\n'));
    if (report.entries.length){
      say(`\n${report.counts.total} exception${report.counts.total === 1 ? '' : 's'}: ` +
          `${report.counts.critical} critical, ${report.counts.warning} warning, ${report.counts.note} note.`);
      for (const e of report.entries)
        say(`  [${e.severity}] ${e.label} — ${e.page}${e.detail ? ' — ' + String(e.detail).slice(0, 70) : ''}`);
    }
    say('\nAcceptance:');
    for (const c of report.acceptance)
      say(`  ${c.pass ? 'pass' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
    say(report.approvable
      ? '\nNo critical exceptions. An administrator can review and approve this site.'
      : `\n${report.counts.critical} critical exception(s) must be resolved before this site can be approved.`);
    if (opt.out) say(`\nWritten to ${opt.out}`);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
