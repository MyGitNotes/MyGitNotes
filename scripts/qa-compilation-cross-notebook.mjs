import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collectPageErrors, createQaWorkspace, launchQaBrowser, product, qaRequire, startQaServer } from './lib/qa-harness.mjs';

// A Book in one notebook built from notes of other notebooks of the same repository, against the built app and a disposable
// local workspace: the add-item dialog's notebook selector pins by repository path, the book reads and edits each chapter as
// its own notebook's note, a rename in another notebook follows into the compilation, studying reviews another notebook's
// note, and the graph arrangement counts what it does not draw. Screenshots go to QA_SHOTS (default artifacts/qa/cross-notebook).
const require = qaRequire();
const { SUPPORTED_SCHEMA_VERSION, WORKSPACE_CONFIG_FILENAME } = await import(`${product}/packages/core/dist/index.js`);
const { root, write, git, commitFixture } = createQaWorkspace('mygitnotes-cross-notebook-qa-');
write(WORKSPACE_CONFIG_FILENAME, `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: Cross-notebook QA\n  default_notebook: company\nnotebooks:\n  - id: company\n    title: Company\n    root: notes/company\n  - id: manual\n    title: Operations manual\n    root: notes/manual\n  - id: training\n    title: Training\n    root: notes/training\n`);
write('notes/company/intro.md', '---\ntitle: Introduction\n---\nThe company introduction opens the book.\n');
write('notes/manual/setup.md', '---\ntitle: Setup\n---\nSet the machine up before the first shift.\n');
write('notes/training/drill.md', '---\ntitle: Drill\nstatus: new\n---\nWhat comes first?\n\n---\n\nThe safety check.\n');
const BOOK = 'notes/company/handbook.compilation.yml';
const stages = 'progression:\n  stages:\n    - { status: new, intervalDays: 1 }\n    - { status: learning, intervalDays: 3 }\n    - { status: known, intervalDays: 7 }\n  easy: two\n';
write(BOOK, `version: 1\nid: handbook\ntitle: Handbook\narrangement: book\nitems:\n  - { id: intro, kind: note, path: notes/company/intro.md }\n${stages}`);
commitFixture('Cross-notebook QA');

const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const shots = process.env.QA_SHOTS || path.join(product, 'artifacts/qa/cross-notebook');
fs.mkdirSync(shots, { recursive: true });
const page = await browser.newPage();
const errors = collectPageErrors(page);
await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', localStorage.getItem('qa-language') || 'en'));

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const waitFile = async (file, text) => {
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(path.join(root, file)) && read(file).includes(text)) return;
    await pause(100);
  }
  throw new Error(`${file} never held: ${text}`);
};
const theme = async mode => {
  if (!page.url().startsWith(base)) await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(mode => localStorage.setItem('github_notes_theme_mode', mode), mode);
};
const shot = name => page.screenshot({ path: path.join(shots, `${name}.png`) });
const openBook = async () => {
  await page.goto(`${base}/notebooks/company/notes/handbook.compilation.yml`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.compilation-view', { timeout: 20000 });
};
const contents = () => page.$$eval('.compilation-book-layout > .compilation-book-contents button', buttons => buttons.map(button => button.textContent.trim()));
/** Picks `label` in the Radix select inside the dialog's label `name`. */
const choose = async (name, label) => {
  await page.evaluate(name => [...document.querySelectorAll('dialog[open] label')].find(element => element.firstChild?.textContent?.trim() === name).querySelector('button').click(), name);
  await page.waitForSelector('[role="option"]');
  await page.evaluate(label => [...document.querySelectorAll('[role="option"]')].find(option => option.textContent.trim() === label).click(), label);
  await page.waitForFunction(() => !document.querySelector('[role="option"]'));
};
const addFrom = async (notebook, file) => {
  await page.click('button[aria-label="Add item: Handbook"]');
  await page.waitForSelector('.screen-item-options');
  await choose('Notebook', notebook);
  await page.waitForFunction(file => [...document.querySelectorAll('.screen-item-option small')].some(small => small.textContent === file), { timeout: 10000 }, file);
  await page.evaluate(file => [...document.querySelectorAll('.screen-item-option')].find(button => button.querySelector('small').textContent === file).click(), file);
  await waitFile(BOOK, `path: ${file}`);
};

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await theme('light');
  await openBook();

  // AC8: the selector lists this repository's notebooks, the compilation's own first, and pins by repository path.
  await page.click('button[aria-label="Add item: Handbook"]');
  await page.waitForSelector('.screen-item-options');
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] label')].find(element => element.firstChild?.textContent?.trim() === 'Notebook').querySelector('button').click());
  await page.waitForSelector('[role="option"]');
  assert.deepEqual(await page.$$eval('[role="option"]', options => options.map(option => option.textContent.trim())), ['Company', 'Operations manual', 'Training']);
  await shot('add-item-notebooks-1440-light');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.screen-item-options'));
  await addFrom('Operations manual', 'notes/manual/setup.md');
  await addFrom('Training', 'notes/training/drill.md');
  assert.ok(!read(BOOK).includes('notebook'), 'The compilation file names a notebook');
  console.log('PASS the add-item dialog offers the repository notebooks and pins notes of two other notebooks by repository path');

  // AC1, AC2: the book reads every chapter from its own notebook.
  await openBook();
  await page.waitForFunction(() => document.querySelectorAll('.compilation-book [data-book-anchor]').length >= 3, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.compilation-book')?.textContent.includes('The safety check.'), { timeout: 20000 });
  assert.deepEqual(await contents(), ['Introduction', 'Setup', 'Drill']);
  assert.ok(!(await page.$eval('.compilation-book', book => book.textContent)).includes('may have moved or been deleted'), 'A chapter from another notebook reads as missing');
  await shot('book-reading-1440-light');
  console.log('PASS the book reads chapters from three notebooks, with all of them in the contents');

  // AC6: editing the Setup chapter saves notes/manual/setup.md.
  await page.$eval('button[aria-label="Edit Setup"]', button => button.click());
  await page.waitForSelector('[data-editing] .cm-content');
  await page.click('[data-editing] .cm-content');
  await page.keyboard.press('End');
  await page.keyboard.type(' CROSS-NOTEBOOK-EDIT');
  await pause(300);
  await shot('book-editing-1440-light');
  await page.$eval('button[aria-label="Finish editing Setup"]', button => button.click());
  await waitFile('notes/manual/setup.md', 'CROSS-NOTEBOOK-EDIT');
  assert.ok(!read('notes/company/intro.md').includes('CROSS-NOTEBOOK-EDIT'), 'The edit reached the wrong notebook');
  console.log("PASS an inline edit of another notebook's chapter saves to that notebook's file");

  // Dark theme and the phone width.
  await theme('dark');
  await openBook();
  await page.waitForFunction(() => document.querySelector('.compilation-book')?.textContent.includes('The safety check.'), { timeout: 20000 });
  await shot('book-reading-1440-dark');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await openBook();
  await page.waitForFunction(() => document.querySelector('.compilation-book')?.textContent.includes('The safety check.'), { timeout: 20000 });
  await shot('book-reading-390-dark');
  await theme('light');
  await openBook();
  await page.waitForFunction(() => document.querySelector('.compilation-book')?.textContent.includes('The safety check.'), { timeout: 20000 });
  await shot('book-reading-390-light');
  await page.click('button[aria-label="Add item: Handbook"]');
  await page.waitForSelector('.screen-item-options');
  await shot('add-item-390-light');
  await page.keyboard.press('Escape');
  console.log('PASS the book and the dialog render at 390 and 1440, light and dark');

  // AC5: renaming the Setup note in its notebook rewrites the compilation of another notebook.
  await page.setViewport({ width: 1440, height: 1000 });
  const keys = await page.evaluate(async () => {
    const workspace = await (await fetch('/api/workspace')).json();
    const notebooks = workspace.keyedConfig?.notebooks ?? [];
    return Object.fromEntries(notebooks.map(notebook => [notebook.root, notebook.id]));
  });
  const moved = await page.evaluate(async notebookId => (r => r.status === 200 ? 200 : r.text().then(text => `${notebookId} ${r.status} ${text}`))(await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: { kind: 'move', notebookId, path: 'notes/manual/setup.md', destination: 'notes/manual/first-shift.md' } }) })), keys['notes/manual']);
  assert.equal(moved, 200, 'The rename was refused');
  await waitFile(BOOK, 'path: notes/manual/first-shift.md');
  assert.ok(!read(BOOK).includes('notes/manual/setup.md'), 'The compilation still names the old path');
  console.log("PASS a rename in another notebook rewrites the compilation's item");

  // AC7: studying the book reviews the Training note and writes its status and the study file.
  git('add', '-A');
  git('commit', '-qm', 'Edits before study');
  await openBook();
  await page.$eval('button[aria-label="Start studying: Handbook"]', button => button.click());
  await page.waitForSelector('.study-footer', { timeout: 20000 });
  for (let i = 0; i < 6 && !(await page.$eval('body', body => body.textContent.includes('What comes first?'))); i++) {
    await page.$eval('button[aria-label="Next card"]', button => button.click()).catch(() => {});
    await pause(300);
  }
  await page.waitForFunction(() => document.body.textContent.includes('What comes first?'));
  await page.$eval('.study-reveal', button => button.click());
  await page.waitForSelector('.study-ratings-region.is-revealed button[data-rating="3"]:not([disabled])');
  await shot('study-1440-light');
  await page.$eval('button[data-rating="3"]', button => button.click());
  await waitFile('notes/training/drill.md', 'status: learning');
  await waitFile('.github-notes-study.yaml', 'notes/training/drill.md');
  console.log("PASS studying the book reviews another notebook's note and writes its status and the study file");

  // AC11: the graph arrangement draws the compilation's own notebook and counts the rest without writing the file.
  write(BOOK, read(BOOK).replace('arrangement: book', 'arrangement: graph'));
  git('add', '-A');
  git('commit', '-qm', 'Graph arrangement');
  const before = read(BOOK);
  await openBook();
  await page.waitForSelector('.graph-notice-outside', { timeout: 20000 });
  assert.equal(await page.$eval('.graph-notice-outside', notice => notice.textContent.trim()), '2 items in other notebooks are not shown in the graph');
  await pause(1500);
  await shot('graph-notice-1440-light');
  await theme('dark');
  await openBook();
  await page.waitForSelector('.graph-notice-outside', { timeout: 20000 });
  await pause(1000);
  await shot('graph-notice-1440-dark');
  await page.evaluate(() => localStorage.setItem('qa-language', 'zh-TW'));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await openBook();
  await page.waitForSelector('.graph-notice-outside', { timeout: 20000 });
  assert.equal(await page.$eval('.graph-notice-outside', notice => notice.textContent.trim()), '另有 2 個項目在其他筆記本，關聯圖不顯示');
  await pause(1000);
  await shot('graph-notice-390-dark-zh-TW');
  assert.equal(read(BOOK), before, 'Opening the graph arrangement wrote the compilation');
  console.log('PASS the graph arrangement shows a notice counting the items of other notebooks, in English and Traditional Chinese, and leaves the file alone');

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
