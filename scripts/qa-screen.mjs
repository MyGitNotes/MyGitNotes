import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SUPPORTED_SCHEMA_VERSION } from '../packages/core/dist/config.js';
import { createQaWorkspace, launchQaBrowser, product, qaRequire, startQaServer } from './lib/qa-harness.mjs';

// The controls of a compilation's lane (this script was the Screen board's QA): native and Alt+wheel scrolling, the size tabs,
// a dynamic compilation's sort and rename (which renames its file) written to disk, a custom compilation's manual order, and the former Screen URLs.
const require = qaRequire();
const { root, write, commitFixture } = createQaWorkspace('github-notes-screen-qa-');
write('.github-notes.yaml', `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: Screen QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n`);
for (let i = 0; i < 6; i++) write(`notes/example/note-${i}.md`, `---\ntags: [example-tag]\n---\n# Note ${i}\n\n${'A long paragraph for native vertical scrolling.\n\n'.repeat(40)}`);
write('notes/example/reading.compilation.yml', 'version: 1\nid: reading\ntitle: Reading\narrangement: lane\nsize: medium\nsource:\n  kind: folder\n  path: notes/example\n  recursive: false\nsort:\n  field: title\n  order: asc\n');
write('notes/example/pins.compilation.yml', 'version: 1\nid: pins\ntitle: Pins\narrangement: lane\nsize: small\nitems:\n  - id: pin-0\n    kind: note\n    path: notes/example/note-0.md\n  - id: pin-1\n    kind: note\n    path: notes/example/note-1.md\n');
commitFixture('QA');
const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const errors = [];
const page = await browser.newPage();
page.on('pageerror', error => errors.push(error.message));
await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
await page.setViewport({ width: 1440, height: 1000 });

const fileText = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const lane = '.compilation-view .screen-lane', body = `${lane} .screen-card-content`, strip = `${lane} .screen-lane-strip`;
const open = async id => {
  await page.goto(`${base}/notebooks/example/notes/${id}.compilation.yml`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`${lane} .screen-card-title`);
};
const titles = () => page.$$eval(`${lane} .screen-card-title`, cards => cards.map(card => card.textContent));
const saved = async (rel, text) => {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (fs.existsSync(path.join(root, rel)) && fileText(rel).includes(text)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`${rel} does not contain ${text}`);
};

try {
  await open('reading');
  const headerHeight = await page.$eval('.header-layout', e => e.getBoundingClientRect().height);
  assert.ok(headerHeight <= 56, `Desktop navigation is too tall: ${headerHeight}`);

  // The wheel scrolls a card's note natively; Alt+wheel moves the strip and leaves the note alone, and is not taken at the strip's end.
  await page.waitForSelector(body);
  const rect = await (await page.$(body)).boundingBox();
  await page.mouse.move(rect.x + 100, rect.y + 100);
  await page.mouse.wheel({ deltaY: 180 });
  await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 0, {}, body);
  assert.ok(await page.$eval(strip, e => e.scrollLeft === 0), 'Native wheel unexpectedly moved the strip');
  const vertical = await page.$eval(body, e => e.scrollTop);
  await page.keyboard.down('Alt');
  await page.mouse.wheel({ deltaY: 180 });
  await page.keyboard.up('Alt');
  await page.waitForFunction(selector => document.querySelector(selector).scrollLeft > 0, {}, strip);
  assert.ok(await page.$eval(body, (e, before) => e.scrollTop === before, vertical), 'Alt wheel was intercepted by note scrolling');
  await page.$eval(strip, e => {
    e.scrollLeft = e.scrollWidth;
  });
  const edge = await page.$eval(strip, e => e.scrollLeft);
  const edgeResult = await page.$eval(body, e => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, altKey: true });
    e.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.ok(edgeResult && await page.$eval(strip, (e, x) => e.scrollLeft === x, edge), 'Alt wheel escaped at the strip boundary');
  console.log('PASS native note scrolling, Alt horizontal scrolling and boundary containment');

  // The size tabs change the lane without writing the file.
  const before = fileText('notes/example/reading.compilation.yml');
  for (const [label, value] of [['Thumbnail', 'thumbnail'], ['Small', 'small'], ['Medium', 'medium']]) {
    await page.click(`.compilation-view button[aria-label="${label}"]`);
    await page.waitForSelector(`${lane}.screen-view-${value}`);
    assert.equal(await page.$eval(`.compilation-view button[aria-label="${label}"]`, e => e.getAttribute('aria-pressed')), 'true');
  }
  assert.equal(fileText('notes/example/reading.compilation.yml'), before, 'A size change wrote the compilation file');
  console.log('PASS size tabs switch the lane without writing the file');

  // A dynamic compilation sorts independently and keeps the choice in its file; a custom one keeps its manual order and has no sort.
  for (const [value, title] of [['title:desc', 'Note 5'], ['title:asc', 'Note 0'], ['title:desc', 'Note 5']]) {
    await page.click(`${lane} .screen-sort-select`);
    await page.waitForSelector(`[data-option-value="${value}"]`);
    await page.click(`[data-option-value="${value}"]`);
    await page.waitForFunction((selector, expected) => document.querySelector(`${selector} .screen-card-title`)?.textContent === expected, {}, lane, title);
  }
  await saved('notes/example/reading.compilation.yml', 'order: desc');
  await open('reading');
  assert.equal((await titles())[0], 'Note 5', 'The sort did not persist');
  await open('pins');
  assert.ok(!await page.$('.compilation-view .screen-sort-select'), 'A custom compilation must keep its manual ordering');
  console.log('PASS independent dynamic sorting persisted in the file, with manual ordering kept for a custom compilation');

  // Renaming from the heading changes the title in the file and survives a reload.
  await open('reading');
  await page.click('.compilation-view .title-rename');
  await page.waitForSelector('dialog[open] input');
  await page.$eval('dialog[open] input', input => input.select());
  await page.keyboard.type('Renamed');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.compilation-view .screen-lane-heading h3')?.textContent === 'Renamed');
  // The file takes the new name along with the title.
  await saved('notes/example/renamed.compilation.yml', 'title: Renamed');
  assert.ok(!fs.existsSync(path.join(root, 'notes/example/reading.compilation.yml')), 'The old file name remains after the rename');
  await page.waitForFunction(() => location.pathname.endsWith('/renamed.compilation.yml'), { timeout: 8000 }).catch(() => assert.fail(`The route still names the old file after the rename: ${page.url()}`));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.compilation-view .screen-lane-heading h3')?.textContent === 'Renamed');
  console.log('PASS rename from the heading is written and persists');

  // Controls stay inside narrow viewports.
  for (const width of [320, 390, 1440]) {
    await page.setViewport({ width, height: 1000 });
    const fit = await page.$eval('.compilation-view .screen-lane-actions', e => {
      const r = e.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth;
    });
    assert.ok(fit, `Compilation controls overflow at ${width}`);
    const navFits = await page.$$eval('.header-nav button', buttons =>
      buttons.filter(button => button.getBoundingClientRect().width > 0).every(button => {
        const r = button.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.height >= 32;
      }));
    assert.ok(navFits, `Navigation buttons clipped or undersized at ${width}`);
  }
  fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
  await page.screenshot({ path: path.join(product, 'artifacts/qa/screen-lanes.png') });
  console.log('PASS compilation controls and navigation fit at 320, 390 and 1440');

  // A former Screen URL goes to the notes list, or to the study session of the compilation that kept the lane's id.
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${base}/screen`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.pathname === '/notes');
  await page.goto(`${base}/screen/lanes/pins`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.pathname === '/notes/study' && new URLSearchParams(location.search).get('path') === 'pins.compilation.yml');
  console.log("PASS former Screen URLs redirect to the notes list and the lane id's compilation");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
