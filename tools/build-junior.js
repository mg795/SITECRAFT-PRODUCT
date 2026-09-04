#!/usr/bin/env node
/*
 * Sitecraft Junior is not a second codebase. It is app/sitecraft.html with one
 * line changed, so a fix made once is a fix made twice. Run this after any
 * change to the senior file:
 *
 *   node tools/build-junior.js
 *
 * Everything gated on PRO disappears: the analysis, the scores, the prices, the
 * boost flow, the billing cycle. What is left is the editor, comments and review.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src  = path.join(root, 'app', 'sitecraft.html');
const out  = path.join(root, 'app', 'sitecraft-junior.html');

const swaps = [
  ["const TIER = 'senior';", "const TIER = 'junior';"],
  ['<title>Sitecraft Editor</title>', '<title>Sitecraft Junior</title>'],
  ['<span class="sc-name">Sitecraft Editor</span>', '<span class="sc-name">Sitecraft Junior</span>'],
];

let html = fs.readFileSync(src, 'utf8');
const missing = [];

for (const [from, to] of swaps) {
  if (!html.includes(from)) { missing.push(from); continue; }
  if (html.split(from).length - 1 !== 1) { missing.push(from + '  (not unique)'); continue; }
  html = html.replace(from, to);
}

if (missing.length) {
  console.error('build-junior: the senior file has moved under this script.');
  missing.forEach(m => console.error('  could not swap exactly once: ' + m));
  process.exit(1);
}

fs.writeFileSync(out, html);

const kb = n => Math.round(n / 1024) + 'KB';
console.log('built app/sitecraft-junior.html  ' + kb(html.length) + '  from sitecraft.html ' + kb(fs.statSync(src).size));
