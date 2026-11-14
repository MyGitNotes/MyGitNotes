import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SUPPORTED_SCHEMA_VERSION } from '../packages/core/dist/config.js';
import { collectPageErrors, createQaWorkspace, launchQaBrowser, product, qaRequire, startQaServer } from './lib/qa-harness.mjs';

// A slide note's `::background` (image with a credit, video, YouTube) and `::qrcode` / `:qrcode`: drawn in a compilation card (the note's preview), in the live editor, and in the played deck, in both themes.
const require = qaRequire();
const { root, write, commitFixture } = createQaWorkspace('github-notes-slide-backgrounds-qa-');

/** A bright PNG gradient, so the light text of a background page has to be carried by the scrim. */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = buffer => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) rows.set([200 + Math.round(55 * x / width), 215 + Math.round(40 * y / height), 235], y * (width * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

write('.github-notes.yaml', `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: Slide backgrounds QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n`);
write('notes/example/assets/bg.png', png(640, 360));
write('notes/example/assets/poster.png', png(320, 180));
// A real clip (QA_CLIP=/path/to/clip.mp4) must play; without one the core still adds its video element, then removes it when the file fails to load.
write('notes/example/assets/clip.mp4', process.env.QA_CLIP ? fs.readFileSync(process.env.QA_CLIP) : Buffer.from('not a video'));
write('notes/example/deck.md', `---
title: Background QA
type: slide
slideOptions:
  structure: headings
---

## Image background

::background{image="assets/bg.png" dim=0.55 credit="Photo: QA, CC BY-SA 4.0"}

Text on the picture, with \`code\` and [a link](https://example.com).

:::info
A callout on the picture.
:::

::qrcode{url="https://example.com/talk?x=1" size="160"}

## Video background

::background{video="assets/clip.mp4" poster="assets/poster.png" dim=0.6}

A page with a video file behind it.

## YouTube background

::background{youtube="https://www.youtube.com/watch?v=dQw4w9WgXcQ" start=30 poster="assets/poster.png"}

A page with a YouTube video behind it.

## No background

Scan :qrcode{url="https://example.com/inline" size="140"} here, and :qrcode{size="90"} has no address.
`);
write('notes/example/deckview.compilation.yml', 'version: 1\nid: deckview\ntitle: Deck view\narrangement: lane\nsize: medium\nitems:\n  - id: pin-deck\n    kind: note\n    path: notes/example/deck.md\n');
commitFixture();

const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const shots = process.env.QA_SHOTS || path.join(product, 'artifacts/qa/slide-backgrounds');
fs.mkdirSync(shots, { recursive: true });
const page = await browser.newPage();
const errors = collectPageErrors(page);
page.on('response', response => response.status() >= 400 && !response.url().endsWith('/api/pi/session') && console.log('http', response.status(), response.url()));
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
const shot = name => page.screenshot({ path: path.join(shots, `${name}.png`) });
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);

    // The note's preview: a compilation card draws the slide note with `renderNote(…, { slides: 'preview' })`.
    await page.goto(`${base}/notebooks/example/notes/deckview.compilation.yml`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.screen-card [data-markdown-view] figure.slide-background', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.screen-card .qrcode-container[data-qrcode-rendered] canvas').length === 2, { timeout: 20000 });
    const preview = await page.evaluate(() => {
      const card = document.querySelector('.screen-card');
      const figures = [...card.querySelectorAll('figure.slide-background')];
      const image = figures[0].querySelector('img');
      const canvases = [...card.querySelectorAll('.qrcode-container canvas')].map(canvas => ({ width: canvas.width, link: canvas.closest('a')?.getAttribute('href'), block: !!canvas.closest('.qrcode-block'), visible: canvas.getBoundingClientRect().width }));
      return { figures: figures.length, kinds: figures.map(figure => figure.querySelector('.slide-background-kind')?.textContent ?? null), credit: figures[0].querySelector('.slide-background-credit')?.textContent, imageLoaded: image.complete && image.naturalWidth > 0, imageSrc: image.getAttribute('src'), canvases, video: card.querySelectorAll('video, iframe').length, inlineEmpty: [...card.querySelectorAll('[data-qrcode=""]')].map(element => element.textContent) };
    });
    console.log(scheme, 'preview', JSON.stringify(preview));
    assert.equal(preview.figures, 3);
    assert.deepEqual(preview.kinds, [null, 'Video', 'YouTube']);
    assert.equal(preview.credit, 'Photo: QA, CC BY-SA 4.0');
    assert.ok(preview.imageLoaded && preview.imageSrc.startsWith('/raw-assets/'), 'the still loads from the notebook');
    assert.deepEqual(preview.canvases.map(canvas => [canvas.width, canvas.link, canvas.block]), [[160, 'https://example.com/talk?x=1', true], [140, 'https://example.com/inline', false]]);
    assert.equal(preview.video, 0);
    assert.deepEqual(preview.inlineEmpty, ['QR Code']);
    await shot(`${scheme}-preview`);

    // The live editor draws the slide directive line as the preview does.
    await page.goto(`${base}/notebooks/example/notes/deck.md`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.live-md-slide-directive figure.slide-background', { timeout: 20000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.live-md-slide-directive figure.slide-background img')].every(image => image.complete && image.naturalWidth > 0));
    await shot(`${scheme}-editor`);

    // Played: the deck opens on its outline; a slide's thumbnail opens it on the stage.
    await page.click('button[aria-label="Play"]');
    // The core adds the media of a page when it becomes current and removes it when it stops, or when a file fails to load: record what it adds.
    await page.evaluate(() => {
      window.__bgm = [];
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('ct-bgm')) window.__bgm.push({ tag: node.tagName, src: node.getAttribute('src') ?? '', page: node.closest('[data-ct-page]')?.querySelector('h2')?.textContent });
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.waitForSelector('.ct-app .ct-thumb', { timeout: 30000 });
    await shot(`${scheme}-deck-outline`);
    assert.equal((await page.$$('.ct-app .ct-thumb')).length, 4);
    const titles = ['Image background', 'Video background', 'YouTube background', 'No background'];
    for (const [index, name] of ['image', 'video', 'youtube', 'plain'].entries()) {
      // The first thumbnail opens the stage; the arrow keys then move to the next slide, which has no steps to reveal.
      if (index === 0) await (await page.$$('.ct-app .ct-thumb'))[0].click();
      else await page.keyboard.press('ArrowRight');
      await page.waitForFunction(title => document.querySelector('.ct-stage [data-ct-page][data-ct-current] h2')?.textContent === title, { timeout: 10000 }, titles[index]);
      await settle(1200);
      const state = await page.evaluate(() => {
        const stage = document.querySelector('.ct-stage');
        const current = stage.querySelector('[data-ct-page][data-ct-current]');
        const background = current.querySelector(':scope > [data-ct-background]');
        const heading = current.querySelector('h2, h1');
        const still = background?.querySelector('img');
        const stageBox = stage.getBoundingClientRect(), stillBox = still?.getBoundingClientRect();
        const canvas = current.querySelector('canvas.qrcode-canvas');
        return {
          title: heading?.textContent,
          hasBackground: !!background,
          color: heading ? getComputedStyle(heading).color : null,
          text: current.querySelector('p') ? getComputedStyle(current.querySelector('p')).color : null,
          still: still ? { loaded: still.complete && still.naturalWidth > 0, border: getComputedStyle(still).borderTopWidth, radius: getComputedStyle(still).borderTopLeftRadius, fit: getComputedStyle(still).objectFit, cursor: getComputedStyle(still).cursor, coversStage: stillBox.width >= stageBox.width - 2 && stillBox.height >= stageBox.height - 2, role: still.getAttribute('role') } : null,
          credit: background?.querySelector('[data-ct-credit]')?.textContent ?? null,
          media: window.__bgm.map(media => `${media.tag} ${media.src.slice(0, 80)} on ${media.page}`),
          playing: !!current.querySelector('[data-ct-background] > .ct-bgm[data-ct-playing]'),
          bgAttrs: background ? ['data-video', 'data-youtube', 'data-start', 'style'].map(name => background.getAttribute(name)) : null,
          canvas: canvas ? { width: canvas.width, link: canvas.closest('a')?.getAttribute('href') } : null,
          calloutBg: current.querySelector('.custom-directive') ? getComputedStyle(current.querySelector('.custom-directive')).backgroundColor : null,
          otherMedia: [...stage.querySelectorAll('.ct-bgm')].length,
        };
      });
      console.log(scheme, 'deck', name, JSON.stringify(state));
      await shot(`${scheme}-deck-${name}`);
      if (name === 'image') {
        assert.ok(state.hasBackground && state.still.loaded && state.still.coversStage && state.still.border === '0px' && state.still.fit === 'cover', 'the still fills the stage, unframed');
        assert.equal(state.credit, 'Photo: QA, CC BY-SA 4.0');
        const light = color => color.match(/\d+/g).slice(0, 3).every(channel => Number(channel) > 200);
        assert.ok(light(state.color) && light(state.text), `text reads light on a background page: ${state.color} ${state.text}`);
        assert.deepEqual(state.canvas, { width: 160, link: 'https://example.com/talk?x=1' });
        assert.deepEqual(state.media, [], 'an image background plays nothing');
      }
      if (name === 'video') {
        assert.equal(state.media.length, 1, `one medium added so far: ${state.media}`);
        assert.ok(state.media[0].startsWith('VIDEO /raw-assets/notes/example/assets/clip.mp4') && state.media[0].endsWith('on Video background'), `the video of the current page: ${state.media}`);
        if (process.env.QA_CLIP) {
          assert.ok(state.playing && state.otherMedia === 1, 'the clip plays on the current page only');
          assert.ok(await page.$('.ct-stage [data-ct-current] [data-ct-background] > img'), 'the still stays under the video');
        }
      }
      if (name === 'youtube') {
        const frame = state.media.at(-1);
        assert.ok(frame.startsWith('IFRAME https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ') && frame.endsWith('on YouTube background'), `the YouTube frame of the current page: ${frame}`);
        assert.equal(state.otherMedia, 1, 'only the current page holds media');
      }
      if (name === 'plain') {
        assert.equal(state.hasBackground, false);
        assert.deepEqual(state.canvas, { width: 140, link: 'https://example.com/inline' });
        assert.equal(state.otherMedia, 0);
      }
    }
    // The close button leaves the deck for the note.
    await page.click('.ct-app button[aria-label="Leave the slides"]');
    await page.waitForFunction(() => !document.querySelector('.ct-app'), { timeout: 10000 });
  }
  assert.deepEqual(errors, [], 'no page errors');
  console.log('PASS slide backgrounds and QR codes');
} finally {
  await browser.close();
  server.close();
}
