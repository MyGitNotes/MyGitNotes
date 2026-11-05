import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SUPPORTED_SCHEMA_VERSION } from '../packages/core/dist/config.js';
import { chooseSelect } from './browser-select.mjs';
import { createQaWorkspace, launchQaBrowser, product, qaRequire, startQaServer } from './lib/qa-harness.mjs';

const require = qaRequire();
const { root, write, commitFixture } = createQaWorkspace('github-notes-focus-qa-');
write('.github-notes.yaml', `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: Focus QA\n  default_notebook: work\nnotebooks:\n  - id: work\n    title: Work\n    root: notes/work\n  - id: other\n    title: Other\n    root: notes/other\n`);
// The app keys each notebook id with its workspace id.
const work = `${path.basename(root).toLowerCase()}~work`;
const notes = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
const tags = { Alpha: ['project'], Gamma: ['project'], Beta: ['personal'] };
notes.forEach((title, index) => write(`notes/work/${title.toLowerCase()}.md`, `---\ntitle: ${title}\nstatus: ${index % 2 ? 'doing' : 'todo'}\nupdated: 2026-09-${String(10 + index).padStart(2, '0')}\n${tags[title] ? `tags: [${tags[title].join(', ')}]\n` : ''}---\n# ${title}\n\n${title} body.\n\n${title === 'Delta' ? '[Open Epsilon](epsilon.md)\n' : ''}`));
write('notes/work/sub/omega.md', '---\ntitle: Omega\nstatus: todo\nupdated: 2026-09-16\ntags: [project]\n---\n# Omega\n\nOmega body.\n');
write('notes/work/sub/nested/deep.md', '---\ntitle: Deep\nstatus: todo\nupdated: 2026-09-17\n---\n# Deep\n\nDeep body.\n');
write('notes/other/outside.md', '---\ntitle: Outside\n---\n# Outside\n');
write('notes/work/pins.compilation.yml', 'version: 1\nid: pins\ntitle: Pins\narrangement: lane\nsize: small\nitems:\n  - id: pin-gamma\n    kind: note\n    path: notes/work/gamma.md\n');
commitFixture();
const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const shots = path.join(product, 'artifacts/qa');
fs.mkdirSync(shots, { recursive: true });

const errors = [];
const newPage = async (width, height = 900) => {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width, height });
  return page;
};
const shot = (page, name) => page.screenshot({ path: path.join(shots, `note-focus-${name}.png`) });
const search = page => new URL(page.url()).searchParams;
/** Panes are addressed by index in this script (pane order); the DOM names them by id: the migrated divisions' panes are p1, p2, …. */
const paneId = index => `p${index + 1}`;
const tabLabels = (page, pane) => page.$$eval(`[data-focus-pane="${paneId(pane)}"] .focus-tab [role="tab"]`, tabs => tabs.map(tab => tab.textContent.trim()));
const shownTab = (page, pane) => page.$eval(`[data-focus-pane="${paneId(pane)}"] .focus-tab [role="tab"][aria-selected="true"]`, tab => tab.textContent.trim()).catch(() => null);
const paneCount = page => page.$$eval('[data-focus-pane]', panes => panes.length);
const activePane = page => page.$eval('[data-focus-pane][data-active]', pane => Number(pane.dataset.focusPane.slice(1)) - 1);
const BROWSE_ROW_SELECTOR = '.workspace-scroll :is(.note-list tbody tr, [data-focus-row], [data-notepath], .cursor-pointer.rounded-xl)';
/** A note in the browse region: a list row, a card or a Kanban card. */
const browseRow = (page, title) => page.evaluateHandle((selector, title) => [...document.querySelectorAll(selector)].find(row => row.textContent.includes(title)), BROWSE_ROW_SELECTOR, title);
/** A Focus opens with the browse region collapsed; the notes to put in it come from there. */
const showBrowse = async page => {
  const collapsed = await page.$('.browse-dock-toggle[data-collapsed]');
  if (!collapsed) return;
  await collapsed.click();
  await page.waitForSelector('.browse-dock-toggle:not([data-collapsed])');
};
/** Clicks a browse item's title, away from its status and action controls.
 *  A view switch (e.g. to Kanban) renders its columns before their notes finish loading, so this waits for the row itself. */
/** Opens the browse region and waits for the row of a note: after a page load it fills in a moment later. */
const waitRow = async (page, title) => {
  await showBrowse(page);
  await page.waitForFunction((selector, title) => [...document.querySelectorAll(selector)].some(row => row.textContent.includes(title)), { timeout: 5000 }, BROWSE_ROW_SELECTOR, title).catch(() => assert.fail(`Browse row ${title} is missing`));
  return browseRow(page, title);
};
const clickRow = async (page, title) => {
  const row = await waitRow(page, title);
  const label = await row.evaluateHandle((row, title) => [...row.querySelectorAll('*')].reverse().find(element => element.textContent.trim() === title), title);
  await (label.asElement() ?? row.asElement()).click();
};
/** Beside a Focus the notebook sidebar is an icon rail: its Notebooks icon opens the notebook tree as a flyout, which closes after an entry is picked. */
const openNotebookTree = async page => {
  if (!await page.$('.sidebar-flyout')) await page.click('[aria-label="Filter by Notebooks"]');
  await page.waitForSelector('.sidebar-flyout .sidebar-notebook-group');
};
/** A compilation opens from the Compilations list; `leaveCompilations` returns the browse region to the notebook's notes. */
const openCompilation = async (page, title) => {
  await showBrowse(page);
  await page.click('.desktop-views > button:nth-child(1)');
  await new Promise(r => setTimeout(r, 500));
  await openNotebookTree(page);
  await page.evaluate(() => [...document.querySelectorAll('.sidebar-compilations-row')].find(row => row.textContent.includes('Compilations')).querySelector('button').click());
  await clickRow(page, title);
};
const leaveCompilations = async page => {
  await openNotebookTree(page);
  await page.evaluate(() => document.querySelector('.sidebar-notebook-group > *').querySelector('button:not([aria-expanded])').click());
};
const clickTagOption = async (page, tag) => {
  const label = await page.waitForFunction(tag => [...document.querySelectorAll('.focus-batch-dialog .filter-options label')].find(item => item.textContent.trim() === `#${tag}`), {}, tag);
  await (await label.asElement().$('input')).click();
};
const menuItem = async (page, label) => {
  const item = await page.waitForFunction(label => [...document.querySelectorAll('.focus-menu [role^="menuitem"]')].find(item => item.textContent.trim() === label), {}, label);
  await item.asElement().click();
};
/** A Focus can no longer be given an empty pane from the UI, so the steps that start from empty panes seed this device's scratch Focus with a version 1 division (still readable) and reload. */
const seedDefaultDivision = async (page, division, paneCount) => {
  // The Focus view is stored per repository and notebook, and an earlier key may still be adopted from; seed every one.
  await page.evaluate(
    (division, paneCount) => {
      for (const key of Object.keys(localStorage).filter(name => name.startsWith('github-notes:focus-view:'))) {
        const view = JSON.parse(localStorage.getItem(key));
        view.current = { division, panes: Array.from({ length: paneCount }, () => ({ tabs: [] })) };
        localStorage.setItem(key, JSON.stringify(view));
      }
    },
    division,
    paneCount,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.focus-switcher');
};
/** Drags with HTML5 drag and drop: puppeteer's mouse does not start native drags, so the events are dispatched with one DataTransfer.
 *  `shift: true` holds the Shift modifier through the drop, matching a Shift-held tab-bar drag (copy instead of move).
 *  The drop lands at `at` of the target: the centre by default, or the middle of its `left`, `right`, `top` or `bottom` edge zone. */
const dragTo = (page, source, target, { shift = false, at = 'center' } = {}) =>
  page.evaluate(
    (source, target, shiftKey, at) => {
      const from = typeof source === 'string' ? document.querySelector(source) : source;
      const to = typeof target === 'string' ? document.querySelector(target) : target;
      const box = to.getBoundingClientRect();
      const fraction = { center: [0.5, 0.5], left: [0.05, 0.5], right: [0.95, 0.5], top: [0.5, 0.05], bottom: [0.5, 0.95] }[at];
      const position = { clientX: box.left + box.width * fraction[0], clientY: box.top + box.height * fraction[1] };
      const data = new DataTransfer();
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data, shiftKey }));
      to.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data, shiftKey, ...position }));
      to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data, shiftKey, ...position }));
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, shiftKey, ...position }));
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: data, shiftKey }));
    },
    source,
    target,
    shift,
    at,
  );
const tabHandle = (page, pane, label) => page.evaluateHandle((pane, label) => [...document.querySelectorAll(`[data-focus-pane="${pane}"] .focus-tab`)].find(tab => tab.querySelector('[role="tab"]').textContent.trim() === label), paneId(pane), label);
const clickTab = async (page, pane, label) => (await (await tabHandle(page, pane, label)).asElement().$('[role="tab"]')).click();
/** Places the caret at the end of `text` inside the editor under `scope`. */
const clickEnd = async (page, scope, text) => {
  const point = await page.evaluate(
    (scope, text) => {
      const walker = document.createTreeWalker(document.querySelector(`${scope} .cm-content`), NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, start = node.textContent.indexOf(text);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + text.length);
        const box = range.getBoundingClientRect();
        return { x: box.right - 1, y: box.y + box.height / 2 };
      }
      throw Error(`Missing editor text: ${text}`);
    },
    scope,
    text,
  );
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('End');
};
/** Runs a command through quick open: Mod+Shift+P opens it on the command list, with `>` typed. */
const palette = async (page, command) => {
  const mod = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform)) ? 'Meta' : 'Control';
  await page.keyboard.down(mod);
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyP');
  await page.keyboard.up('Shift');
  await page.keyboard.up(mod);
  await page.waitForFunction(() => document.querySelector('.keyboard-shortcuts-panel[data-mode="palette"] input')?.value === '>');
  await page.type('.keyboard-shortcuts-panel input', command);
  await page.waitForFunction(command => document.querySelector('.keyboard-shortcuts-list .is-active')?.textContent.toLowerCase().includes(command), {}, command.toLowerCase());
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.keyboard-shortcuts-panel'));
};
const waitTabs = (page, pane, labels) =>
  page.waitForFunction(
    (pane, labels) => {
      const tabs = [...document.querySelectorAll(`[data-focus-pane="${pane}"] .focus-tab [role="tab"]`)].map(tab => tab.textContent.trim());
      return JSON.stringify(tabs) === JSON.stringify(labels);
    },
    { timeout: 5000 },
    paneId(pane),
    labels,
  ).catch(async () => assert.fail(`Pane ${pane} tabs ${JSON.stringify(await tabLabels(page, pane))} are not ${JSON.stringify(labels)}`));

let page, device;
try {
  page = await newPage(1440);
  await page.goto(`${base}/notebooks/work?view=list`, { waitUntil: 'domcontentloaded' });

  // 1. Normal browsing opens a note as a tab of the Focus and closing the tab returns to the full list.
  await clickRow(page, 'Alpha');
  await page.waitForSelector('.focus-area .note-editor[data-frame="pane"]');
  assert(!await page.$('.note-editor[data-frame="zoom"]'), 'A note opens in a Focus pane, not in zoom');
  await page.waitForFunction(() => document.querySelector('.focus-area [role="tab"][aria-selected="true"]')?.textContent.trim() === 'Alpha');
  await page.click('.focus-area [aria-label="Close Alpha"]');
  await page.waitForFunction(() => !document.querySelector('.note-editor') && !document.querySelector('.focus-area'));
  assert.equal(new URL(page.url()).pathname, `/notebooks/${work}`);
  console.log('PASS 1 normal browsing opens a note as a Focus tab and closing it returns to the list');

  // 2. The Default Focus is always the one shown: dock the list left, seed major-left, open three notes, drag one to the top-right pane.
  assert.equal(await page.$eval('.focus-switcher .select-button-primary', button => button.textContent.trim()), 'Default');
  await seedDefaultDivision(page, 'major-left', 3);
  await page.waitForSelector('.desktop-views');
  // Each tab is opened before the next row is clicked, so the tabs keep the click order.
  for (const [index, title] of ['Alpha', 'Beta', 'Gamma'].entries()) {
    await clickRow(page, title);
    await page.waitForFunction((title, count) => [...document.querySelectorAll('[data-focus-pane="p1"] .focus-tab [role="tab"]')].length === count && document.querySelector('[data-focus-pane="p1"] .focus-tab [role="tab"][aria-selected="true"]')?.textContent.trim() === title, { timeout: 5000 }, title, index + 1);
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 3);
  assert.equal(await page.$eval('.browse-dock', dock => dock.dataset.placement), 'left');
  await waitTabs(page, 0, ['Alpha', 'Beta', 'Gamma']);
  assert.equal(await shownTab(page, 0), 'Gamma');
  await page.waitForSelector('[data-focus-pane="p1"] .note-editor[data-frame="pane"]');
  await dragTo(page, await browseRow(page, 'Beta'), '[data-focus-pane="p2"] .focus-pane-body');
  await waitTabs(page, 1, ['Beta']);
  // A browse-row drag copies: the note stays open in its source pane too.
  await waitTabs(page, 0, ['Alpha', 'Beta', 'Gamma']);
  assert.equal(await activePane(page), 1);
  await shot(page, '1440-major-left');
  console.log('PASS 2 Focus docks the list left, opens rows in the active pane and copies a dropped row into another pane');
  // Closing one pane's copy leaves the note open in the other pane: close/dedupe are pane-scoped.
  await page.click('[data-focus-pane="p1"] [aria-label="Close Beta"]');
  await waitTabs(page, 0, ['Alpha', 'Gamma']);
  await waitTabs(page, 1, ['Beta']);
  console.log("PASS 2a closing one pane's copy of a cross-pane note leaves the other pane's copy open");
  // Closing a tab activated pane 0 (any click inside a pane does); restore pane 1 active before continuing.
  await clickTab(page, 1, 'Beta');
  assert.equal(await activePane(page), 1);

  // Tab-bar drag: a note the target pane already holds is a no-op regardless of the modifier key.
  await dragTo(page, await browseRow(page, 'Alpha'), '[data-focus-pane="p2"] .focus-pane-body');
  await waitTabs(page, 1, ['Beta', 'Alpha']);
  await dragTo(page, await tabHandle(page, 0, 'Alpha'), '[data-focus-pane="p2"] .focus-pane-body');
  await waitTabs(page, 0, ['Alpha', 'Gamma']);
  await waitTabs(page, 1, ['Beta', 'Alpha']);
  console.log('PASS 2b a tab-bar drag onto a pane that already holds the tab is a no-op, in both panes');
  await page.click('[data-focus-pane="p2"] [aria-label="Close Alpha"]');
  await waitTabs(page, 1, ['Beta']);

  // Tab-bar drag without Shift moves the tab out of its source pane.
  await dragTo(page, await tabHandle(page, 0, 'Gamma'), '[data-focus-pane="p2"] .focus-pane-body');
  await waitTabs(page, 0, ['Alpha']);
  await waitTabs(page, 1, ['Beta', 'Gamma']);
  // A moved tab does not switch notes: the target pane keeps showing Beta, the source falls back to its previous tab, and the active pane stays.
  assert.equal(await shownTab(page, 1), 'Beta');
  assert.equal(await shownTab(page, 0), 'Alpha');
  assert.equal(await activePane(page), 1);
  console.log('PASS 2c a tab-bar drag without Shift moves the tab out of its source pane');
  await dragTo(page, await tabHandle(page, 1, 'Gamma'), '[data-focus-pane="p1"] .focus-pane-body');
  await waitTabs(page, 0, ['Alpha', 'Gamma']);
  await waitTabs(page, 1, ['Beta']);
  await clickTab(page, 1, 'Beta');
  assert.equal(await activePane(page), 1);

  // Tab-bar drag with Shift held copies instead, leaving the source pane's tab in place.
  await dragTo(page, await tabHandle(page, 0, 'Alpha'), '[data-focus-pane="p2"] .focus-pane-body', { shift: true });
  await waitTabs(page, 0, ['Alpha', 'Gamma']);
  await waitTabs(page, 1, ['Beta', 'Alpha']);
  console.log('PASS 2d a Shift-held tab-bar drag copies the tab, leaving the source pane unchanged');
  await page.click('[data-focus-pane="p2"] [aria-label="Close Alpha"]');
  await waitTabs(page, 1, ['Beta']);

  // 3. Kanban docks above the Focus; a card opens in the active pane.
  await page.click('.desktop-views > button:nth-child(3)');
  await page.waitForFunction(() => document.querySelector('.browse-dock')?.dataset.placement === 'top' && document.querySelector('[data-kanban-columns]'));
  await clickRow(page, 'Delta');
  await waitTabs(page, 1, ['Beta', 'Delta']);
  assert.equal(await shownTab(page, 1), 'Delta');
  await shot(page, '1440-kanban');
  console.log('PASS 3 Kanban docks above the Focus and a card opens in the active pane');

  // 4. A link in the bottom-right pane opens as a tab of that same pane and leaves the other panes alone.
  await dragTo(page, await browseRow(page, 'Delta'), '[data-focus-pane="p3"] .focus-pane-body');
  await waitTabs(page, 2, ['Delta']);
  // The browse-row drag copies Delta rather than moving it out of pane 1.
  await waitTabs(page, 1, ['Beta', 'Delta']);
  await page.click('[data-focus-pane="p2"] [aria-label="Close Delta"]');
  await waitTabs(page, 1, ['Beta']);
  // The editor owns plain clicks on its text, so a link opens from its explicit affordance beside it.
  const link = await page.waitForSelector('[data-focus-pane="p3"] .live-md-external-link');
  await link.click();
  await waitTabs(page, 2, ['Delta', 'Epsilon']);
  assert.equal(await shownTab(page, 2), 'Epsilon');
  await waitTabs(page, 1, ['Beta']);
  assert(await page.$('[data-focus-pane="p3"] .note-editor[data-frame="pane"]'), 'The linked note opens in the pane');
  await page.click('[data-focus-pane="p3"] [aria-label="Close Epsilon"]');
  await waitTabs(page, 2, ['Delta']);
  // The later steps expect Epsilon beside Beta: a browse row opens in the active pane, so make pane 1 the active one.
  await page.click('[data-focus-pane="p2"] .focus-tab [role="tab"]');
  await clickRow(page, 'Epsilon');
  await waitTabs(page, 1, ['Beta', 'Epsilon']);
  assert.equal(await shownTab(page, 1), 'Epsilon');
  // A compilation opens as a tab of the active pane from the Compilations list and closes again.
  await page.click('[data-focus-pane="p3"] .focus-tab [role="tab"]');
  await openCompilation(page, 'Pins');
  await waitTabs(page, 2, ['Delta', 'Pins']);
  await page.waitForFunction(() => document.querySelector('[data-focus-pane="p3"] .compilation-view')?.textContent.includes('Gamma'));
  await page.click('[data-focus-pane="p3"] [aria-label="Close Pins"]');
  await waitTabs(page, 2, ['Delta']);
  await leaveCompilations(page);
  console.log('PASS 4 a link opens as a tab of its own pane and lanes open as tabs');

  // 5. Name (current); another device (empty storage) opens it from the Focus switcher with its panes and tabs.
  await page.click('.focus-switcher .select-button-trigger');
  await menuItem(page, 'Name this Focus…');
  await page.waitForSelector('.screen-form input');
  await page.type('.screen-form input', '週報');
  await page.click('.screen-form button[type="submit"]');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('focus') !== 'current');
  const focusId = search(page).get('focus');
  const focusFile = path.join(root, '.github-notes-focus.yaml');
  const saved = async text => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (fs.existsSync(focusFile) && fs.readFileSync(focusFile, 'utf8').includes(text)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`${focusFile} does not contain ${text}`);
  };
  await saved('週報');
  const other = await browser.createBrowserContext();
  device = await other.newPage();
  device.on('pageerror', error => errors.push(error.message));
  await device.setViewport({ width: 1440, height: 900 });
  await device.goto(`${base}/notebooks/work?view=list`, { waitUntil: 'domcontentloaded' });
  await device.waitForSelector('.focus-switcher .select-button-trigger');
  await device.click('.focus-switcher .select-button-trigger');
  await menuItem(device, '週報');
  await device.waitForSelector('.focus-area');
  assert.equal(new URL(device.url()).searchParams.get('focus'), focusId);
  assert.equal(await paneCount(device), 3);
  await waitTabs(device, 0, ['Alpha', 'Gamma']);
  await waitTabs(device, 1, ['Beta', 'Epsilon']);
  await waitTabs(device, 2, ['Delta']);
  console.log('PASS 5 a named Focus is written to the workspace and restores from the Focus switcher on another device');

  // 6. A browse row opens in the pane that is active on the other device's copy of the named Focus, and the tab is written to the workspace.
  await clickTab(device, 0, 'Alpha');
  assert.equal(await activePane(device), 0);
  await clickRow(device, 'Zeta');
  await waitTabs(device, 0, ['Alpha', 'Gamma', 'Zeta']);
  assert.equal(await shownTab(device, 0), 'Zeta');
  await saved('notes/work/zeta.md');
  console.log('PASS 6 a browse row opens its note as a tab of the active pane of a named Focus and the tab is written to the workspace');

  // 7. A phone shows a list screen and a note screen, never both, and no pane tab bar; tablets show two panes; desktops restore all three.
  await device.setViewport({ width: 412, height: 900 });
  await device.goto(`${base}/notebooks/work?view=list&focus=${focusId}`, { waitUntil: 'domcontentloaded' });
  await waitRow(device, 'Alpha');
  assert(!await device.$('.focus-area'), 'The phone list screen does not show the Focus');
  assert(!await device.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Horizontal overflow at 412px on the list screen');
  await shot(device, '412');
  await clickRow(device, 'Alpha');
  await device.waitForSelector('.note-editor');
  const visible = selector => device.evaluate(selector => [...document.querySelectorAll(selector)].some(element => element.getClientRects().length > 0), selector);
  assert(!await visible('.focus-tab, .focus-pane-bar'), 'The phone note screen shows no pane tab bar');
  assert(!await visible('.focus-row, .note-list'), 'The phone note screen does not show the list');
  assert(!await device.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Horizontal overflow at 412px on the note screen');
  await shot(device, '412-note');
  const widths = { 900: [['Alpha', 'Gamma', 'Zeta'], ['Beta', 'Epsilon', 'Delta']], 1440: [['Alpha', 'Gamma', 'Zeta'], ['Beta', 'Epsilon'], ['Delta']] };
  for (const [width, panes] of Object.entries(widths)) {
    await device.setViewport({ width: Number(width), height: 900 });
    await device.goto(`${base}/notebooks/work?view=list&focus=${focusId}`, { waitUntil: 'domcontentloaded' });
    await device.waitForSelector('.focus-area');
    assert.equal(await paneCount(device), panes.length, `${width}px shows ${panes.length} panes`);
    const displayed = await device.$$eval('[data-focus-pane]', elements => elements.map(element => Number(element.dataset.focusPane.slice(1)) - 1));
    for (const [index, labels] of panes.entries()) await waitTabs(device, displayed[index], labels);
    assert(!await device.evaluate(() => document.documentElement.scrollWidth > innerWidth), `Horizontal overflow at ${width}px`);
    await shot(device, `${width}`);
  }
  console.log('PASS 7 a phone shows a list screen and a note screen without a pane tab bar, tablets fold panes for display only and desktops restore every pane');

  // 7a. A merged displayed pane (narrow screens folding several stored panes into one tab bar) keeps a duplicate
  // tab per stored pane when they share a note, marks only the shown one, and closes only the one touched.
  await device.setViewport({ width: 1440, height: 900 });
  const shownBefore7a = await shownTab(device, 1), activeBefore7a = await activePane(device);
  await dragTo(device, await tabHandle(device, 2, 'Delta'), '[data-focus-pane="p2"] .focus-pane-body', { shift: true });
  await waitTabs(device, 1, ['Beta', 'Epsilon', 'Delta']);
  await waitTabs(device, 2, ['Delta']);
  // A drag only copies the tab: the target pane keeps showing its note and the active pane stays.
  assert.equal(await shownTab(device, 1), shownBefore7a);
  assert.equal(await activePane(device), activeBefore7a);
  await clickTab(device, 2, 'Delta');
  await device.setViewport({ width: 900, height: 900 });
  await device.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 2);
  const merged7a = (await device.$$eval('[data-focus-pane]', elements => elements.map(element => Number(element.dataset.focusPane.slice(1)) - 1)))[1];
  await waitTabs(device, merged7a, ['Beta', 'Epsilon', 'Delta', 'Delta']);
  const deltaPanes = await device.$$eval(`[data-focus-pane="${paneId(merged7a)}"] .focus-tab`, tabs => tabs.filter(tab => tab.querySelector('[role="tab"]').textContent.trim() === 'Delta').map(tab => tab.dataset.pane));
  assert.deepEqual(deltaPanes.sort(), ['p2', 'p3'], 'Each duplicate Delta tab keeps its own stored pane');
  const shownDeltaCount = await device.$$eval(`[data-focus-pane="${paneId(merged7a)}"] .focus-tab [role="tab"][aria-selected="true"]`, tabs => tabs.filter(tab => tab.textContent.trim() === 'Delta').length);
  assert.equal(shownDeltaCount, 1, 'Only one of the duplicate Delta tabs is marked shown');
  await device.click(`[data-focus-pane="${paneId(merged7a)}"] .focus-tab[data-pane="p2"] [aria-label="Close Delta"]`);
  await waitTabs(device, merged7a, ['Beta', 'Epsilon', 'Delta']);
  console.log('PASS 7a a merged displayed pane keeps a duplicate tab per stored pane and closes only the one touched');
  await device.setViewport({ width: 1440, height: 900 });
  await device.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 3);
  await waitTabs(device, 1, ['Beta', 'Epsilon']);
  await waitTabs(device, 2, ['Delta']);

  // 8. The rest of the contract on the desktop device.
  const focusUrl = `${base}/notebooks/work?view=list&focus=${focusId}`;
  const workFile = name => fs.readFileSync(path.join(root, `notes/work/${name}.md`), 'utf8');
  const waitFile = async (name, text) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (workFile(name).includes(text)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`notes/work/${name}.md does not contain ${text}`);
  };
  // Naming moved the layout out of the Default Focus, which starts empty: with no open note the list fills the page.
  await page.goto(`${base}/notebooks/work?view=list&focus=current`, { waitUntil: 'domcontentloaded' });
  await waitRow(page, 'Alpha');
  assert(!await page.$('.focus-area'), 'An empty Default Focus shows the notes list in full, not a Focus');
  console.log('PASS 8 the Default Focus is empty after naming and its notes list fills the page');

  // A note edited in zoom reopens in a pane with the saved text, not an earlier cached copy.
  await clickRow(page, 'Alpha');
  await page.waitForSelector('[data-focus-pane="p1"] .note-editor[data-frame="pane"] .cm-content');
  await page.click('[data-focus-pane="p1"] [aria-label="Close Alpha"]');
  await page.waitForFunction(() => !document.querySelector('[data-focus-pane="p1"] .focus-tab'));
  await (await (await browseRow(page, 'Alpha')).asElement().$('[aria-label="Open in zoom"]')).click();
  await page.waitForSelector('.note-editor[data-frame="zoom"] .cm-content');
  await clickEnd(page, '.note-editor[data-frame="zoom"]', 'Alpha body.');
  await page.keyboard.type(' saved in zoom');
  await waitFile('alpha', 'Alpha body. saved in zoom');
  await page.click('[aria-label="Close note"]');
  await page.waitForFunction(() => !document.querySelector('.note-editor[data-frame="zoom"]'));
  await clickRow(page, 'Alpha');
  await page.waitForFunction(() => document.querySelector('[data-focus-pane="p1"] .note-editor[data-frame="pane"] .cm-content')?.textContent.includes('saved in zoom'), { timeout: 5000 });
  console.log('PASS 8 a pane reopens a note with the text saved in zoom');

  // Batch add fills a pane from a folder or a tag filter, deduplicated against what it already holds.
  await page.click('[data-focus-pane="p1"] [aria-label="Pane actions"]');
  await menuItem(page, 'Add matching');
  await page.waitForSelector('.focus-batch-dialog');
  await page.click('.focus-batch-dialog .screen-form > .filter-check input[type="checkbox"]');
  await chooseSelect(page, '.focus-batch-folder .select-trigger', 'notes/work/sub');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog .filter-results')?.textContent.includes('1 matching'));
  await page.click('.focus-batch-dialog button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog [role="status"]')?.textContent.includes('1 added, 0 already present'));
  await page.click('.focus-batch-dialog button[type="button"]');
  await page.waitForFunction(() => !document.querySelector('.focus-batch-dialog'));
  await waitTabs(page, 0, ['Alpha', 'Omega']);
  console.log('PASS 8i batch add by folder with subfolders excluded adds only its direct notes');

  await page.click('[data-focus-pane="p1"] [aria-label="Pane actions"]');
  await menuItem(page, 'Add matching');
  await page.waitForSelector('.focus-batch-dialog');
  await chooseSelect(page, '.focus-batch-folder .select-trigger', 'notes/work/sub');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog .filter-results')?.textContent.includes('2 matching'));
  await page.click('.focus-batch-dialog button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog [role="status"]')?.textContent.includes('1 added, 1 already present'));
  await page.click('.focus-batch-dialog button[type="button"]');
  await page.waitForFunction(() => !document.querySelector('.focus-batch-dialog'));
  await waitTabs(page, 0, ['Alpha', 'Omega', 'Deep']);
  console.log('PASS 8j batch add by folder including subfolders adds the nested note, skipping what is already present');

  await page.click('[data-focus-pane="p1"] [aria-label="Pane actions"]');
  await menuItem(page, 'Add matching');
  await page.waitForSelector('.focus-batch-dialog');
  await clickTagOption(page, 'project');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog .filter-results')?.textContent.includes('3 matching'));
  await page.click('.focus-batch-dialog button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog [role="status"]')?.textContent.includes('1 added, 2 already present'));
  await page.click('.focus-batch-dialog button[type="button"]');
  await page.waitForFunction(() => !document.querySelector('.focus-batch-dialog'));
  await waitTabs(page, 0, ['Alpha', 'Omega', 'Deep', 'Gamma']);
  console.log('PASS 8k batch add by tag adds every match, reporting what was already present');

  await page.click('[data-focus-pane="p1"] [aria-label="Pane actions"]');
  await menuItem(page, 'Add matching');
  await page.waitForSelector('.focus-batch-dialog');
  await clickTagOption(page, 'project');
  await page.click('.focus-batch-dialog button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog [role="status"]')?.textContent.includes('0 added, 3 already present'));
  await page.click('.focus-batch-dialog button[type="button"]');
  await page.waitForFunction(() => !document.querySelector('.focus-batch-dialog'));
  await waitTabs(page, 0, ['Alpha', 'Omega', 'Deep', 'Gamma']);
  console.log('PASS 8l a repeat batch add over the same filter adds nothing');

  // Local view state follows in another tab of the same browser and survives a reload.
  const twin = await other.newPage();
  twin.on('pageerror', error => errors.push(error.message));
  await twin.setViewport({ width: 1440, height: 900 });
  await twin.goto(focusUrl, { waitUntil: 'domcontentloaded' });
  await twin.waitForSelector('.focus-area');
  // Only the front tab paints; the twin, now behind, is polled on a timer.
  await device.bringToFront();
  await clickTab(device, 1, 'Epsilon');
  await clickTab(device, 2, 'Delta');
  await twin.waitForFunction(() => document.querySelector('[data-focus-pane][data-active]')?.dataset.focusPane === 'p3' && document.querySelector('[data-focus-pane="p2"] [role="tab"][aria-selected="true"]')?.textContent.trim() === 'Epsilon', { polling: 100 });
  await twin.close();
  await device.reload({ waitUntil: 'domcontentloaded' });
  await device.waitForSelector('.focus-area');
  // A tab shows its file name until the note's title has loaded.
  await device.waitForFunction(() => document.querySelector('[data-focus-pane="p2"] .focus-tab [role="tab"][aria-selected="true"]')?.textContent.trim() === 'Epsilon');
  assert.equal(await activePane(device), 2);
  assert.equal(await shownTab(device, 1), 'Epsilon');
  console.log('PASS 8a the active pane and shown tabs follow in another tab and are restored after a reload');

  // A pane editor autosaves; zoom from its tab shares the same editor and returns to the pane.
  const paneEditor = '[data-focus-pane="p3"] .note-editor[data-frame="pane"]';
  await device.waitForSelector(paneEditor);
  await clickEnd(device, paneEditor, 'Delta body.');
  await device.keyboard.type(' typed');
  await waitFile('delta', 'Delta body. typed');
  const editorCount = await device.$$eval('.note-editor', editors => editors.length);
  await device.click('[data-focus-pane="p3"] .focus-pane-actions [aria-label="Pane actions"]');
  await menuItem(device, 'Open in zoom');
  await device.waitForSelector('.note-editor[data-frame="zoom"]');
  assert.equal(await device.$$eval('.note-editor', editors => editors.length), editorCount, 'Zoom must borrow the pane editor');
  assert.equal(await device.$('[data-focus-pane="p3"] .note-editor'), null, 'The pane lends its editor to zoom');
  await device.keyboard.press('Escape');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert(await device.$('.note-editor[data-frame="zoom"]'), 'Esc must not close zoom');
  await clickEnd(device, '.note-editor[data-frame="zoom"]', 'typed');
  await device.keyboard.type(' zoomed');
  await device.click('[aria-label="Close note"]');
  await device.waitForSelector(paneEditor);
  assert(await device.$eval(paneEditor, editor => editor.textContent.includes('typed zoomed')), 'The pane must keep the edit made in zoom');
  assert.equal(new URL(device.url()).searchParams.get('focus'), focusId);
  await waitFile('delta', 'typed zoomed');
  console.log('PASS 8b pane editors autosave and zoom from a tab edits the same session');

  // The rail follows the active pane's note and disables the document tools for a lane tab.
  await device.click('.right-panel-rail [aria-label="Outline"]');
  await device.waitForFunction(() => document.querySelector('.right-panel-document .note-document-panel[data-frame="rail"]')?.textContent.includes('Delta'));
  await device.$eval('.right-panel', panel => Promise.all(panel.getAnimations({ subtree: true }).map(animation => animation.finished)));
  await openCompilation(device, 'Pins');
  await device.waitForFunction(() => document.querySelector('.right-panel-rail [aria-label="Outline"]').disabled && !document.querySelector('.right-panel-document'));
  // The tab is named by its file until the compilation's title has loaded.
  await device.waitForSelector('[aria-label="Close Pins"]');
  await device.click('[aria-label="Close Pins"]');
  await leaveCompilations(device);
  await device.waitForFunction(() => document.querySelector('.right-panel-document .note-document-panel[data-frame="rail"]')?.textContent.includes('Delta'));
  console.log('PASS 8c the rail shows the active note’s document panel and disables it for compilations');

  // Browse rows: a note already open in another pane opens a fresh copy in the active pane, not a jump to it.
  await clickRow(device, 'Beta');
  await waitTabs(device, 2, ['Delta', 'Beta']);
  assert.equal(await activePane(device), 2);
  assert.equal(await shownTab(device, 2), 'Beta');
  await waitTabs(device, 1, ['Beta', 'Epsilon']);
  console.log('PASS 8d a browse row for a note open elsewhere opens a fresh copy in the active pane, not a jump to it');
  // A repeat click for a note already open in the SAME pane switches to it instead of adding another copy.
  // The tab set doesn't change here, so waitTabs alone isn't a signal; wait for the shown tab itself to flip.
  await clickRow(device, 'Delta');
  await device.waitForFunction(pane => document.querySelector(`[data-focus-pane="${pane}"] .focus-tab [role="tab"][aria-selected="true"]`)?.textContent.trim() === 'Delta', { timeout: 5000 }, 'p3').catch(() => assert.fail('Pane 2 did not switch to the already-open Delta tab'));
  await waitTabs(device, 2, ['Delta', 'Beta']);
  assert.equal(await shownTab(device, 2), 'Delta');
  console.log('PASS 8d a repeat click for a note already open in the active pane switches to it without duplicating it');
  // Clean up the pane-2 copy so later panes keep their original contents; the row zoom button leaves the Focus unchanged.
  await device.click('[data-focus-pane="p3"] [aria-label="Close Beta"]');
  await waitTabs(device, 2, ['Delta']);
  // Resting the pointer on a dock row opens its card, which holds Open in zoom.
  const beta = await browseRow(device, 'Beta');
  await beta.asElement().hover();
  const zoomButton = await device.waitForFunction(() => [...document.querySelectorAll('.note-hover-card button')].find(button => button.textContent.trim() === 'Open in zoom'), { timeout: 5000 });
  await zoomButton.asElement().click();
  await device.waitForSelector('.note-editor[data-frame="zoom"]');
  await device.click('[aria-label="Close note"]');
  await device.waitForFunction(() => !document.querySelector('.note-editor[data-frame="zoom"]'));
  await waitTabs(device, 1, ['Beta', 'Epsilon']);
  console.log('PASS 8d the row zoom button leaves the Focus unchanged');

  // Tabs reorder within a pane; the browse panel collapses and expands.
  const shownBefore8e = await shownTab(device, 0), activeBefore8e = await activePane(device);
  await dragTo(device, await tabHandle(device, 0, 'Zeta'), await tabHandle(device, 0, 'Alpha'));
  await waitTabs(device, 0, ['Zeta', 'Alpha', 'Gamma']);
  // Reloading before the reorder is written would read the earlier file.
  for (let attempt = 0; attempt < 50; attempt++) {
    const text = fs.readFileSync(focusFile, 'utf8');
    if (text.indexOf('notes/work/zeta.md') < text.indexOf('notes/work/alpha.md')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // The drag only reordered: the pane still shows its note.
  assert.equal(await shownTab(device, 0), shownBefore8e);
  assert.equal(await activePane(device), activeBefore8e);
  await device.click('[aria-label="Collapse browse panel and header"]');
  await device.waitForSelector('.browse-dock[data-collapsed]');
  await device.waitForFunction(() => !document.querySelector('.header-nav')?.getClientRects().length, { timeout: 5000 }).catch(() => assert.fail('Collapsing the browse region also hides the header'));
  await device.click('[aria-label="Expand browse panel and header"]');
  await device.waitForSelector('.browse-dock:not([data-collapsed])');
  await device.waitForFunction(() => document.querySelector('.header-nav')?.getClientRects().length, { timeout: 5000 });
  console.log('PASS 8e tabs reorder within a pane and the browse panel collapses and expands');

  // Palette commands act on the displayed Focus; Merge all panes folds every pane's tabs into the first.
  await device.goto(focusUrl, { waitUntil: 'domcontentloaded' });
  await device.waitForSelector('.focus-area');
  const before = await activePane(device);
  await palette(device, 'Next pane');
  await device.waitForFunction(before => Number(document.querySelector('[data-focus-pane][data-active]')?.dataset.focusPane.slice(1)) - 1 === (before + 1) % 3, {}, before);
  // Delta, shared by pane 1 and pane 2 ahead of the fold, must survive the fold only once.
  await dragTo(device, await tabHandle(device, 2, 'Delta'), '[data-focus-pane="p2"] .focus-pane-body', { shift: true });
  await waitTabs(device, 1, ['Beta', 'Epsilon', 'Delta']);
  await palette(device, 'Merge all panes');
  await device.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 1);
  await waitTabs(device, 0, ['Zeta', 'Alpha', 'Gamma', 'Beta', 'Epsilon', 'Delta']);
  console.log('PASS 8g1 merging all panes dedupes a note shared by two folded panes, keeping the first occurrence');
  await palette(device, 'Split right');
  await device.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 2);
  await palette(device, 'Split down');
  await device.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 3);
  await waitTabs(device, 0, ['Zeta', 'Alpha', 'Gamma', 'Beta', 'Epsilon', 'Delta']);
  console.log('PASS 8g palette commands move between panes, merge and split without restoring tabs');

  // A pane's tab bar holds only its tabs, the All tabs list and one Pane actions menu; the editor's actions sit in the note row.
  const bar = '[data-focus-pane="p1"] .focus-pane-bar';
  assert.equal(await device.$$eval(`${bar} button:not([role="tab"]):not(.focus-tab-close)`, buttons => buttons.map(button => button.getAttribute('aria-label')).sort().join('|')), 'All tabs in this pane|Pane actions');
  assert(await device.$('[data-focus-pane="p1"] .note-toolbar[data-actions="row"] .note-row'), 'The note row holds the title, status and tags');
  assert(await device.$('[data-focus-pane="p1"] .note-toolbar[data-actions="row"]'), 'The editor actions sit in the note row');
  assert(!await device.$(`${bar} .focus-pane-note-actions`), 'The tab bar holds no editor actions while the note row shows');
  await device.click('[data-focus-pane="p1"] [aria-label="Pane actions"]');
  await device.waitForSelector('.focus-menu [role^="menuitem"]');
  assert.deepEqual(await device.$$eval('.focus-menu [role^="menuitem"]', items => items.map(item => item.textContent.trim())), ['Split right', 'Split down', 'Add matching', 'Open in zoom', 'Hide toolbar']);
  // Hide toolbar hides the note row, and the editor's actions move into the tab bar until it is shown again.
  await menuItem(device, 'Hide toolbar');
  await device.waitForSelector('[data-focus-pane="p1"][data-hide-toolbar], [data-focus-pane="p1"] [data-hide-toolbar]');
  await device.waitForFunction(() => ![...document.querySelectorAll('[data-focus-pane="p1"] .note-row')].some(row => row.getClientRects().length), { timeout: 5000 }).catch(() => assert.fail('Hide toolbar hides the note row'));
  await device.waitForSelector(`${bar} .focus-pane-note-actions *`, { timeout: 5000 }).catch(() => assert.fail('Hide toolbar moves the editor actions into the tab bar'));
  await device.click('[data-focus-pane="p1"] [aria-label="Pane actions"]');
  await menuItem(device, 'Hide toolbar');
  await device.waitForFunction(() => [...document.querySelectorAll('[data-focus-pane="p1"] .note-row')].some(row => row.getClientRects().length), { timeout: 5000 }).catch(() => assert.fail('Showing the toolbar brings the note row back'));
  assert(!await device.$(`${bar} .focus-pane-note-actions *`), 'Showing the toolbar returns the editor actions to the note row');
  console.log('PASS 8m a pane tab bar holds tabs, All tabs and Pane actions; Hide toolbar moves the editor actions into the bar and back');

  // All tabs lists every tab of an overflowing pane, opens on the shown one, closes a tab without closing the list and reorders by drag.
  const shownBeforeList = await shownTab(device, 0);
  await device.click('[data-focus-pane="p1"] [aria-label="All tabs in this pane"]');
  await device.waitForSelector('.focus-tab-list [role="menuitem"]');
  const listed = () => device.$$eval('.focus-tab-list [role="menuitem"]', items => items.map(item => item.querySelector('span').textContent.trim()));
  assert.deepEqual(await listed(), await tabLabels(device, 0));
  await device.waitForFunction(shown => document.activeElement?.dataset.current !== undefined && document.activeElement.textContent.includes(shown), {}, await shownTab(device, 0));
  await device.click('.focus-tab-list [role="menuitem"]:nth-child(4) .focus-tab-list-close');
  await waitTabs(device, 0, ['Zeta', 'Alpha', 'Gamma', 'Epsilon', 'Delta']);
  assert(await device.$('.focus-tab-list'), 'Closing a tab from the list keeps the list open');
  await device.focus('.focus-tab-list [role="menuitem"]:nth-child(4)');
  await device.keyboard.press('Delete');
  await waitTabs(device, 0, ['Zeta', 'Alpha', 'Gamma', 'Delta']);
  assert(await device.$('.focus-tab-list'), 'Delete on a list row closes its tab and keeps the list open');
  await dragTo(device, '.focus-tab-list [role="menuitem"]:nth-child(3)', '.focus-tab-list [role="menuitem"]:nth-child(1)', { at: 'top' });
  await waitTabs(device, 0, ['Gamma', 'Zeta', 'Alpha', 'Delta']);
  assert.equal(await shownTab(device, 0), shownBeforeList, 'Reordering from the list does not change the shown tab');
  assert(await device.$('.focus-tab-list'), 'Reordering keeps the list open');
  await device.click('.focus-tab-list [role="menuitem"]:nth-child(2)');
  await device.waitForFunction(() => !document.querySelector('.focus-tab-list'));
  assert.equal(await shownTab(device, 0), 'Zeta');
  console.log('PASS 8n the All tabs list opens on the shown tab, closes tabs and reorders them without closing, and shows a tab on pick');

  // Rename and delete a named Focus; deleting keeps the notes.
  await device.click('.focus-switcher .select-button-trigger');
  await menuItem(device, 'Rename…');
  await device.waitForSelector('.screen-form input');
  await device.$eval('.screen-form input', input => input.select());
  await device.type('.screen-form input', '月報');
  await device.click('.screen-form button[type="submit"]');
  await saved('月報');
  await device.click('.focus-switcher .select-button-trigger');
  await menuItem(device, 'Delete…');
  const remove = await device.waitForFunction(() => [...document.querySelectorAll('.workspace-dialog-actions button')].find(button => button.textContent.trim() === 'Delete'));
  await remove.asElement().click();
  // Deleting a Focus shows the Default, which is empty here, so the list fills the page.
  await device.waitForFunction(focusId => new URL(location.href).searchParams.get('focus') !== focusId && !document.querySelector('.focus-area'), {}, focusId);
  assert.equal(await device.$eval('.focus-switcher .select-button-primary', button => button.textContent.trim()), 'Default');
  for (let attempt = 0; attempt < 50 && fs.readFileSync(focusFile, 'utf8').includes('月報'); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert(!fs.readFileSync(focusFile, 'utf8').includes('月報'), 'The deleted Focus must leave the Focus file');
  assert(fs.existsSync(path.join(root, 'notes/work/delta.md')), 'Deleting a Focus keeps its notes');
  console.log('PASS 8h a named Focus renames and deletes without touching its notes');
} catch (error) {
  if (page) await shot(page, 'failure').catch(() => {});
  if (device) await shot(device, 'failure-device').catch(() => {});
  throw error;
} finally {
  await browser.close();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
