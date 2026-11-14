import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SUPPORTED_SCHEMA_VERSION } from '../packages/core/dist/config.js';
import { collectPageErrors, createQaWorkspace, launchQaBrowser, product, qaRequire, startQaServer } from './lib/qa-harness.mjs';

// Turn into QR code in the live editor: a selected address (shortcut), a whole-line address (command palette) and a Markdown link (toolbar button); the codes the live editor and the compilation card's preview draw.
const require = qaRequire();
const { root, write, commitFixture } = createQaWorkspace('github-notes-qrcode-editor-qa-');
write('.github-notes.yaml', `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: QR editor QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n`);
write('notes/example/talk.md', `---\ntitle: Talk\n---\n\nScan https://example.com/talk?x=1 to open the talk.\n\nhttps://example.com/whole-line\n\nSee [the slides](https://example.com/slides) first.\n\nend\n`);
write('notes/example/talkview.compilation.yml', 'version: 1\nid: talkview\ntitle: Talk view\narrangement: lane\nsize: medium\nitems:\n  - id: pin-talk\n    kind: note\n    path: notes/example/talk.md\n');
commitFixture();

const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const shots = process.env.QA_SHOTS || path.join(product, 'artifacts/qa/qrcode-editor');
fs.mkdirSync(shots, { recursive: true });
const page = await browser.newPage();
const errors = collectPageErrors(page);
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
const shot = name => page.screenshot({ path: path.join(shots, `${name}.png`) });
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const lines = () => page.$$eval('.cm-content .cm-line, .cm-content .live-md-qrcode', nodes => nodes.map(node => node.className.includes('live-md-qrcode') ? `[qr ${node.querySelector('canvas')?.width ?? '-'}]` : node.textContent));
/** Selects the first occurrence of `text` in the live editor with the DOM selection, as dragging over it would. */
const select = text => page.evaluate(text => {
  // Focusing redraws the editor's lines, so the text is looked up after.
  document.querySelector('.cm-content').focus();
  const walker = document.createTreeWalker(document.querySelector('.cm-content'), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent.indexOf(text);
    if (at < 0) continue;
    getSelection().setBaseAndExtent(node, at, node, at + text.length);
    return true;
  }
  return false;
}, text);
const caretIn = text => page.evaluate(text => {
  document.querySelector('.cm-content').focus();
  const walker = document.createTreeWalker(document.querySelector('.cm-content'), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent.indexOf(text);
    if (at < 0) continue;
    getSelection().setBaseAndExtent(node, at + 3, node, at + 3);
    return true;
  }
  return false;
}, text);
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
const press = async (...keys) => {
  for (const key of keys.slice(0, -1)) await page.keyboard.down(key);
  await page.keyboard.press(keys.at(-1));
  for (const key of keys.slice(0, -1).reverse()) await page.keyboard.up(key);
};

try {
  await page.goto(`${base}/notebooks/example/notes/talk.md`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cm-content .cm-line', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Scan https://example.com/talk'));
  await shot('0-before');

  // 1. A selected address, by the shortcut: an inline code, right beside the caret.
  assert.ok(await select('https://example.com/talk?x=1'));
  await settle(200);
  await press(mod, 'Shift', 'KeyL');
  await page.waitForSelector('.live-md-qrcode-inline canvas', { timeout: 10000 });
  const inline = await page.$eval('.live-md-qrcode-inline', element => ({ width: element.querySelector('canvas').width, href: element.querySelector('a')?.getAttribute('href'), height: element.getBoundingClientRect().height }));
  assert.equal(inline.href, 'https://example.com/talk?x=1');
  assert.ok(inline.width >= 128 && inline.height > 100, `the inline code is drawn: ${JSON.stringify(inline)}`);
  await shot('1-selection-inline');

  // 2. A whole line that is an address, by the command palette: a ::qrcode line, drawn once the caret is elsewhere.
  assert.ok(await select('https://example.com/whole-line'));
  await settle(200);
  await press(mod, 'Shift', 'KeyP');
  await page.waitForSelector('.keyboard-shortcuts-panel input');
  await page.type('.keyboard-shortcuts-panel input', 'qr code');
  await page.waitForSelector('[data-command-id="format.qrcode"]');
  await shot('2-palette');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-line')].some(line => line.textContent.includes('::qrcode{url="https://example.com/whole-line"}')), { timeout: 10000 });
  await shot('2-block-source');
  assert.ok(await caretIn('Scan'), 'moves the caret away');
  await page.waitForSelector('.live-md-qrcode.live-md-directive canvas', { timeout: 10000 });
  const block = await page.$eval('.live-md-qrcode.live-md-directive', element => ({ width: element.querySelector('canvas').width, href: element.querySelector('a')?.getAttribute('href') }));
  assert.deepEqual(block, { width: 128, href: 'https://example.com/whole-line' });
  await shot('2-block-drawn');

  // 3. The caret in a Markdown link, by the toolbar button: the link stays and the code stands under its line.
  assert.ok(await caretIn('the slides'));
  await settle(200);
  await page.click('button[aria-label="Formatting toolbar"]');
  await page.waitForSelector('button[aria-label^="Turn into QR code"]');
  assert.ok(await caretIn('the slides'));
  await page.click('button[aria-label^="Turn into QR code"]');
  await page.waitForFunction(() => document.querySelectorAll('.live-md-qrcode canvas').length === 3 || [...document.querySelectorAll('.cm-line')].some(line => line.textContent.includes('::qrcode{url="https://example.com/slides"}')), { timeout: 10000 });
  assert.ok(await caretIn('Scan'), 'moves the caret away');
  await page.waitForFunction(() => document.querySelectorAll('.live-md-qrcode canvas').length === 3, { timeout: 10000 });
  await shot('3-link-block');
  const text = (await lines()).join('\n');
  assert.ok(text.includes('See [the slides]') || text.includes('the slides'), 'the link stays');
  console.log(text);

  // 4. The preview of the same note (a compilation card) draws the same codes.
  await settle(1500);
  await page.goto(`${base}/notebooks/example/notes/talkview.compilation.yml`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.screen-card [data-markdown-view]', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.screen-card .qrcode-container[data-qrcode-rendered] canvas').length === 3, { timeout: 20000 });
  await shot('4-preview');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('PASS Turn into QR code');
} finally {
  await browser.close();
  server.close();
}
