import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertReadingLayout, collectPageErrors, createQaWorkspace, launchQaBrowser, MOD_KEY, pressChord, product, qaRequire, slotReading, startQaServer } from './lib/qa-harness.mjs';

// Book arrangement against the built app and a disposable local workspace: a legacy `stack` file opens as Book without being
// written, the contents follow scrolling and jump, the drawer serves a narrow compilation, and a section edits in place.
const require = qaRequire();
const { SUPPORTED_SCHEMA_VERSION, WORKSPACE_CONFIG_FILENAME } = await import(`${product}/packages/core/dist/index.js`);
const { root, write, git, commitFixture } = createQaWorkspace('mygitnotes-book-qa-');
write(WORKSPACE_CONFIG_FILENAME, `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: Book QA\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: Research\n    root: notes/a\n`);
const two = n => String(n).padStart(2, '0');
const chapters = Array.from({ length: 12 }, (_, index) => index + 1);
for (const n of chapters) {
  const paragraphs = Array.from({ length: 9 }, (_, k) => `Paragraph ${k + 1} of chapter ${two(n)}. The quick brown fox jumps over the lazy dog while the book keeps scrolling.`).join('\n\n');
  write(`notes/a/chapter-${two(n)}.md`, `---\ntitle: Chapter ${two(n)}\n---\n# Heading ${two(n)}\n\n${paragraphs}\n`);
}
write('notes/a/sub/sub-one.md', '---\ntitle: Sub one\n---\n# Sub one\n\nFirst note of the folder.\n');
write('notes/a/sub/sub-two.md', '---\ntitle: Sub two\n---\n# Sub two\n\nSecond note of the folder.\n');
const compilationFile = 'notes/a/reading.compilation.yml';
const legacy = `version: 1\nid: reading\ntitle: Reading\narrangement: stack\nitems:\n${chapters.map(n => `  - { id: c${two(n)}, kind: note, path: notes/a/chapter-${two(n)}.md }`).join('\n')}\n  - { id: sub, kind: folder, path: notes/a/sub }\n`;
write(compilationFile, legacy);
commitFixture('Book QA');

const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const shots = path.join(product, 'artifacts/qa');
fs.mkdirSync(shots, { recursive: true });
const page = await browser.newPage();
const errors = collectPageErrors(page);
await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
await page.setViewport({ width: 1440, height: 1000 });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const waitFile = async (file, text) => {
  for (let i = 0; i < 100; i++) {
    if (read(file).includes(text)) return;
    await pause(100);
  }
  throw new Error(`Saved content missing from ${file}: ${text}`);
};
const BODY = '.compilation-book';
const anchor = id => `[data-book-anchor="chapter:${id}"]`;
const section = n => `.compilation-book > .compilation-book-section:nth-child(${n})`;
/** Opens the compilation and waits for `anchors` headings: all 15 when reading continuously, one chapter's when paged. */
const open = async (anchors = 15) => {
  await page.goto(`${base}/notebooks/a/notes/reading.compilation.yml`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.compilation-book-view', { timeout: 20000 });
  await page.waitForFunction(anchors => document.querySelectorAll('.compilation-book [data-book-anchor]').length >= anchors, {}, anchors);
};
const current = () => page.$$eval('.compilation-book-layout > .compilation-book-contents button[aria-current="location"]', buttons => buttons.map(button => button.textContent.trim()));
const entries = () => page.$$eval('.compilation-book-layout > .compilation-book-contents button', buttons => buttons.map(button => button.textContent.trim()));
/** The heading's top edge relative to the top of the book body. */
const headingTop = selector => page.$eval(BODY, (body, selector) => body.querySelector(selector).getBoundingClientRect().top - body.getBoundingClientRect().top, selector);
const scrollToHeading = selector =>
  page.$eval(BODY, (body, selector) => {
    body.scrollTop += body.querySelector(selector).getBoundingClientRect().top - body.getBoundingClientRect().top;
  }, selector);
const dialogOpen = () => page.$('[role="dialog"][aria-label="Compilation"]').then(Boolean);
const editorFocused = () => Boolean(document.activeElement?.closest('[data-editing] .cm-content, [data-editing] textarea'));
const shot = name => page.screenshot({ path: path.join(shots, `compilation-book-${name}.png`) });
const FINAL = process.env.QA_SHOTS_FINAL;
/** A named screenshot for the person who reviews the result, written when QA_SHOTS_FINAL names a folder. */
const finalShot = async name => {
  if (!FINAL) return;
  fs.mkdirSync(FINAL, { recursive: true });
  await page.screenshot({ path: path.join(FINAL, `${name}.png`) });
};

try {
  // S2: a stack file opens as Book and is left as it is.
  await open();
  assert.equal(await page.$eval('.compilation-view', view => view.dataset.arrangement), 'book', 'A stack file did not open as Book');
  assert.equal(read(compilationFile), legacy, 'Opening a stack file wrote it');
  assert.equal(git('status', '--porcelain').toString(), '', 'Opening a stack file left the workspace dirty');
  console.log('PASS a stack compilation opens as Book without writing the file');

  // B2, B5: contents beside the book, with the folder's notes beneath it.
  const names = await entries();
  assert.deepEqual(names, [...chapters.map(n => `Chapter ${two(n)}`), 'sub', 'Sub one', 'Sub two']);
  assert.equal(await page.$eval('.compilation-book-layout > .compilation-book-contents', nav => nav.getAttribute('aria-label')), 'Contents');
  assert.equal(await page.$eval('.compilation-book-contents-button', button => getComputedStyle(button).display), 'none', 'The Contents button shows beside a wide contents list');
  await shot('reading');
  await finalShot('book-reading-1440');

  // B6, B7, B11: highlight follows scrolling, a click jumps, the page itself never scrolls.
  assert.deepEqual(await current(), ['Chapter 01']);
  await scrollToHeading(anchor('c06'));
  await page.waitForFunction(() => document.querySelector('.compilation-book-layout > .compilation-book-contents button[aria-current="location"]')?.textContent.trim() === 'Chapter 06');
  await page.click('.compilation-book-layout > .compilation-book-contents li:nth-child(9) button');
  await page.waitForFunction(
    selector => {
      const body = document.querySelector('.compilation-book');
      return Math.abs(body.querySelector(selector).getBoundingClientRect().top - body.getBoundingClientRect().top) < 12;
    },
    {},
    anchor('c09'),
  );
  assert.deepEqual(await current(), ['Chapter 09']);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.bookAnchor), 'chapter:c09', 'Heading did not take focus');
  assert.ok(new URL(page.url()).hash === '', 'A jump changed the URL');
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, 'The page scrolled');
  await page.$eval(BODY, body => {
    body.scrollTop = body.scrollHeight;
  });
  await page.waitForFunction(() => document.querySelector('.compilation-book-layout > .compilation-book-contents button[aria-current="location"]')?.textContent.trim() === 'Sub two');
  console.log('PASS contents highlight follows scrolling, jumps to a heading and ends on the last entry');

  // E1, E5, E6: click the body of chapter 3, type, then Edit chapter 5; chapter 3 is saved on disk and chapter 5 keeps its heading in place.
  await scrollToHeading(anchor('c03'));
  await page.click(`${section(3)} .compilation-inline-reading p`);
  await page.waitForSelector(`${section(3)}[data-editing] .cm-content`);
  await page.waitForFunction(editorFocused);
  await page.keyboard.type('TYPED-IN-CHAPTER-THREE ');
  // Blank lines make the editor much taller than the section reads once saved, so leaving it moves everything below it.
  for (let line = 0; line < 30; line++) await page.keyboard.press('Enter');
  await pause(500);
  await scrollToHeading(anchor('c05'));
  await pause(300);
  const before = await headingTop(anchor('c05'));
  const reading5 = await slotReading(page, section(5));
  // A script click would scroll the button into view first; this one leaves the scroll position to the app.
  await page.$eval('button[aria-label="Edit Chapter 05"]', button => button.click());
  await page.waitForSelector(`${section(5)}[data-editing] .cm-content`);
  await page.waitForFunction(selector => !document.querySelector(selector).hasAttribute('data-editing'), {}, section(3));
  await waitFile('notes/a/chapter-03.md', 'TYPED-IN-CHAPTER-THREE');
  // The saved section leaves no recovery draft behind, or reopening it would offer to restore text that is already on disk.
  await pause(1000);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('gh_notes_draft:') && key.endsWith(':notes/a/chapter-03.md'))), [], 'A saved section left a recovery draft in storage');
  await pause(300);
  await shot('editing');
  await finalShot('book-section-editing-1440');
  const after = await headingTop(anchor('c05'));
  assert.ok(Math.abs(after - before) <= 2, `Chapter 5 heading moved from ${before} to ${after} when it began editing`);
  assert.equal(await page.$$eval('[data-editing]', editing => editing.length), 1, 'More than one section edits');
  assert.ok((await page.$eval(`${section(3)} .compilation-inline-reading`, element => element.textContent)).includes('TYPED-IN-CHAPTER-THREE'), 'Chapter 3 does not read with the saved content');
  console.log('PASS click-edit a section, switch to another, the first is saved and the heading keeps its place');

  // E3, E15: the section edits in the reading layout and takes its content's height, so the book scrolls as one document.
  const grown = selector => page.$eval(`${section(5)} ${selector}`, element => ({ inner: element.scrollHeight - element.clientHeight, height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width }));
  const sectionWidth = await page.$eval(section(5), element => element.getBoundingClientRect().width);
  const live = await grown('.cm-scroller');
  assert.ok(live.inner <= 1 && live.height > 400, `The live editor scrolls inside the section: ${JSON.stringify(live)}`);
  assert.ok((await grown('.note-editor-body')).width >= sectionWidth - 4, 'The live editor does not fill the section width');
  await assertReadingLayout(page, section(5), reading5, 'chapter 5');
  console.log('PASS the section editor grows with its content and keeps the reading layout');

  // B12: while chapter 5 edits, the contents name it wherever the book is scrolled.
  await scrollToHeading(anchor('c09'));
  await pause(400);
  assert.deepEqual(await current(), ['Chapter 05'], 'The contents do not name the chapter that edits');
  assert.equal(await page.$$eval('.compilation-book-layout > .compilation-book-contents [aria-current="location"]', entries => entries.length), 1);
  console.log('PASS the contents highlight the editing chapter while the book is scrolled elsewhere');

  // E4: the title opens the note in zoom on the same editing session, and closing zoom returns the editor to the section.
  await page.focus(`${section(5)} .cm-content`);
  await page.keyboard.type('UNSAVED-SESSION ');
  // The caret sits inside the typed text: zoom's editor is a new CodeMirror view, which starts from this caret and this undo history.
  for (let step = 0; step < 9; step++) await page.keyboard.press('ArrowLeft');
  const padding = () => page.$eval('.note-overlay', overlay => getComputedStyle(overlay).paddingRight);
  const overlayPadding = await padding();
  await page.click(`${section(5)} .compilation-book-title`);
  await page.waitForSelector('[role="dialog"][aria-label="Note editor"] .cm-content');
  const zoomText = await page.$eval('[role="dialog"][aria-label="Note editor"] .cm-content', element => element.textContent);
  assert.ok(zoomText.includes('UNSAVED-SESSION'), `Zoom does not share the editing session: ${zoomText.slice(0, 120)}`);
  assert.ok((await page.$eval(`${section(5)}`, element => element.textContent)).includes('This note is open in zoom.'), 'The section does not say the note is in zoom');
  await page.click('button[aria-label="Close note"]');
  await page.waitForSelector(`${section(5)}[data-editing] .cm-content`);
  assert.equal(await padding(), overlayPadding, 'The compilation frame changed width after a note was opened and closed');
  assert.equal(await page.evaluate(() => document.activeElement?.className.includes('compilation-book-title')), true, 'Focus did not return to the title that opened the note');
  assert.ok((await page.$eval(`${section(5)} .cm-content`, element => element.textContent)).includes('UNSAVED-SESSION'), 'The section lost its text after zoom');
  // The editor that came back continues the session: the caret is where it was, and undo steps back through what was typed before zoom.
  const sectionText = () => page.$eval(`${section(5)} .cm-content`, element => element.textContent);
  await page.focus(`${section(5)} .cm-content`);
  await page.keyboard.type('Q');
  assert.ok((await sectionText()).includes('UNSAVEDQ-SESSION '), `The caret moved while zoom was open: ${(await sectionText()).slice(0, 40)}`);
  await pressChord(page, 'KeyZ', MOD_KEY);
  assert.ok((await sectionText()).includes('UNSAVED-SESSION '), 'Undo after zoom did not remove the last typed text');
  await pressChord(page, 'KeyZ', MOD_KEY);
  assert.ok(!(await sectionText()).includes('UNSAVED-SESSION'), 'The undo history from before zoom is gone');
  await pressChord(page, 'KeyZ', MOD_KEY, 'Shift');
  assert.ok((await sectionText()).includes('UNSAVED-SESSION '), 'Redo did not bring back the text typed before zoom');
  console.log("PASS zoom and back keeps the section editor's caret and undo history (E4)");
  // Escape typed in the borrowed zoom editor does not end the section's slot behind it: after zoom closes, the section is still editing with its text.
  await page.click(`${section(5)} .compilation-book-title`);
  await page.waitForSelector('[role="dialog"][aria-label="Note editor"] .cm-content');
  await page.click('[role="dialog"][aria-label="Note editor"] .cm-content');
  await page.keyboard.press('Escape');
  await pause(500);
  await page.click('button[aria-label="Close note"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Note editor"]'));
  await page.waitForSelector(`${section(5)}[data-editing] .cm-content`);
  assert.ok(await dialogOpen(), 'Closing zoom closed the compilation as well');
  assert.ok((await page.$eval(`${section(5)} .cm-content`, element => element.textContent)).includes('UNSAVED-SESSION'), 'The section lost its text after Escape in zoom');
  console.log('PASS zoom borrows the section editor and gives it back, also after Escape typed in zoom');

  // K2: Escape leaves the section first, then the compilation.
  await page.click(`${section(5)} .cm-content`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(selector => !document.querySelector(selector).hasAttribute('data-editing'), {}, section(5));
  assert.ok(await dialogOpen(), 'The first Escape closed the compilation');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Edit Chapter 05', 'Focus is not on the Edit button');
  await waitFile('notes/a/chapter-05.md', 'UNSAVED-SESSION');
  // B12: scrolling decides the highlight again once editing has ended.
  await scrollToHeading(anchor('c09'));
  await page.waitForFunction(() => document.querySelector('.compilation-book-layout > .compilation-book-contents button[aria-current="location"]')?.textContent.trim() === 'Chapter 09');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Compilation"]'));
  console.log('PASS Escape leaves the section, then the compilation');

  // B8: a narrow compilation lists its contents in a drawer.
  await page.setViewport({ width: 390, height: 844 });
  await open();
  assert.equal(await page.$eval('.compilation-book-layout > .compilation-book-contents', nav => getComputedStyle(nav).display), 'none', 'The contents list stayed beside a narrow book');
  assert.notEqual(await page.$eval('.compilation-book-contents-button', button => getComputedStyle(button).display), 'none', 'No Contents button in a narrow book');
  assert.ok(await page.$eval(BODY, body => body.getBoundingClientRect().width <= window.innerWidth), 'The book is wider than the screen');
  await page.click('.compilation-book-contents-button');
  await page.waitForSelector('[role="dialog"][aria-label="Contents"]');
  await shot('drawer-390');
  await finalShot('book-drawer-390');
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="Contents"] button')].find(button => button.textContent.trim() === 'Chapter 04').click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Contents"]'));
  await page.waitForFunction(
    selector => {
      const body = document.querySelector('.compilation-book');
      return Math.abs(body.querySelector(selector).getBoundingClientRect().top - body.getBoundingClientRect().top) < 12;
    },
    {},
    anchor('c04'),
  );
  await page.click('.compilation-book-contents-button');
  await page.waitForSelector('[role="dialog"][aria-label="Contents"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Contents"]'));
  assert.ok(await dialogOpen(), 'Escape in the drawer closed the compilation');
  assert.equal(await page.evaluate(() => document.activeElement?.className.includes('compilation-book-contents-button')), true, 'Focus did not return to the Contents button');
  // 719 and 720: the drawer follows the compilation's own width (not the screen's), so the frame's padding is measured first.
  const bookWidth = () => page.$eval('.compilation-book-view', element => element.getBoundingClientRect().width);
  const frame = 390 - await bookWidth();
  for (const [width, drawer] of [[719, true], [720, false]]) {
    await page.setViewport({ width: width + Math.round(frame), height: 844 });
    await page.waitForFunction(expected => Math.round(document.querySelector('.compilation-book-view').getBoundingClientRect().width) === expected, {}, width);
    assert.equal(await page.$eval('.compilation-book-contents-button', button => getComputedStyle(button).display !== 'none'), drawer, `Contents button at ${width}px`);
    assert.equal(await page.$eval('.compilation-book-layout > .compilation-book-contents', nav => getComputedStyle(nav).display !== 'none'), !drawer, `Contents list at ${width}px`);
  }
  console.log('PASS narrow contents drawer opens, jumps, closes and follows the 720px width');

  // P1-P7: paged reading, at 1440 and then on a 390px touch screen.
  await page.setViewport({ width: 1440, height: 1000 });
  await open();
  const fileBefore = read(compilationFile);
  const MODES = '.compilation-book-modes';
  const modeButton = label => page.evaluateHandle((selector, label) => [...document.querySelectorAll(`${selector} button`)].find(button => button.textContent.trim() === label), MODES, label).then(handle => handle.asElement());
  assert.equal(await page.$$eval('.compilation-book > .compilation-book-section', sections => sections.length), 13, 'Continuous reading does not show every chapter');
  assert.equal(await page.$('.compilation-book-pager'), null, 'The pager shows in continuous reading');
  assert.equal(await page.evaluate(() => localStorage.getItem('github-notes:book-reading-mode')), null, 'The mode is stored before anyone chose it');
  await finalShot('book-mode-switch-1440');
  await (await modeButton('Paged')).click();
  await page.waitForSelector('.compilation-book-pager');
  const pageCount = () => page.$eval('.compilation-book-page-count', element => element.textContent.trim());
  const pageIs = (count, title) => page.waitForFunction((count, title) => document.querySelector('.compilation-book-page-count')?.textContent.trim() === count && document.querySelector('.compilation-book > .compilation-book-section h2')?.textContent.trim() === title, {}, count, title);
  const pagerButton = label => page.evaluateHandle(label => [...document.querySelectorAll('.compilation-book-pager button')].find(button => button.textContent.trim() === label), label).then(handle => handle.asElement());
  await pageIs('1 / 13', 'Chapter 01');
  assert.equal(await page.$$eval('.compilation-book > .compilation-book-section', sections => sections.length), 1, 'Paged reading shows more than one chapter');
  assert.equal(await page.evaluate(() => localStorage.getItem('github-notes:book-reading-mode')), 'paged');
  assert.equal(read(compilationFile), fileBefore, 'Switching to paged wrote the compilation file');
  assert.equal(git('status', '--porcelain', '--', compilationFile).toString(), '', 'Switching to paged left the compilation file changed');
  assert.equal(await page.$eval('.compilation-book-pager button', button => button.disabled), true, 'Previous is enabled on the first page');
  assert.deepEqual(await current(), ['Chapter 01']);
  await shot('paged-1440');
  await finalShot('book-paged-1440');
  // Next scrolls to the top of the new page and focuses its heading.
  await page.$eval(BODY, body => void (body.scrollTop = 0));
  await (await pagerButton('Next')).click();
  await pageIs('2 / 13', 'Chapter 02');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.bookAnchor), 'chapter:c02', 'The new page did not focus its heading');
  assert.equal(await page.$eval(BODY, body => body.scrollTop), 0, 'The new page did not start at the top');
  assert.deepEqual(await current(), ['Chapter 02']);
  // ← and → turn pages from the heading.
  await page.keyboard.press('ArrowRight');
  await pageIs('3 / 13', 'Chapter 03');
  await page.keyboard.press('ArrowLeft');
  await pageIs('2 / 13', 'Chapter 02');
  // The contents list goes to a page.
  await page.click('.compilation-book-layout > .compilation-book-contents li:nth-child(9) button');
  await pageIs('9 / 13', 'Chapter 09');
  assert.deepEqual(await current(), ['Chapter 09']);
  // Arrow keys belong to the editor while a section edits; Next saves the section before leaving.
  await page.click(`${section(1)} .compilation-inline-reading p`);
  await page.waitForSelector(`${section(1)}[data-editing] .cm-content`);
  await page.waitForFunction(editorFocused);
  await page.keyboard.type('TYPED-ON-A-PAGE ');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await pageCount(), '9 / 13', 'An arrow key in the editor turned the page');
  await (await pagerButton('Next')).click();
  await pageIs('10 / 13', 'Chapter 10');
  await waitFile('notes/a/chapter-09.md', 'TYPED-ON-A-PAGE');
  assert.equal(await page.$$eval('[data-editing]', editing => editing.length), 0, 'The page left an editor behind');
  // A folder is one page with its notes in order.
  await page.click('.compilation-book-layout > .compilation-book-contents li:nth-child(13) button');
  await pageIs('13 / 13', 'sub');
  assert.deepEqual(await page.$$eval('.compilation-book h3', headings => headings.map(heading => heading.textContent.trim())), ['Sub one', 'Sub two']);
  assert.equal(await (await pagerButton('Next')).evaluate(button => button.disabled), true, 'Next is enabled on the last page');
  // The folder's notes stay in the contents from another page, and choosing one goes to the folder page and that note.
  await page.click('.compilation-book-layout > .compilation-book-contents li:nth-child(1) button');
  await pageIs('1 / 13', 'Chapter 01');
  assert.ok((await entries()).includes('Sub two'), 'The folder notes left the contents after the page turned away');
  await page.evaluate(() => [...document.querySelectorAll('.compilation-book-layout > .compilation-book-contents button')].find(button => button.textContent.trim() === 'Sub two').click());
  await pageIs('13 / 13', 'sub');
  await page.waitForFunction(() => document.activeElement?.dataset.bookAnchor?.endsWith('sub-two.md'));
  // The mode survives a reload and nothing was written to the compilation.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.compilation-book-pager');
  await pageIs('1 / 13', 'Chapter 01');
  assert.equal(read(compilationFile), fileBefore, 'Paged reading wrote the compilation file');
  assert.equal(git('status', '--porcelain', '--', compilationFile).toString(), '', 'Paged reading left the compilation file changed');
  // Back to continuous keeps the chapter the reader was on.
  await page.click('.compilation-book-layout > .compilation-book-contents li:nth-child(6) button');
  await pageIs('6 / 13', 'Chapter 06');
  await (await modeButton('Continuous')).click();
  await page.waitForFunction(() => document.querySelectorAll('.compilation-book > .compilation-book-section').length === 13);
  await page.waitForFunction(
    selector => {
      const body = document.querySelector('.compilation-book');
      return Math.abs(body.querySelector(selector).getBoundingClientRect().top - body.getBoundingClientRect().top) < 12;
    },
    {},
    anchor('c06'),
  );
  await page.waitForFunction(() => document.querySelector('.compilation-book-layout > .compilation-book-contents button[aria-current="location"]')?.textContent.trim() === 'Chapter 06');
  await (await modeButton('Paged')).click();
  await pageIs('6 / 13', 'Chapter 06');
  console.log('PASS paged reading turns pages by button, arrow keys and contents, saves a section before leaving, survives a reload and writes nothing');

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await open(1);
  await page.waitForSelector('.compilation-book-pager');
  await pageIs('1 / 13', 'Chapter 01');
  assert.ok(await page.$eval('.compilation-book-view', view => view.scrollWidth <= view.clientWidth + 1), 'The paged book overflows sideways at 390px');
  assert.ok(await page.$eval('.compilation-book-bar', bar => bar.scrollWidth <= bar.clientWidth + 1), 'The book bar overflows at 390px');
  assert.ok(await page.$eval('.compilation-book-pager', pager => pager.getBoundingClientRect().bottom <= window.innerHeight), 'The pager is off screen at 390px');
  assert.deepEqual(await page.$$eval('.compilation-book-pager button, .compilation-book-modes button', buttons => buttons.filter(button => button.getBoundingClientRect().height < 44).map(button => `${button.textContent.trim()} ${button.getBoundingClientRect().height}`)), [], 'A paging control is under 44px tall');
  await shot('paged-390');
  await finalShot('book-paged-390');
  const touch = await page.createCDPSession();
  const swipe = async (from, to) => {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
    for (let step = 1; step <= 6; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from[0] + (to[0] - from[0]) * step / 6, y: from[1] + (to[1] - from[1]) * step / 6 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe([320, 400], [60, 410]);
  await pageIs('2 / 13', 'Chapter 02');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.bookAnchor), 'chapter:c02', 'A swipe did not focus the new heading');
  await swipe([60, 400], [320, 390]);
  await pageIs('1 / 13', 'Chapter 01');
  // A vertical drag scrolls and does not turn the page.
  await swipe([200, 600], [190, 200]);
  assert.equal(await pageCount(), '1 / 13', 'A vertical drag turned the page');
  // No swipe while a section edits.
  await page.$eval('button[aria-label="Edit Chapter 01"]', button => button.click());
  await page.waitForSelector(`${section(1)}[data-editing] .cm-content`);
  await swipe([320, 500], [60, 500]);
  assert.equal(await pageCount(), '1 / 13', 'A swipe turned the page while a section edited');
  await page.$eval(`${section(1)} button.compilation-edit-toggle`, button => button.click());
  await page.waitForFunction(selector => !document.querySelector(selector).hasAttribute('data-editing'), {}, section(1));
  // The drawer goes to a page.
  await page.click('.compilation-book-contents-button');
  await page.waitForSelector('[role="dialog"][aria-label="Contents"]');
  await shot('paged-drawer-390');
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-label="Contents"] button')].find(button => button.textContent.trim() === 'Chapter 07').click());
  await pageIs('7 / 13', 'Chapter 07');
  assert.equal(await page.$('[role="dialog"][aria-label="Contents"]'), null, 'The drawer stayed open after choosing a page');
  await (await pagerButton('Next')).click();
  await pageIs('8 / 13', 'Chapter 08');
  await (await modeButton('Continuous')).click();
  await page.waitForFunction(() => document.querySelectorAll('.compilation-book > .compilation-book-section').length === 13);
  await finalShot('book-mode-switch-390');
  assert.equal(read(compilationFile), fileBefore, 'Reading on a phone wrote the compilation file');
  console.log('PASS paged reading on a 390px touch screen swipes, ignores vertical drags and edits, and uses the drawer');
  await page.setViewport({ width: 1440, height: 1000 });
  await open();

  // S3: an arrangement change writes `book`, never `stack`.
  await page.setViewport({ width: 1440, height: 1000 });
  await open();
  await page.click('.compilation-book-view button[aria-label="Small"]');
  await waitFile(compilationFile, 'arrangement: lane');
  await page.waitForSelector('.compilation-view[data-arrangement="small"]');
  await page.click('.compilation-view button[aria-label="Book"]');
  await waitFile(compilationFile, 'arrangement: book');
  assert.ok(!read(compilationFile).includes('stack'), 'The file still names stack');
  console.log('PASS changing the arrangement writes book');

  assert.deepEqual(errors, [], `Page errors: ${errors.join('; ')}`);
} catch (error) {
  await shot('failure').catch(() => {});
  console.error(errors);
  throw error;
} finally {
  await browser.close();
  server.close();
}
