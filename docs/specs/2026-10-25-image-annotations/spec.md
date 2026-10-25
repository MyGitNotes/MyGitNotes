Status: approved
Approved at: 2026-10-25
Approved from: the owner accepted every default of the design's decision table (see [decision.md](decision.md)).

# Image annotations (`:::annotate`)

A note can hold review comments on an image the way Figma comments or Markup.io do: a click drops a numbered pin, a drag frames a rectangular region, and each carries a Markdown comment and can be marked resolved. The annotations are text in the note, so drafts, commits, version history, demo mode and public pages cover them, and AI tools read and write them as plain Markdown. Images only; PDF pages are a later phase that needs no migration.

## Syntax

```markdown
:::annotate[首頁 v3 設計審閱]
![首頁 v3](/raw-assets/by-hash/3f2a9c0d6b1e4f5a8c7d2e9b0a1f3c4d5e6f7a8b)

- {#1 pin x=41.2% y=23.3%} Logo 太小，和導覽列的基線沒有對齊。
- {#2 region x=8% y=61.5% w=35% h=12% by=alice} CTA 對比不足，改用主色。
  hover 狀態也一起看。
- {#3 pin x=88% y=7% resolved by=bob} 右上角頭像改成圓形。
:::
```

### Block

- The opening fence is `:::annotate` with an optional label `[title]` or `title="…"` (the attribute wins). No other attribute exists; an unknown one is a block error.
- The first non-blank body line is the **media line**: one inline Markdown image `![alt](src "title")`. `src` is any ref a note image takes: a relative or repository-rooted path, `/raw-assets/<path>`, `/raw-assets/by-hash/<40 hex>` (the file picker's default, which pins the version), `r2:<key>`, or an external `https:` URL.
- After a blank line comes an optional list of annotation rows. A block with no rows is valid.
- Anything else is a **block error**: no media line, a reference-style image, two images, a paragraph or heading, a nested container, an unclosed block. The figure error box (`.ann-error`) renders in its place and the rest of the note renders.

The image is a body line, not an attribute, so link relocation (`relocateLinks`, `relocateMovedLinks`) rewrites it when the image or the note moves, `renderNote` and the Pro image copy resolve it, and a renderer that does not know the directive still shows the image and the comments as a list.

### Rows

```
row   = "- {" "#" id SP kind *(SP token) "}" [SP comment-first-line] *(continuation line indented ≥ 2 spaces)
id    = positive integer, unique in the block
kind  = "pin" | "region"
token = key "=" value | "resolved"
pin keys: x y    region keys: x y w h    by = login (quoted when it has spaces)    page = reserved for PDF
value = number "%" (0–100, two decimals read, one written)
```

- Coordinates are percentages of the displayed image from its top-left corner. Constraints: 0 ≤ x, y ≤ 100; w, h > 0; x + w ≤ 100; y + h ≤ 100.
- `resolved` is a bare flag; an open annotation has no flag. `by` is optional: the editor writes the signed-in login when the session has one (hosted) and nothing in local mode or the demo.
- The comment is the item's Markdown: the text after `}` plus indented continuation lines. It may be empty (the list shows "No comment"); the editor never saves an empty new annotation. The editor writes a comment line that is, or ends in, a run of three or more colons with the last colon of that run backslash-escaped (`\:`), and likewise the first colon of a line that would open a container (`\:::note`); Markdown renders both as the colon, and the block can no longer be closed or nested by a comment.
- **Row problems** never hide the figure or drop text. A row with a missing, invalid or duplicate id, a missing or unknown kind, a missing key, a value that is not a percentage or out of range, an unknown or repeated word (`reslved` is surfaced, not ignored), `page=` on an image, or no `{…}` head at all stays in the list with a problem tag naming the cause. Its marker is drawn when its geometry is valid. The editor keeps such rows byte for byte; "Fix numbering" renumbers missing, invalid and duplicate ids only.
- **Stable numbers.** A new annotation takes the block's highest id plus one (problem rows count). Deleting never renumbers. List order is source order; new rows are appended.

### Writing rules (diff-friendly)

An edit rewrites only the range of the row it touches or appends one row. Changing a value replaces that word in place and keeps the order a person wrote; a missing word is added where `#id kind x y [w h] [page] [resolved] [by]` puts it. Moving a pin changes one line, resolving adds or removes one word, a comment is one added line. Untouched rows, comments and blank lines are byte-identical (`apps/web/src/lib/annotations/edit.ts`, unit-tested).

## Rendering

`renderAnnotate(source, { renderMarkdown, strings })` (`apps/web/src/lib/annotations/render.ts`) returns one line of HTML; `transformDirectives` dispatches `annotate` through `renderFigureBlock`. **The structure below is a contract with the Pro public-page stylesheet.**

```html
<figure class="ann-figure" data-type="annotate" id="ann-4" aria-label="首頁 v3 設計審閱">
  <figcaption class="ann-caption"><span class="ann-title">…</span>
    <span class="ann-counts">2 open · 1 resolved</span> <a class="ann-open" href="…image…">Open image</a></figcaption>
  <div class="ann-body">
    <div class="ann-stage">
      <img src="…" alt="…">
      <svg class="ann-overlay" aria-label="Annotations on …">
        <!-- regions first (under), then pins; source order within each -->
        <a href="#ann-4-2" id="ann-4-2-m" class="ann-marker ann-region ann-n-2" aria-label="2, region, open">
          <title>2 · CTA 對比不足…</title>
          <rect x="8%" y="61.5%" width="35%" height="12%" rx="3"/>
          <svg class="ann-badge" x="8%" y="61.5%" overflow="visible"><circle r="11"/><text text-anchor="middle" dominant-baseline="central">2</text></svg>
        </a>
        <a href="#ann-4-1" id="ann-4-1-m" class="ann-marker ann-pin ann-n-1" aria-label="1, pin, open">
          <title>1 · Logo 太小…</title>
          <svg x="41.2%" y="23.3%" overflow="visible"><path d="M0 0 C-4 -6 -12 -12 -12 -20 A12 12 0 1 1 12 -20 C12 -12 4 -6 0 0Z"/><text y="-20" text-anchor="middle" dominant-baseline="central">1</text></svg>
        </a>
        <a … class="ann-marker ann-pin ann-n-3 is-resolved"> … </a>
      </svg>
    </div>
    <div class="ann-side">
      <ol class="ann-list" aria-label="Open annotations">
        <li id="ann-4-1" class="ann-item ann-pin ann-n-1"><a class="ann-ref" href="#ann-4-1-m">1</a>
          <span class="ann-kind">Pin</span><div class="ann-comment">…Markdown…</div></li>
      </ol>
      <details class="ann-resolved"><summary>Resolved (1)</summary>
        <ol class="ann-list" aria-label="Resolved annotations"><li id="ann-4-3" class="ann-item ann-pin ann-n-3 is-resolved">
          <a class="ann-ref" …>3</a><span class="ann-kind">Pin</span><span class="ann-state">✓ Resolved</span><span class="ann-by">bob</span><div class="ann-comment">…</div></li></ol>
      </details>
    </div>
  </div>
</figure>
```

- **No inline style, no data attribute but `data-type`.** Positions are percentage presentation attributes of nested `<svg x y overflow="visible">`; markers have px user units, so they keep their size at any image scale. The stage shrink-wraps the image (`display: inline-block`, `img { display: block; max-width: 100% }`, never `object-fit`), so the overlay box is the image box.
- **State is classes**: `ann-pin`, `ann-region`, `is-resolved`, `is-problem`, `ann-n-<id>`. A row whose id is missing or repeats takes its DOM id from its position (`ann-4-r2`) and gets no `ann-n-` class, so ids stay unique and a number never names two rows. Problem rows carry `<span class="ann-problem">cause</span>` before the comment; a row without usable geometry has `<span class="ann-ref">` instead of a link and no marker.
- **Resolved filter without script**: resolved items sit in `details.ann-resolved`, closed by default; `.ann-figure:has(.ann-resolved:not([open])) .ann-marker.is-resolved { display: none }`. Print opens the group.
- **Linking without script**: marker and number are `#` links, `:target` highlights. In the app a single document-level listener (`lib/annotations/linking.ts`, installed in `create-web-app.tsx`) toggles `is-linked` on the marker and item that share `ann-n-<id>` in one figure on hover and focus, and turns a click into scroll plus a brief `is-flash`, so the router never takes the hash.
- **Comment HTML is balanced**: each comment's rendered HTML is parsed and re-serialised before it goes into its `div.ann-comment`, so a stray `</li>` or an unclosed `<div>` in a comment stays inside its own item (`transformDirectives` takes the balancing function as its optional fifth parameter; `renderNote` passes it).
- **Workspace links**: renderNote skips only `a.ann-marker` and `a.ann-ref` anchors (a `#heading` link in a comment is an ordinary link and gets its in-app handling), and the stage `<img>` is not a workspace link (no `role`, `tabindex`, lightbox, so a click on it can annotate). When renderNote refuses the stage image, it removes `svg.ann-overlay` with it, leaving the list. `a.ann-open` is the figure's one workspace link; it is the only `figcaption a`.
- **Layout**: `.ann-figure { container-type: inline-size }`; from 720px the list sits right (18rem, sticky with its own scroll), narrower it stacks under the image. App CSS is `apps/web/src/directives/annotations.css` (theme tokens only); `note-export.ts` carries the minimal positioning rules for print.
- **Language**: `createNoteRenderer({ …, language: 'en' | 'zh-TW' })` (default `en`) sets the language of the annotation and handout labels for a server render; the browser's `renderNote` follows `<html lang>`. `transformDirectives` takes the same value as its last parameter.
- **Unique ids**: a module counter (`ann-${++figureCount}`).

## Editing in the live editor

`LiveMarkdownAnnotate` (`components/LiveMarkdownAnnotate.ts`) with `annotate-editor/controller.ts` and `geometry.ts`. Read-only notes get the static figure with no toolbar; a block inside a blockquote is drawn with only the Markdown button (its lines carry the quote's markers).

Every action is written to the note at once as one transaction (`isolateHistory.of('full')`, `userEvent: 'input.annotate'`; the change is the smallest differing span, not the whole block). The widget's `updateDOM` accepts the changed text, so the element, the selection, the mode, the resolved filter and an open form survive each change. The widget keeps the image element across a redraw and reports its last height as `estimatedHeight`, so the editor does not jump the scroll.

- **Toolbar**: "Image annotations · N open", **Annotate** (toggle), **Show resolved (n)**, **Fix numbering** (only when a row needs it), **Markdown**, **Remove annotations** (the block becomes its media line, one undo step).
- **Annotate mode** (Esc leaves): crosshair, `touch-action: none` on the stage. A click or tap makes a pin; a drag past 4px (mouse) or 8px (touch) frames a region, clamped and normalised; under 1% in either dimension it is a pin. The new annotation is pending: nothing is written until its comment is saved with Mod+Enter or Save, or by leaving the form with text; Esc or an empty form discards it. The mode stays on for the next annotation.
- **Normal mode**: clicking a marker, number or item selects it and shows Edit, Resolve/Reopen and Delete. A selected pin drags to move; a selected region drags to move and resizes from four corner handles (a 10px mark on a 44px hit area). Pointer-up writes one change; the live drawing is an editing layer, never the document. Double-click or Edit opens the comment textarea (Enter new line, Mod+Enter or blur saves, Esc cancels). Delete removes the row at once (undo restores it) and selects its neighbour.
- **Keyboard**: with the image focused, P adds a pending pin and R a 20% region at the centre, arrows move the pending or selected annotation 0.5% (Shift 5%), Alt+arrows resize a region, Enter opens the comment, Delete or Backspace removes, Esc deselects then leaves annotate mode. Nudges of a selected annotation share one user event and are not isolated, so a run undoes as one step. Mod+Z, Mod+Shift+Z and Mod+Y call `undo` and `redo` from inside the widget.
- **Entry points**: an image alone on its line of a writable note shows an **Annotate** button on hover and focus (always visible without hover) that wraps the line as `:::annotate\n<line>\n:::` and starts the new widget in annotate mode through an open-request state field; the toolbar's Insert group has **Annotated image**, shown only when the image picker exists, which inserts the picked by-hash image as an annotate block (`MarkdownEditorHandle.insertAnnotated`). `updateDirectiveType` treats `annotate` as a class of its own.

## Accessibility and mobile

The list is the primary representation: each item gives its number, kind and state as text, its author and comment. Markers are links with `aria-label` ("1, pin, open") and a `<title>` of the first 80 characters. Kind and state never rely on colour. Focus rings show on markers and list items. The pending form is labelled "Comment for pin 4". Touch targets are at least 44px, reduced motion is respected, the list stacks under the image in a narrow figure, the comment form scrolls to the centre, and annotate mode takes over touch drags only while it is on (otherwise the page scrolls).

## Other surfaces

History and compare are text diffs (one line per action). Demo mode needs nothing: it edits note text. AI and MCP read and write the Markdown above; nothing changes in MCP. Compilation books and cards, the study lane and print render the figure through `renderNote`; compilation asset cards show attachments, not notes, so they show no annotations.

## Pro public pages

The static HTML fits Pro's sanitiser (it keeps nested `svg x/y %`, `overflow`, `rect`, `circle r`, `text`, `text-anchor`, `dominant-baseline`, SVG `a href="#…"`, `title`, `id`, `class`). Pro supplies its stylesheet for the `.ann-*` classes above, passes `language` from the note, and when a stage image is skipped removes `svg.ann-overlay` and the `a.ann-open` href, leaving the list. It also balances each comment's HTML before placing it in its item, as the community renderer does.

## Out of scope

PDF pages (phase 2: the media line becomes a link to a PDF, rows add `page=N`, coordinates stay page percentages), reply threads, arrows, freehand, zoom or pan in the figure, a lightbox with annotations, a visual history diff, annotation-specific MCP tools, annotations on Files-page assets.

## Verification

`apps/web/src/lib/annotations/*.test.ts` (syntax, edits, rendering contract, sanitised output, linking, CSS rules), `components/LiveMarkdownAnnotate*.test.tsx` (widget, keyboard, entry points), `components/annotate-editor/geometry.test.ts`, the relocation cases in `packages/core/src/file-manager.test.ts`, and the print cases in `lib/note-export.test.ts`.
