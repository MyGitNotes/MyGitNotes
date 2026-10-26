Status: accepted (owner 2026-10-26: all eight recommendations)
Date: 2026-10-26
Builds on: [image annotations](../2026-10-25-image-annotations/spec.md) (phase 1, approved 2026-10-25) and its [decisions](../2026-10-25-image-annotations/decision.md).

# PDF annotations (phase 2 of `:::annotate`)

A note can hold review comments on the pages of a PDF the way phase 1 holds them on an image: a click drops a numbered pin on a page, a drag frames a region, each carries a Markdown comment and can be resolved. Everything phase 1 decided stays: the block is note text, rows are one line each, ids are stable, percentages are written with `%`, problems are shown and never dropped, every edit rewrites one row. Phase 2 adds three things: a media line that names a PDF, a `page=N` word on every row, and a page viewer that loads pdf.js only when a PDF figure is on screen.

Code and paths below are read at community `7dbcf900` (0.13.3) and Pro `81129c3` (0.18.1). pdf.js facts are read from the `pdfjs-dist@6.4.299` package itself (latest stable on 2026-10-26).

## Syntax

```markdown
:::annotate[合約草稿 v2 審閱]
[合約草稿 v2.pdf](/raw-assets/by-hash/9c1e0d2b7a4f5e6d8c3b2a1f0e9d8c7b6a5f4e3d)

- {#1 region x=12% y=18.5% w=76% h=9% page=1 by=alice} 甲方名稱與統編要和用印頁一致。
- {#2 pin x=63% y=41% page=3} 第 5 條違約金比例請法務確認。
- {#3 pin x=20% y=88% page=3 resolved by=bob} 頁尾日期格式已改。
:::
```

### Media line

- The first non-blank body line is either an inline image (phase 1, an image figure) or an **inline link** `[label](src "title")`, which makes the block a **PDF figure**. The syntax decides the kind, not the file name, because the file picker's default ref `/raw-assets/by-hash/<40 hex>` has no extension.
- `src` takes every ref a note link takes that can name a file: a relative or repository-rooted path, `/raw-assets/<path>`, `/raw-assets/by-hash/<hash>` (the picker's default, which pins the version), `r2:<key>`, or an `https:` URL. The label is the figure's accessible name when the block has no title.
- A link is the right Markdown for a PDF: GitHub, an editor without the directive, and the AI all show a working link to the file, where `![…](x.pdf)` is a broken image. Link relocation already rewrites links in a block body, so file and note moves need nothing new.
- Block errors added: a reference-style link, a line holding anything besides the one link, an image and a link both. `![label](….pdf)` whose src ends in `.pdf` is a block error with the hint "write a PDF as a link, [name](path)"; the editor's entry points write the link form, so the error only meets hand-written text.
- Whether the file really is a PDF is known only when it loads; a link to something else shows the stage error "not a PDF" and keeps the list (see Rendering).

### Rows

The phase-1 grammar with `page` taken out of reserve:

```
pdf row  = "- {" "#" id SP kind *(SP token) "}" …     (as phase 1)
page     = "page=" positive integer, 1-based, no "%"    required on every row of a PDF block
```

- `page` counts pages from the start of the file, 1 for the first; it is not the printed page label ("iv", "12"). The viewer may show the label beside the number later; the syntax never stores it.
- `x y w h` are percentages of the page **as pdf.js displays it at rotation 0**: the page's CropBox with the page's own `/Rotate` applied, top-left origin. A landscape scan stored rotated reads the way a person sees it.
- New row problems: `missing-key` with detail `page` (a PDF row without `page`), `invalid-page` (`page=0`, `page=2.5`, `page=3%`), and the existing `duplicate-key` for a repeated `page`. `page-on-image` keeps its meaning. A row whose page is missing or invalid stays in the list without a marker.
- `page-beyond-end` (row `page=14` in a 12-page file) can only be known after loading. It is not a parse problem: the viewer and the Pro renderer add the same problem tag (`span.ann-problem`) to the item once they know the page count, and draw no marker for it.
- Writing order is phase 1's `CANONICAL` (`#id kind x y [w h] [page] [resolved] [by]`), already in `edit.ts`; `addRow` writes `page=` and `setGeometry` never touches it. Moving an annotation to another page is a Markdown edit of that one word (no drag across pages).
- Ids are per block, not per page: "pin 2" is unique in the review, as in Figma.

## Rendering

### Static HTML (`renderAnnotate`, a contract like phase 1)

```html
<figure class="ann-figure ann-pdf" data-type="annotate" id="ann-7" aria-label="合約草稿 v2 審閱">
  <figcaption class="ann-caption">… <span class="ann-counts">2 open · 1 resolved</span>
    <a class="ann-open" href="…pdf">Open PDF</a></figcaption>
  <div class="ann-body">
    <div class="ann-pages">
      <section class="ann-page ann-p-1" id="ann-7-p1" aria-label="Page 1">
        <div class="ann-stage"><svg class="ann-overlay" aria-label="Annotations on page 1">…markers of page 1…</svg></div>
      </section>
      <section class="ann-page ann-p-3 is-resolved-only?" id="ann-7-p3" aria-label="Page 3">…</section>
    </div>
    <div class="ann-side">
      <ol class="ann-list" aria-label="Open annotations">
        <li id="ann-7-1" class="ann-item ann-region ann-n-1"><a class="ann-ref" href="#ann-7-1-m">1</a>
          <a class="ann-page-ref" href="#ann-7-p1">p. 1</a><span class="ann-kind">Region</span>…</li>
      </ol>
      <details class="ann-resolved">…</details>
    </div>
  </div>
</figure>
```

- One `section.ann-page` per page that has at least one row with geometry, ascending. Markers are phase 1's, inside their page's overlay. A page whose rows are all resolved gets `is-resolved-only` and is hidden with the resolved markers by the same CSS-only rule (`.ann-figure:has(.ann-resolved:not([open])) .ann-page.is-resolved-only { display: none }`).
- The stage holds no image in the static HTML: the app puts a canvas in it, print and Pro put an `<img>` of the page in it. Until then `.ann-pdf .ann-stage:not(:has(canvas, img))` keeps an A4 placeholder box (`aspect-ratio: 1 / 1.414`) so a page does not collapse.
- The list keeps phase 1's open and resolved groups. Inside each group items are ordered **by page, then source order**, and each carries `a.ann-page-ref` ("p. 3", localised). The source order is untouched.
- Still no inline style and no data attribute besides `data-type`; the page number lives in the class `ann-p-<n>` and the section id. Pro's sanitiser and URI rule already pass every element and attribute above (`section`, `a href="#…"`).
- `renderNote` resolves `a.ann-open` like any workspace link (it stays the figure's one workspace link); the viewer and the print step read the PDF address from it through the same rule `resolveStageImage` uses for an image, extracted into one function (`annotationMediaUrl`) so the two cannot drift.

### The page viewer in the app

- **One page at a time.** The hydrated figure becomes a pager: the current page's section is shown, the others get `hidden`. A page without annotations gets a section when someone navigates to it. A pager bar over the stage: "‹  Page 3 of 12  ›", a page number field, and chips for the pages that carry annotations ("p. 1 · 1", "p. 3 · 2"); open pages and resolved-only pages are told apart by text, not colour. Keyboard on the focused stage: PageUp/PageDown, Home/End. The figure opens on the first page with an open annotation, else page 1; the page survives every redraw (keyed like the selection).
- **Navigation from the list.** `linking.ts`'s `jump` dispatches a bubbling `annotation:reveal` event on its target before it scrolls; the PDF figure's listener shows the target's page at once (the section already has its size, see below) and the scroll and `is-flash` happen as today. A page chip and `a.ann-page-ref` do the same for a whole page. Without script the `#` links still land on the page section, where every annotated page is shown.
- **Canvas only, no text layer.** The page is drawn to a `<canvas>` at stage width × devicePixelRatio, capped at 16.7 million pixels; it is redrawn when the stage width changes (ResizeObserver) and, on phones, when the visual viewport is pinch-zoomed (up to the cap), so zoomed text is sharp. A redraw paints into a new canvas and swaps it in, so the page never flashes blank; a page change cancels the running RenderTask. pdf.js draws the PDF's own annotation appearances (highlights a reviewer made in Acrobat) into the canvas; its AnnotationLayer (clickable links, forms) and TextLayer are not used.
- **Sizes before drawing.** Each page's aspect (from `getViewport`) is cached per document address, so a redraw or a page switch sizes the stage before the canvas exists, and the live widget reports its height as phase 1 does.
- **States.** Loading: the placeholder box with "Loading PDF…" and, past 1 MB, the percent from pdf.js's progress. Errors replace the stage with an `.ann-error`-style box inside the figure and keep the list: `not-found` (404), `not-pdf` (InvalidPDFException), `password` ("This PDF is password-protected; annotate an unprotected copy"; no password prompt), `load-failed` (network; for an `r2:` file the text adds that the bucket's CORS must allow GET from this site, which the deploy docs already require for uploads).
- **Documents are shared.** A module keeps one `PDFDocumentProxy` per address with a reference count, so two figures of the same PDF load it once. A document nobody holds is kept for 30 seconds (at most two such documents; the one released longest ago goes first) and then destroyed, so a redraw of the note, a widget rebuild or Show resolved, which release a figure and acquire it again in the same turn, reuse it instead of fetching and parsing the file again; a figure that is hydrated again also takes the page shapes it last drew, so its placeholder keeps its height. One PDFWorker serves the page: every document is opened on it (`worker` option of `getDocument`).

### pdf.js: version, build, cost

- **Dependency:** `pdfjs-dist@6.4.299` (Apache-2.0), latest stable today. Only one module, `lib/pdf/pdf-document.ts`, imports it; everything else talks to that module's small interface (open, page count, page size, draw page into canvas, typed `PdfLoadError` with a code). This keeps pdf.js replaceable and lets tests fake it.
- **Build:** the **legacy** build (`pdfjs-dist/legacy/build/pdf.min.mjs`). The modern build calls `Map.prototype.getOrInsertComputed`, `Math.sumPrecise` and `Uint8Array.fromBase64` without fallbacks (read in `build/pdf.mjs`), which older iOS Safari lacks; the legacy build costs about 20 KB more per file gzipped.

| Piece | When it loads | Size (gzip unless noted) |
|---|---|---|
| `pdf.min.mjs` (legacy) | first PDF figure on screen, lazy `import()` | 151 KB |
| `pdf.worker.min.mjs` (legacy) | same moment, as a module worker from the app origin | 392 KB |
| `wasm/` openjpeg, jbig2, qcms | only for JPEG 2000, JBIG2 or ICC-colour images | 104–251 KB each, raw |
| `cmaps/` | only for CJK text without embedded fonts, one file per encoding | about 50 KB per file, raw |
| `iccs/` | only for CMYK images, one small profile | 8 KB, raw |
| `standard_fonts/` | only for the 14 standard fonts when not embedded | 17–162 KB per file, raw |

- A note without a PDF figure loads none of this; the app bundle does not grow. The service worker keeps lazy chunks only once fetched (`pwa/service-worker-plugin.ts`), so nothing is precached.
- **Static files:** a Vite plugin `pdfAssetsPlugin()` beside `serviceWorkerPlugin` in `apps/web/pwa/` copies `cmaps/`, `iccs/`, `standard_fonts/` and `wasm/` (without `quickjs-eval.*`, scripting is unused) to `pdfjs/<version>/` in the build output and serves them in dev (a missing file there, and in `vercel.json`'s rewrite and the local server, answers 404 and never the app's `index.html`); both the community and Pro web configs use it. `getDocument` gets `cMapUrl`, `iccUrl`, `standardFontDataUrl`, `wasmUrl` from that path and `enableXfa: false`. `THIRD_PARTY_NOTICES.md` gains pdf.js, Foxit and Liberation fonts, OpenJPEG, JBIG2 and qcms.
- **Fetching:** hosted `/raw-assets` sends the whole file (at most 3 MiB, the upload limit) with `no-store`; local mode's `sendFile` serves ranges; `r2:` goes through `/r2-assets` → 302 to a presigned URL, which pdf.js fetches with CORS (range requests work when the bucket exposes `Content-Range`, otherwise pdf.js downloads the whole file). No server change is required for phase 2. A by-hash response could be marked immutable later; that is a separate change.
- **Security:** pdf.js is built for untrusted files and runs its parser in the worker. Scripting, XFA, forms and the annotation layer stay off; the version is ≥ 4.2.67, past CVE-2024-4367.

### Print

`renderPrintableNote` (which already awaits Mermaid) gains `renderPdfPageImages(root)`: each annotated page is drawn once at 2× print width and put in its stage as a PNG `<img>`, so the print document needs no script. At most 30 pages per figure; past that the figure prints its list and a line saying the pages were left out. `note-export.ts`'s print CSS gains the page rules.

### Read surfaces

`NoteHtml` and the surfaces that use it (`StudyLane`, `CompilationCard`, `BookSection`, `NoteEditorHost`, `AgentTranscript`) hydrate PDF figures with a `usePdfFigures` hook next to `useMermaidDiagrams`, through `hydratePdfFigures(root)`, which only imports pdf.js when it finds a `.ann-pdf` figure and starts loading when the figure nears the viewport (IntersectionObserver, 400px margin).

## Editing in the live editor

The phase-1 controller and widget, page-aware. Nothing else changes: one transaction per action, the widget keeps its DOM, a pending annotation is written only with its comment.

- The controller holds the current page; the editing layer sits over the current page's stage, and `pointToPercent` measures that stage. A new pin or region gets `page=<current>`.
- The live canvas survives a redraw as the image does in phase 1: `render()` moves the existing canvas into the new figure's current stage when the address and page are unchanged.
- Selecting an item or marker on another page switches the page first. Deleting selects the neighbour in list order (page, then source).
- Toolbar: "PDF annotations · N open", **Annotate**, **Show resolved (n)**, **Fix numbering**, **Markdown**, **Remove annotations** (the block becomes its link line); the pager bar sits between toolbar and stage.
- Keyboard adds PageUp/PageDown and Home/End on the stage; arrows keep nudging. The stage's accessible description gains the page keys.
- **Entry points.** (1) A line that is only a PDF reference (a link whose path ends in `.pdf`, an `r2:` image or link whose key ends in `.pdf`, which today renders as an iframe preview) shows the **Annotate** button; it wraps the line as `:::annotate\n[label](src)\n:::`, rewriting image syntax to link syntax. (2) The Insert group's **Annotated image** becomes **Annotate image or PDF**: the picker accepts both, and a PDF is inserted as a link.
- **Phones.** The pager bar's buttons are 44px; no swipe between pages, because a horizontal swipe fights page scroll and annotate-mode drags. In annotate mode the stage uses `touch-action: pinch-zoom` instead of phase 1's `none`, so one finger still taps a pin or drags a region while two fingers pinch-zoom with the browser; the viewer redraws sharper after a zoom. A fitted A4 page on a 360px screen has about 4px text, so this zoom is how a phone reviewer reads the page. An in-figure zoom and pan viewer stays out of scope, as in phase 1.

## Pro public pages

The public page has no script and its CSP allows only same-origin images (`PUBLIC_CSP`, `default-src 'none'`), so pdf.js cannot run there. Two steps:

1. **Phase 2a, list only.** `renderPublic` removes `.ann-pages` and the `a.ann-open` href from a PDF figure, keeps the list (page chips become plain text), and adds the notice "The PDF <name> was left out: public pages show images only", the same rule phase 1 uses for a skipped image. `page-style.ts` gains the PDF classes.
2. **Phase 2c, page images (recommended target).** At publish time `renderPublic` reads the PDF through the image copier's sources (repository path, by-hash, `r2:` within the repository prefix), checks the `%PDF-` signature, and draws each annotated page with pdf.js's Node legacy build and `@napi-rs/canvas` (MIT, the canvas pdf.js itself loads in Node, about 37 MB unpacked for linux-x64) to WebP at 1600px wide, copies each through the existing copier (`/_img/<account>/<sha256>.webp`, counted in the 20 MB page budget, each image at most 3 MB), and puts it in its stage as `<img>`. Rows on a page past the end get the `page-beyond-end` tag. Limits: the PDF read is at most 50 MB, at most 20 annotated pages per note, 10 s per page with the render task cancelled after it; past a limit the remaining pages are left out with a notice and their comments stay. The renderer loads lazily like jsdom; `@napi-rs/canvas` and pdf.js's font and cmap folders are kept outside the esbuild bundle and listed in `vercel.json` `includeFiles`. A spike measures cold start and per-page time on Vercel before the work is committed to.

The PDF file itself is not published either way: public pages carry images only, and a whole contract on a public page is more than the annotated pages show.

## Storage and size limits

| Where | Limit | Source |
|---|---|---|
| Repository upload (hosted, Files page, MCP) | 3 MiB per file | `ASSET_SIZE_LIMIT`, unchanged |
| Bucket (`r2:`) | none from the app | deploy docs |
| App viewer | no hard cap; progress shown past 1 MB; canvas ≤ 16.7 MP | this spec |
| Print | 30 annotated pages per figure | this spec |
| Pro page images | PDF read ≤ 50 MB, ≤ 20 pages per note, 10 s per page, images in the 20 MB page budget, ≤ 3 MB each | this spec and `images.ts` |

Annotations add only text to the note.

## i18n

New keys under the existing `imageAnnotation.*` namespace (renaming it would churn every phase-1 key; `docs/CONTEXT.md` gains the term **PDF 標註** beside 圖片標註): `render.openPdf`, `render.page` ("Page {page}" / 「第 {page} 頁」), `render.pageRef` ("p. {page}" / 「第 {page} 頁」), `render.overlayPage`, `render.problem.invalid-page`, `render.problem.page-beyond-end` ("Page {detail} is past the end ({count} pages)" / 「第 {detail} 頁超出這份 PDF 的頁數（共 {count} 頁）」), `render.problem.pdf-image-syntax`, `pdf.loading`, `pdf.progress`, `pdf.error.not-found`, `pdf.error.not-pdf`, `pdf.error.password`, `pdf.error.load-failed`, `pdf.error.load-failed-r2`, `editor.badgePdf`, `editor.pager`, `editor.pageOf`, `editor.previousPage`, `editor.nextPage`, `editor.goToPage`, `editor.stagePdf`, `insert` relabelled. Pro's server render passes `language` as phase 1 does.

## Accessibility

The list stays the primary representation and now names the page of every item. The pager is a `nav` labelled "Pages of <name>" with real buttons; the page field is a labelled number input; page chips state their counts in text. The canvas has `role="img"` and `aria-label` "Page 3 of 12 of <name>"; its text is not exposed (no text layer), so **Open PDF** stays in the caption for reading the document with the browser's own viewer or a screen reader. A page change is announced in a polite live region. Focus rings, 44px targets, reduced motion and the stacked narrow layout follow phase 1.

## Other surfaces

History, compare, demo mode and drafts: text, as in phase 1. AI and MCP: the workspace skill (`docs/agent/product/skills/github-notes-workspace/SKILL.md`) gains the PDF form and `page=`; an agent can place rows only if it can see the page, and no page-rendering MCP tool is part of this phase. Compilation asset cards and the Files page show no annotations.

## Tests

- `lib/annotations/parse.test.ts`: link media → PDF figure; reference link, extra text, `![…](x.pdf)` → block errors; `page` missing, `0`, `2.5`, `3%`, repeated; `page` on an image still `page-on-image`.
- `lib/annotations/edit.test.ts`: `addRow` writes `page=` in canonical place; `setGeometry`, `setResolved`, `setComment` keep `page` and every other byte; `removeAnnotations` leaves the link line.
- `lib/annotations/render.test.ts`: the HTML contract above (sections ascending, `ann-p-<n>`, `is-resolved-only`, list order by page, `ann-page-ref`), passing the app's DOMPurify config.
- `lib/pdf/pdf-document.test.ts` under Node with real fixtures in `lib/annotations/fixtures/pdf/`: two pages of different sizes, a page with `/Rotate 90`, CJK text with a non-embedded font, encrypted, truncated, and a PNG named `.pdf`; page counts, rotated sizes and error codes.
- `lib/annotations/pdf-figure.test.ts` with `pdf-document` faked: pager state, reveal from the list, `page-beyond-end` tag, shared document refcount, error boxes.
- `components/LiveMarkdownAnnotate.pdf.test.tsx`: pin and region on page 2 write `page=2`, the canvas survives a redraw, PageDown, selecting an item on another page, entry-point rewrite of `![x](r2:a.pdf)`.
- `lib/note-export.test.ts`: print puts page images in stages and stops at 30 pages.
- `scripts/qa-pdf-annotate.mjs` (the puppeteer harness): real rendering on desktop and a 390×844 phone viewport, tap a pin, drag a region, pinch-zoom redraw, print preview.
- Pro `tests/public-render.test.ts`: 2a strips stages and keeps the list with a notice; 2c places WebP pages, budget and page limits, a non-PDF file, `page-beyond-end`.

## Phased plan

| Phase | Ships | Depends on |
|---|---|---|
| 2a | Syntax, static HTML, viewer in every read surface and the live widget (read only), print pages, Pro list-only fallback, i18n, skill and CONTEXT docs | none |
| 2b | Editing: page-aware controller, pager keys, entry points, phone pinch-zoom | 2a |
| 2c | Pro page images (spike first: cold start, per-page time, bundle on Vercel) | 2a; owner decision 1 |

Each phase is one change-set with its own review; 2a touches the rendering contract with Pro, so it gets a fresh reviewer.

## Decisions for the owner

| # | Question | Recommendation | Why |
|---|---|---|---|
| 1 | What does a Pro public page show for a PDF figure? | Page images of the annotated pages, rendered at publish (2c); list only with a notice until then (2a) | Same reading as in the app with no script on the page; costs a native canvas dependency in the publish function, so a spike decides it |
| 2 | Publish the PDF file itself on public pages? | No | Public pages carry images only; the whole file shows more than the review does |
| 3 | Media line for a PDF | A Markdown link `[name](src)` | Works in every other renderer, needs no extension sniffing, already planned in phase 1 |
| 4 | How the app shows pages | One page at a time with a pager and page chips | A 40-page PDF does not turn the note into 40 screens; matches the one-stage figure |
| 5 | Text layer (selectable text) | None | A drag frames a region; selection would fight it; Open PDF covers reading |
| 6 | pdf.js build | Legacy build | Runs on older iOS Safari for about 20 KB more |
| 7 | List order in a PDF figure | By page, then source order | A reviewer reads page by page; source stays append order |
| 8 | Zoom on phones | Browser pinch-zoom with sharper redraw | A full zoom and pan viewer is a project of its own; phase 1 left zoom out too |

## Out of scope

Text-anchored annotations (quote the text under a region), moving an annotation across pages by drag, thumbnails of every page, page labels in the syntax, reply threads, a PDF-page MCP tool, annotations on Files-page assets, server changes to `/raw-assets` caching.
