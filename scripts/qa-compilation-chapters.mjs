import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collectPageErrors, createQaWorkspace, launchQaBrowser, product, qaRequire, startQaServer } from './lib/qa-harness.mjs';

// Compilation chapters against the built app and a disposable local workspace: a Book with chapter headings (contents
// levels, scroll highlight, one page per chapter, a contents jump into a chapter), Arrange contents (add, fill and rename a
// chapter, saved as one flat list), Add item into a chapter with a heading of a note (its section only, Edit opening zoom
// at the heading, a renamed heading turning missing with Open the note), a note rename under a heading, lane dividers at
// 1440 and 390, and a dynamic compilation grouped by folder (continuous, paged, loading more without reordering chapters).
// Screenshots go to QA_SHOTS (default /tmp/compilation-chapters).
const require = qaRequire();
const YAML = require('yaml');
const { SUPPORTED_SCHEMA_VERSION, WORKSPACE_CONFIG_FILENAME } = await import(`${product}/packages/core/dist/index.js`);
const { root, write, git, commitFixture } = createQaWorkspace('mygitnotes-chapters-qa-');
write(WORKSPACE_CONFIG_FILENAME, `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: Chapters QA\n  default_notebook: company\nnotebooks:\n  - id: company\n    title: Company\n    root: notes/company\n  - id: manual\n    title: Field manual\n    root: notes/manual\n`);
const note = (file, title, body) => write(file, `---\ntitle: ${title}\n---\n${body}\n`);
// Long enough that the book scrolls past each chapter, so the scroll highlight can be read.
const filler = Array.from({ length: 8 }, (_, n) => `Paragraph ${n + 1} of the minutes, with enough words to fill a line of the book.`).join('\n\n');
note('notes/company/readme.md', 'About meetings', `How the team meets.\n\n${filler}`);
note('notes/company/meetings/weekly-1.md', 'Weekly one', `The first weekly meeting.\n\n${filler}`);
note('notes/company/meetings/weekly-2.md', 'Weekly two', `The second weekly meeting.\n\n${filler}`);
note('notes/company/meetings/planning.md', 'Planning day', `The yearly planning day.\n\n${filler}`);
note('notes/manual/visits/visit.md', 'Client visit', `A visit to a client site.\n\n${filler}`);
note('notes/company/log.md', 'Meeting log', '# Log\n\nIntro to the log.\n\n## 2025-08-26 週會\n\nAugust meeting notes.\n\n### Action items\n\n- ship the release\n\n## 2025-09-02 週會\n\nSeptember meeting notes.');
const BOOK = 'notes/company/meeting-notes.compilation.yml';
write(BOOK, 'version: 1\nid: meeting-notes\ntitle: Meeting notes\narrangement: book\nitems:\n  - { id: intro, kind: note, path: notes/company/readme.md }\n  - { id: internal, kind: heading, title: Internal meetings }\n  - { id: m1, kind: note, path: notes/company/meetings/weekly-1.md }\n  - { id: m2, kind: note, path: notes/company/meetings/weekly-2.md }\n  - { id: external, kind: heading, title: External meetings }\n  - { id: m3, kind: note, path: notes/manual/visits/visit.md }\n  - { id: m4, kind: folder, path: notes/manual/visits }\n  - { id: product, kind: heading, title: Product meetings }\n  - { id: m5, kind: note, path: notes/company/meetings/planning.md }\n');
// A dynamic book of 61 notes, more than one page of 50, grouped by folder: the folder's own note, then Zeta and Alpha as the sidebar orders them.
write('notes/company/minutes/_dir.yml', 'title: Minutes\n');
write('notes/company/minutes/zeta/_dir.yml', 'title: Zeta team\norder: 1\n');
write('notes/company/minutes/alpha/_dir.yml', 'title: Alpha team\norder: 2\n');
note('notes/company/minutes/index.md', 'Minutes index', 'Where the minutes live.');
for (let n = 1; n <= 30; n++) {
  const number = String(n).padStart(2, '0');
  note(`notes/company/minutes/zeta/z-${number}.md`, `Zeta ${number}`, `Zeta minutes ${number}.`);
  note(`notes/company/minutes/alpha/a-${number}.md`, `Alpha ${number}`, `Alpha minutes ${number}.`);
}
const MINUTES = 'notes/company/minutes.compilation.yml';
write(MINUTES, 'version: 1\nid: minutes-by-folder\ntitle: Minutes by team\narrangement: book\nsource: { kind: folder, path: notes/company/minutes }\nsort: { field: title, order: asc }\ngroup: folder\n');
commitFixture('Chapters QA');

const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const shots = process.env.QA_SHOTS || '/tmp/compilation-chapters';
fs.mkdirSync(shots, { recursive: true });
const page = await browser.newPage();
const errors = collectPageErrors(page);
await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', localStorage.getItem('qa-language') || 'en'));

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const waitFile = async (file, test, label) => {
  for (let i = 0; i < 150; i++) {
    if (fs.existsSync(path.join(root, file)) && test(read(file))) return;
    await pause(100);
  }
  throw new Error(`${file} never ${label}:\n${read(file)}`);
};
const items = () => YAML.parse(read(BOOK)).items.map(item => item.kind === 'heading' ? `# ${item.title}` : item.anchor ? `${item.path} #${item.anchor}` : item.path);
const theme = async mode => {
  if (!page.url().startsWith(base)) await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(mode => localStorage.setItem('github_notes_theme_mode', mode), mode);
};
const commitAll = async message => {
  for (let attempt = 0;; attempt++) {
    try {
      git('add', '-A');
      git('commit', '-qm', message);
      return;
    } catch (error) {
      if (attempt >= 50 || !String(error.stderr).includes('index.lock')) throw error;
      await pause(100);
    }
  }
};
const shot = name => page.screenshot({ path: path.join(shots, `${name}.png`) });
const open = async file => {
  await page.goto(`${base}/notebooks/company/notes/${file.slice('notes/company/'.length)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.compilation-view', { timeout: 20000 });
};
const bodyHas = text => page.waitForFunction(text => document.querySelector('.compilation-book')?.textContent.includes(text), { timeout: 20000 }, text);
/** The contents list as [title, level] pairs. */
const contents = () => page.$$eval('.compilation-book-layout > .compilation-book-contents li', entries => entries.map(entry => [entry.textContent.trim(), Number(entry.dataset.level)]));
const current = () => page.$$eval('.compilation-book-layout > .compilation-book-contents [aria-current="location"]', entries => entries.map(entry => entry.textContent.trim()));
const clickContents = title => page.evaluate(title => [...document.querySelectorAll('.compilation-book-layout > .compilation-book-contents button')].find(button => button.textContent.trim() === title).click(), title);
const pageCount = () => page.$eval('.compilation-book-page-count', count => count.textContent.trim());
const pageTitle = () => page.$eval('.compilation-book > .compilation-book-section .compilation-book-heading', heading => heading.textContent.trim());
const mode = name => page.evaluate(name => [...document.querySelectorAll('[role="group"] button')].find(button => button.textContent.trim() === name).click(), name);
/** Picks `label` in the Radix select inside the open dialog's label `name`. */
const choose = async (name, label) => {
  await page.evaluate(name => [...document.querySelectorAll('dialog[open] label')].find(element => element.firstChild?.textContent?.trim() === name).querySelector('button').click(), name);
  await page.waitForSelector('[role="option"]');
  await page.evaluate(label => [...document.querySelectorAll('[role="option"]')].find(option => option.textContent.trim() === label).click(), label);
  await page.waitForFunction(() => !document.querySelector('[role="option"]'));
};
const button = label => page.$eval(`button[aria-label="${label}"]`, element => element.click());
const keyMove = async (label, key, presses = 1) => {
  await page.$eval(`button[aria-label="${label}"]`, element => element.focus());
  await page.keyboard.press('Space');
  await pause(150);
  for (let n = 0; n < presses; n++) {
    await page.keyboard.press(key);
    await pause(200);
  }
  await page.keyboard.press('Space');
  await pause(300);
};

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await theme('light');
  await open(BOOK);

  // AC3: chapter headings at level 0, their items at 1, a folder's notes under a heading at 2; the highlight follows scrolling.
  await bodyHas('A visit to a client site.');
  await page.waitForFunction(() => document.querySelectorAll('.compilation-book-layout > .compilation-book-contents li[data-level="2"]').length > 0, { timeout: 20000 });
  assert.deepEqual(await contents(), [['About meetings', 0], ['Internal meetings', 0], ['Weekly one', 1], ['Weekly two', 1], ['External meetings', 0], ['Client visit', 1], ['visits', 1], ['Client visit', 2], ['Product meetings', 0], ['Planning day', 1]]);
  assert.deepEqual(await page.$$eval('.compilation-book > .compilation-book-section > .compilation-book-heading-row h2', headings => headings.map(heading => heading.textContent.trim())), ['About meetings', 'Internal meetings', 'External meetings', 'Product meetings']);
  assert.ok((await page.$$eval('.compilation-book-chapter-items h3', headings => headings.map(heading => heading.textContent.trim()))).includes('Weekly two'));
  assert.ok((await page.$$eval('.compilation-book-chapter-items h4', headings => headings.map(heading => heading.textContent.trim()))).includes('Client visit'));
  await shot('book-continuous-1440-light');
  await page.$eval('.compilation-book', body => {
    const heading = [...body.querySelectorAll('[data-book-anchor]')].find(element => element.textContent.trim() === 'External meetings');
    body.scrollTop += heading.getBoundingClientRect().top - body.getBoundingClientRect().top;
  });
  // The highlight names the last heading past the top quarter of the body: the chapter heading or its first item just below.
  await page.waitForFunction(() => ['External meetings', 'Client visit'].includes(document.querySelector('.compilation-book-layout > .compilation-book-contents [aria-current="location"]')?.textContent.trim()), { timeout: 5000 });
  console.log('PASS the Book shows chapter headings over their items, contents in levels 0 to 2, and the highlight follows scrolling');

  // AC4: one page per chapter; a contents click on an item inside a chapter turns to its page.
  await mode('Paged');
  await page.waitForSelector('.compilation-book-page-count');
  await clickContents('About meetings');
  await page.waitForFunction(() => document.querySelector('.compilation-book-page-count')?.textContent.trim().startsWith('1 /'));
  assert.equal(await pageCount(), '1 / 4');
  await clickContents('Weekly two');
  await page.waitForFunction(() => document.querySelector('.compilation-book-page-count')?.textContent.trim() === '2 / 4');
  assert.equal(await pageTitle(), 'Internal meetings');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), 'Weekly two');
  assert.deepEqual(await current(), ['Internal meetings']);
  await shot('book-paged-1440-light');
  await mode('Continuous');
  console.log('PASS paged reading turns one chapter per page and a contents click reveals an item inside a chapter');

  // AC6: Arrange contents adds a chapter after the focused row, takes an item into it by keyboard, renames a heading, saves one flat list.
  await button('Arrange contents: Meeting notes');
  await page.waitForSelector('dialog[open] .compilation-order-list');
  await page.$eval('button[aria-label="Move item: Weekly one"]', element => element.focus());
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find(element => element.textContent.trim() === 'Add chapter').click());
  await page.waitForFunction(() => document.activeElement?.matches('input[aria-label="Chapter title"]') && !document.activeElement.value);
  await page.keyboard.type('Follow-ups');
  await keyMove('Move item: Client visit', 'ArrowUp');
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('dialog[open] input[aria-label="Chapter title"]')].find(element => element.value === 'Internal meetings');
    input.focus();
    input.select();
  });
  await page.keyboard.type('Internal');
  await shot('arrange-contents-1440-light');
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find(element => element.textContent.trim() === 'Save').click());
  await waitFile(BOOK, text => text.includes('title: Follow-ups') && text.includes('title: Internal\n'), 'held the arranged chapters');
  assert.deepEqual(items(), ['notes/company/readme.md', '# Internal', 'notes/company/meetings/weekly-1.md', '# Follow-ups', 'notes/company/meetings/weekly-2.md', 'notes/manual/visits/visit.md', '# External meetings', 'notes/manual/visits', '# Product meetings', 'notes/company/meetings/planning.md']);
  console.log('PASS Arrange contents adds, fills and renames a chapter, and the file holds the flat order');

  // AC7, AC21: Add item into a chapter, pinning one heading of a note.
  await bodyHas('Follow-ups');
  await button('Add item: Meeting notes');
  await page.waitForSelector('.screen-item-options');
  await choose('Chapter', 'Internal');
  await page.type('dialog[open] input[type="search"]', 'Meeting log');
  await page.waitForFunction(() => [...document.querySelectorAll('.screen-item-option small')].some(small => small.textContent === 'notes/company/log.md'), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('.screen-item-option')].find(option => option.querySelector('small').textContent === 'notes/company/log.md').click());
  await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] label')].some(label => label.firstChild?.textContent?.trim() === 'Heading in the note'), { timeout: 10000 });
  await choose('Heading in the note', '2025-08-26 週會');
  await shot('add-item-heading-1440-light');
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find(element => element.textContent.trim() === 'Pin').click());
  await waitFile(BOOK, text => text.includes('anchor: 2025-08-26 週會'), 'held the anchored item');
  assert.deepEqual(items().slice(1, 5), ['# Internal', 'notes/company/meetings/weekly-1.md', 'notes/company/log.md #2025-08-26 週會', '# Follow-ups']);
  console.log('PASS Add item places a heading of a note last in the chosen chapter');

  // AC19: the Book reads only that heading's section, titled with the heading.
  await open(BOOK);
  await bodyHas('August meeting notes.');
  const section = await page.$$eval('.compilation-book-section[data-anchored]', sections => sections.map(element => ({ title: element.querySelector('.compilation-book-heading').textContent.trim(), text: element.querySelector('.compilation-book-content').textContent })));
  assert.equal(section.length, 1);
  assert.equal(section[0].title, '2025-08-26 週會');
  assert.ok(section[0].text.includes('Action items') && !section[0].text.includes('September') && !section[0].text.includes('Intro to the log'), section[0].text);
  await page.$eval('.compilation-book-section[data-anchored]', element => element.scrollIntoView());
  await shot('book-anchored-section-1440-light');
  console.log("PASS the Book shows only the pinned heading's section");

  // AC20: Edit opens the whole note in zoom at the heading; renaming the heading there turns the item missing, with Open the note.
  await button('Edit 2025-08-26 週會');
  await page.waitForFunction(() => decodeURIComponent(location.hash) === '#2025-08-26 週會' && location.pathname.endsWith('/log.md'), { timeout: 20000 });
  await page.waitForSelector('.cm-content', { timeout: 20000 });
  await page.waitForFunction(() => {
    const line = [...document.querySelectorAll('.cm-line')].find(element => element.textContent.includes('2025-08-26 週會'));
    const box = line?.getBoundingClientRect();
    return box && box.top >= 0 && box.top < innerHeight / 2;
  }, { timeout: 10000 });
  await shot('zoom-at-heading-1440-light');
  const lineBox = await page.evaluate(() => {
    const box = [...document.querySelectorAll('.cm-line')].find(element => element.textContent.includes('2025-08-26 週會')).getBoundingClientRect();
    return { x: box.right - 4, y: box.top + box.height / 2 };
  });
  await page.mouse.click(lineBox.x, lineBox.y);
  await page.keyboard.press('End');
  await page.keyboard.type(' renamed');
  await waitFile('notes/company/log.md', text => text.includes('## 2025-08-26 週會 renamed'), 'held the renamed heading');
  await commitAll('Heading renamed');
  await open(BOOK);
  await page.waitForFunction(() => document.querySelector('.compilation-book-section[data-anchored]')?.textContent.includes('This heading is no longer in the note.'), { timeout: 20000 });
  assert.equal(await page.$eval('.compilation-book-section[data-anchored] .compilation-book-heading', heading => heading.textContent.trim()), '2025-08-26 週會');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.compilation-book-layout > .compilation-book-contents li')].some(entry => entry.textContent.trim() === '2025-08-26 週會' && Boolean(entry.querySelector('[aria-label="This item may have moved or been deleted."]')))), 'The contents entry is not marked missing');
  await page.$eval('.compilation-book-section[data-anchored]', element => element.scrollIntoView());
  await shot('book-anchor-missing-1440-light');
  await page.evaluate(() => [...document.querySelectorAll('.compilation-book-section[data-anchored] button')].find(element => element.textContent.trim() === 'Open the note').click());
  await page.waitForFunction(() => location.pathname.endsWith('/log.md') && !location.hash, { timeout: 20000 });
  assert.equal(read(BOOK).includes('anchor: 2025-08-26 週會'), true, 'The anchor was rewritten');
  console.log('PASS Edit opens zoom at the heading; a renamed heading shows the missing notice and Open the note opens the whole note');

  // AC8: renaming a note under a heading rewrites its path and keeps the headings.
  const headingsBefore = read(BOOK).split('\n').filter(line => line.includes('kind: heading'));
  const keys = await page.evaluate(async () => Object.fromEntries(((await (await fetch('/api/workspace')).json()).keyedConfig?.notebooks ?? []).map(notebook => [notebook.root, notebook.id])));
  const moved = await page.evaluate(async notebookId => (await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: { kind: 'move', notebookId, path: 'notes/company/meetings/weekly-2.md', destination: 'notes/company/meetings/weekly-second.md' } }) })).status, keys['notes/company']);
  assert.equal(moved, 200, 'The rename was refused');
  await waitFile(BOOK, text => text.includes('path: notes/company/meetings/weekly-second.md'), 'held the renamed path');
  assert.deepEqual(read(BOOK).split('\n').filter(line => line.includes('kind: heading')), headingsBefore);
  console.log('PASS a note rename under a heading rewrites its path and keeps every heading line');

  // AC5: lane dividers in the strip at 1440 and header rows at 390. The notes opened above stay in the Focus beside the
  // compilation, so this device's view state is reset for the compilation to take the whole width again.
  await commitAll('Before lanes');
  await page.evaluate(() => localStorage.clear());
  await theme('light');
  await open(BOOK);
  await bodyHas('A visit to a client site.');
  await button('Small');
  await page.waitForSelector('.screen-chapter-divider', { timeout: 20000 });
  assert.deepEqual(await page.$$eval('.screen-chapter-divider', dividers => dividers.map(divider => divider.textContent.trim())), ['Internal', 'Follow-ups', 'External meetings', 'Product meetings']);
  await page.waitForFunction(() => document.querySelector('.screen-lane')?.dataset.orientation === 'horizontal', { timeout: 5000 }).catch(async () => {
    throw new Error(`The lane at 1440 lists ${await page.$eval('.screen-lane', lane => `${lane.dataset.orientation} at ${lane.getBoundingClientRect().width}px`)}`);
  });
  assert.equal(await page.$eval('.screen-count', count => count.textContent.trim()), '7');
  await pause(600);
  await shot('lane-dividers-1440-light');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await open(BOOK);
  await page.waitForSelector('.screen-lane[data-orientation="vertical"] .screen-chapter-divider', { timeout: 20000 });
  const divider = await page.$eval('.screen-chapter-divider', element => {
    const box = element.getBoundingClientRect();
    return { width: box.width, lane: element.closest('.screen-lane-strip').getBoundingClientRect().width };
  });
  assert.ok(divider.width > divider.lane * 0.9, `A divider at 390 is ${divider.width}px of ${divider.lane}px`);
  await shot('lane-dividers-390-light');
  await page.setViewport({ width: 1440, height: 1000 });
  await open(BOOK);
  await button('Book');
  await waitFile(BOOK, text => text.includes('arrangement: book'), 'returned to book');
  console.log('PASS lanes show chapter dividers in the strip and as header rows under 560px, counting items only');

  // AC14, AC15: a dynamic compilation grouped by folder, continuous then paged; loading more never reorders a chapter.
  await open(MINUTES);
  await bodyHas('Zeta minutes 01.');
  const chapterOrder = () => page.$$eval('.compilation-book-layout > .compilation-book-contents li[data-level="0"]', entries => entries.map(entry => entry.textContent.trim()));
  assert.deepEqual(await chapterOrder(), ['Minutes', 'Zeta team', 'Alpha team']);
  const loadedBefore = await page.$$eval('.compilation-book-layout > .compilation-book-contents li[data-level="1"]', entries => entries.length);
  await shot('dynamic-book-1440-light');
  for (let i = 0; i < 20 && (await page.$$eval('.compilation-book-layout > .compilation-book-contents li[data-level="1"]', entries => entries.length)) < 61; i++) {
    await page.$eval('.compilation-book', body => body.scrollTop = body.scrollHeight);
    await pause(400);
  }
  const entries = await page.$$eval('.compilation-book-layout > .compilation-book-contents li', list => list.map(entry => entry.textContent.trim()));
  assert.ok(loadedBefore < 61, `The first page already held every member (${loadedBefore})`);
  assert.equal(entries.length, 64);
  assert.deepEqual(await chapterOrder(), ['Minutes', 'Zeta team', 'Alpha team']);
  assert.deepEqual(entries.slice(0, 4), ['Minutes', 'Minutes index', 'Zeta team', 'Zeta 01']);
  assert.equal(entries.at(-1), 'Alpha 30');
  await mode('Paged');
  await page.waitForSelector('.compilation-book-page-count');
  await clickContents('Minutes');
  await page.waitForFunction(() => document.querySelector('.compilation-book-page-count')?.textContent.trim() === '1 / 3');
  await clickContents('Alpha 05');
  await page.waitForFunction(() => document.querySelector('.compilation-book-page-count')?.textContent.trim() === '3 / 3');
  assert.equal(await pageTitle(), 'Alpha team');
  await shot('dynamic-book-paged-1440-light');
  await mode('Continuous');
  console.log('PASS a dynamic compilation grouped by folder reads one chapter per folder, paged too, and loading more keeps the chapter order');

  // Dark theme, the phone width and Traditional Chinese.
  await theme('dark');
  await open(BOOK);
  await bodyHas('A visit to a client site.');
  await shot('book-continuous-1440-dark');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await open(BOOK);
  await bodyHas('A visit to a client site.');
  await shot('book-continuous-390-dark');
  await page.evaluate(() => localStorage.setItem('qa-language', 'zh-TW'));
  await open(BOOK);
  await bodyHas('A visit to a client site.');
  await page.evaluate(() => document.querySelector('.compilation-book-contents-button')?.click());
  await page.waitForSelector('.compilation-book-drawer .compilation-book-contents li[data-level="2"]', { timeout: 10000 });
  await shot('book-contents-390-dark-zh-TW');
  await page.keyboard.press('Escape');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label')?.startsWith('編排目錄'))?.click());
  await page.waitForSelector('dialog[open] .compilation-order-list');
  await shot('arrange-contents-390-dark-zh-TW');
  await page.keyboard.press('Escape');
  await theme('light');
  await page.evaluate(() => localStorage.setItem('qa-language', 'en'));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await open(BOOK);
  await bodyHas('A visit to a client site.');
  await shot('book-continuous-390-light');
  await page.setViewport({ width: 1440, height: 1000 });
  await theme('dark');
  await open(MINUTES);
  await bodyHas('Zeta minutes 01.');
  await shot('dynamic-book-1440-dark');
  console.log('PASS the chapters render at 390 and 1440, light and dark, in English and Traditional Chinese');

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
