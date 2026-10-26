import { isolateHistory, redo, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { addRow, deleteRow, fixNumbering, nextId, removeAnnotations, setComment, setGeometry, setResolved } from '../../lib/annotations/edit.js';
import { type AnnotationRow, parseAnnotate, type ParsedAnnotate } from '../../lib/annotations/parse.js';
import { hydratePdfFigures } from '../../lib/annotations/pdf-figure.js';
import { itemsOf } from '../../lib/annotations/render.js';
import { renderNote } from '../../lib/markdown.js';
import { youtubeLabels } from '../../lib/youtube-embed.js';
import type { Translate } from '../infographic-editor/labels.js';
import { type Corner, dragShape, exceedsThreshold, isArrowKey, moveShape, nudgeShape, type Point, pointToPercent, resizeRegion, type Shape } from './geometry.js';

/** What the controller reads from the widget that currently owns its DOM. */
export interface AnnotateHost {
  readonly text: string;
  readonly path: string;
  readonly from: number;
  readonly readOnly: boolean;
  /** A block inside a blockquote is drawn but not edited: its text carries the quote's markers. */
  readonly quoted: boolean;
  readonly notebookId?: string;
  readonly t: Translate;
}

interface Pending {
  shape: Shape;
  comment: string;
  /** The form takes focus when it first appears (a pointer placed it); a keyboard-placed marker keeps focus on the image so the arrows move it. */
  focusForm: boolean;
}

interface Drag {
  mode: 'create' | 'move' | 'resize';
  pointerId: number;
  pointerType: string;
  startClient: Point;
  start: Point;
  origin?: Shape;
  corner?: Corner;
  index?: number;
  moved: boolean;
  current?: Shape;
}

// CodeMirror's history only joins adjacent changes of a typing user event, so a run of nudges is named as typing.
const NUDGE_EVENT = 'input.type.annotate.nudge';

let authorRequest: Promise<string | undefined> | undefined;

/** The signed-in person's login, when the session knows one (hosted); local mode and the demo have none. */
function sessionAuthor(): Promise<string | undefined> {
  authorRequest ??= fetch('/api/auth/session').then(response => response.json() as Promise<{ authenticated?: boolean; login?: string; demo?: boolean; }>).then(session => session.authenticated && !session.demo && session.login ? session.login : undefined).catch(() => undefined);
  return authorRequest;
}

/** Forgets the author the page learnt, so a test can start from a clean session. */
export function resetAnnotationAuthor(): void {
  authorRequest = undefined;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', attributes: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

const isTextField = (target: EventTarget | null): boolean => target instanceof HTMLElement && /^(?:TEXTAREA|INPUT|SELECT)$/.test(target.tagName);

/**
 * The editing side of one annotate block in the live editor. It owns the widget's DOM: the static figure `renderNote` draws,
 * plus a toolbar, an editing layer over the image and forms in the list. Every action is one transaction on the note's
 * text (`edit.ts` produces the new block text); nothing is kept anywhere else, so drafts, history and commits stay the
 * editor's. What the controller does keep (mode, selection, the open form, the resolved filter) survives the re-render each
 * text change causes, keyed by annotation id.
 */
export class AnnotateController {
  private annotating = false;
  private selected: string | undefined;
  private pending: Pending | undefined;
  private editing: { key: string; draft: string; } | undefined;
  private showResolved = false;
  private drag: Drag | undefined;
  /** True while the figure's DOM is replaced: the browser blurs a focused form that is removed, which is no decision of the writer's. */
  private redrawing = false;
  private figure!: HTMLElement;
  private toolbarHost!: HTMLElement;
  /** Ends the page viewer of a PDF block, which is drawn by the same code as in a read surface. */
  private stopPdf = () => {};

  constructor(private readonly view: EditorView, private host: AnnotateHost, readonly dom: HTMLElement, private readonly remember: (host: AnnotateHost, height: number) => void = () => {}) {
    dom.addEventListener('keydown', event => this.onKeydown(event));
    dom.addEventListener('click', event => this.onClick(event), true);
    dom.addEventListener('dblclick', event => this.onDoubleClick(event));
    // A press in the figure would move the browser selection into the widget, which CodeMirror reads as the cursor entering the block.
    dom.addEventListener('mousedown', event => {
      if (!isTextField(event.target)) event.preventDefault();
    });
    this.toolbarHost = element('div', 'live-annotate-toolbar-host');
    this.figure = element('div', 'live-directive-preview-content');
    dom.replaceChildren(this.toolbarHost, this.figure);
    this.render();
  }

  private get t(): Translate {
    return this.host.t;
  }

  /** The widget left the editor: its PDF document goes back to the pool. */
  destroy(): void {
    this.stopPdf();
  }

  /** The widget was rebuilt with newer text or a new position; the DOM stays and is redrawn. */
  retarget(host: AnnotateHost): void {
    const changed = host.text !== this.host.text;
    this.host = host;
    this.dom.dataset.directiveFrom = String(host.from);
    if (changed) this.render();
  }

  // ---------------------------------------------------------------------------
  // Reading

  private parsed(): ParsedAnnotate | undefined {
    try {
      return parseAnnotate(this.host.text);
    } catch {
      return undefined;
    }
  }

  private rowIndex(key: string | undefined): number {
    const parsed = this.parsed();
    if (!parsed || key === undefined) return -1;
    return itemsOf(parsed.rows).findIndex(item => item.key === key);
  }

  private keyAt(index: number): string | undefined {
    const parsed = this.parsed();
    return parsed ? itemsOf(parsed.rows)[index]?.key : undefined;
  }

  // ---------------------------------------------------------------------------
  // Writing: one transaction per action

  /** Writes `next` over the block as one change (the smallest span that differs) and, unless `grouped`, as its own undo step. */
  private write(next: string, userEvent = 'input.annotate', grouped = false): boolean {
    const { text, from } = this.host;
    if (next === text || this.view.state.sliceDoc(from, from + text.length) !== text) return false;
    let start = 0;
    while (start < text.length && start < next.length && text[start] === next[start]) start++;
    let end = 0;
    while (end < text.length - start && end < next.length - start && text[text.length - 1 - end] === next[next.length - 1 - end]) end++;
    this.view.dispatch({ changes: { from: from + start, to: from + text.length - end, insert: next.slice(start, next.length - end) }, annotations: grouped ? [] : isolateHistory.of('full'), userEvent });
    return true;
  }

  private change(edit: (text: string) => string, userEvent?: string, grouped = false): boolean {
    try {
      return this.write(edit(this.host.text), userEvent, grouped);
    } catch {
      return false;
    }
  }

  private async savePending(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    const comment = pending.comment.trim();
    if (!comment) {
      this.discardPending();
      return;
    }
    // The comment is taken before the session is asked: a press on the image while the answer is out starts the next
    // pending form, and that must not drop this one.
    this.pending = undefined;
    const by = await sessionAuthor();
    const id = nextId(this.host.text);
    // The change redraws the figure at once, so the new row is selected before it is written.
    this.selected = String(id);
    if (!this.change(text => addRow(text, { ...pending.shape, comment, by }))) {
      this.selected = undefined;
      this.render();
    }
  }

  private discardPending(): void {
    this.pending = undefined;
    this.render();
    this.focusStage();
  }

  private setGeometryOf(index: number, shape: Shape, userEvent?: string, grouped = false): void {
    this.change(text => setGeometry(text, index, shape), userEvent, grouped);
  }

  private toggleResolved(index: number): void {
    const row = this.parsed()?.rows[index];
    if (row) this.change(text => setResolved(text, index, !row.resolved));
  }

  private remove(index: number): void {
    const parsedBefore = this.parsed();
    if (!parsedBefore) return;
    // The selection moves to the row that takes the deleted one's place, else to the one before it.
    const survivors = itemsOf(parsedBefore.rows).filter((_, at) => at !== index);
    const nextKey = survivors[index]?.key ?? survivors[index - 1]?.key;
    if (this.change(text => deleteRow(text, index))) {
      this.selected = nextKey;
      this.editing = undefined;
      this.render();
    }
  }

  private saveComment(index: number, comment: string): void {
    this.editing = undefined;
    if (!this.change(text => setComment(text, index, comment))) this.render();
  }

  private removeAnnotations(): void {
    this.change(text => removeAnnotations(text));
  }

  openMarkdown(): void {
    // Focus first: the block shows its source only while the editor has focus and the cursor is on it.
    this.view.focus();
    this.view.dispatch({ selection: { anchor: this.view.state.doc.lineAt(this.host.from).to } });
  }

  // ---------------------------------------------------------------------------
  // Drawing

  private get writable(): boolean {
    // A PDF block is only read in this version: its pages are shown and navigated, and the rows are edited as Markdown.
    return !this.host.readOnly && !this.host.quoted && this.parsed()?.media.kind === 'image';
  }

  render(): void {
    const focus = this.describeFocus();
    this.drag = undefined;
    const html = renderNote(this.host.text, this.host.path, undefined, youtubeLabels(this.t), this.host.notebookId);
    // The image element survives the redraw: a new one is empty until decoded, which collapses the block's height and
    // moves everything below it, and the editor keeps the scroll position it had.
    const image = this.figure.querySelector<HTMLImageElement>('.ann-stage img');
    const height = this.figure.offsetHeight;
    if (height) this.figure.style.minHeight = `${height}px`;
    // renderNote ends in DOMPurify, so these nodes are the sanitised figure.
    this.stopPdf();
    this.redrawing = true;
    this.figure.innerHTML = html;
    this.redrawing = false;
    this.stopPdf = hydratePdfFigures(this.figure, { t: this.t, onSettled: () => this.view.requestMeasure() });
    // Outside decorate(): a PDF block is never decorated, and its resolved group follows the filter all the same.
    const details = this.figure.querySelector<HTMLDetailsElement>('details.ann-resolved');
    if (details) details.open = this.showResolved;
    const fresh = this.figure.querySelector('.ann-stage img');
    if (image && fresh && image.getAttribute('src') === fresh.getAttribute('src')) fresh.replaceWith(image);
    requestAnimationFrame(() => {
      this.figure.style.removeProperty('min-height');
      this.remember(this.host, this.dom.offsetHeight);
    });
    this.dom.classList.toggle('is-annotating', this.annotating && this.writable);
    this.renderToolbar();
    if (this.writable) this.decorate();
    this.restoreFocus(focus);
  }

  private describeFocus(): { action: string; start?: number; end?: number; } | undefined {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.dom.contains(active)) return undefined;
    const holder = active.closest<HTMLElement>('[data-focus-id]');
    if (!holder) return undefined;
    return { action: holder.dataset.focusId!, start: (active as HTMLTextAreaElement).selectionStart ?? undefined, end: (active as HTMLTextAreaElement).selectionEnd ?? undefined };
  }

  private restoreFocus(focus: { action: string; start?: number; end?: number; } | undefined): void {
    if (!focus) return;
    const target = [...this.dom.querySelectorAll<HTMLElement>('[data-focus-id]')].find(node => node.dataset.focusId === focus.action) ?? this.stage();
    target?.focus({ preventScroll: true });
    if (target instanceof HTMLTextAreaElement && focus.start !== undefined) target.setSelectionRange(focus.start, focus.end ?? focus.start);
  }

  private stage(): HTMLElement | null {
    return this.figure.querySelector<HTMLElement>('.ann-stage');
  }

  private focusStage(): void {
    this.stage()?.focus({ preventScroll: true });
  }

  private figureId(): string {
    return this.figure.querySelector('figure.ann-figure')?.id ?? '';
  }

  private renderToolbar(): void {
    const { t } = this;
    const parsed = this.parsed();
    const toolbar = element('div', 'live-directive-toolbar live-infographic-toolbar live-annotate-toolbar', { role: 'toolbar', 'aria-label': t('imageAnnotation.editor.toolbarLabel') });
    if (this.host.readOnly) {
      this.toolbarHost.replaceChildren();
      return;
    }
    const open = parsed ? parsed.rows.filter(row => !row.resolved).length : 0;
    const resolved = parsed ? parsed.rows.length - open : 0;
    const pdf = parsed?.media.kind === 'pdf';
    toolbar.append(this.text('span', 'live-infographic-badge', t(pdf ? 'imageAnnotation.editor.badgePdf' : 'imageAnnotation.editor.badge', { open })));
    if (parsed && !this.host.quoted) {
      if (!pdf) {
        const annotate = this.button('live-annotate-toggle', t('imageAnnotation.editor.annotate'), t('imageAnnotation.editor.annotateHint'), () => this.setAnnotating(!this.annotating));
        annotate.setAttribute('aria-pressed', String(this.annotating));
        annotate.dataset.focusId = 'annotate';
        toolbar.append(annotate);
      }
      if (resolved) {
        const toggle = this.button('live-annotate-resolved', t(this.showResolved ? 'imageAnnotation.editor.hideResolved' : 'imageAnnotation.editor.showResolved', { count: resolved }), '', () => {
          this.showResolved = !this.showResolved;
          this.render();
        });
        toggle.setAttribute('aria-pressed', String(this.showResolved));
        toggle.dataset.focusId = 'resolved';
        toolbar.append(toggle);
      }
      const numbering = parsed.rows.some(row => row.problems.some(problem => ['duplicate-id', 'missing-id', 'invalid-id'].includes(problem.code)));
      if (numbering) toolbar.append(this.button('live-annotate-fix', t('imageAnnotation.editor.fixNumbering'), t('imageAnnotation.editor.fixNumberingHint'), () => this.change(text => fixNumbering(text))));
    }
    toolbar.append(this.button('live-infographic-markdown-btn', t('imageAnnotation.editor.markdown'), t('imageAnnotation.editor.markdownHint'), () => this.openMarkdown()));
    if (parsed && !this.host.quoted) toolbar.append(this.button('live-annotate-remove', t('imageAnnotation.editor.remove'), t('imageAnnotation.editor.removeHint'), () => this.removeAnnotations()));
    this.toolbarHost.replaceChildren(toolbar);
  }

  private text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content: string): HTMLElementTagNameMap[K] {
    const node = element(tag, className);
    node.textContent = content;
    return node;
  }

  private button(className: string, label: string, title: string, run: () => void): HTMLButtonElement {
    const button = element('button', className, { type: 'button', 'aria-label': title || label });
    button.textContent = label;
    if (title) button.title = title;
    // Pressing a button must not move focus out of a comment being written before the click lands.
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      run();
    });
    return button;
  }

  /** Everything the static figure lacks: the editing layers, selection, the resolved filter and any open form. */
  private decorate(): void {
    const { t } = this;
    const parsed = this.parsed();
    const stage = this.stage();
    if (!parsed || !stage) return;
    const figure = this.figureId();
    const items = itemsOf(parsed.rows);
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', t('imageAnnotation.editor.stage'));
    stage.dataset.focusId = 'stage';
    for (const marker of stage.querySelectorAll('.ann-marker')) marker.setAttribute('tabindex', '-1');

    const under = element('div', 'ann-edit-under');
    under.addEventListener('pointerdown', event => this.beginCreate(event));
    const overlay = stage.querySelector('.ann-overlay');
    stage.insertBefore(under, overlay);
    const over = element('div', 'ann-edit-over');
    stage.append(over);

    const selectedIndex = this.rowIndex(this.selected);
    if (this.selected !== undefined && selectedIndex < 0) this.selected = undefined;
    if (this.selected !== undefined) {
      stage.querySelector(`[id="${figure}-${this.selected}-m"]`)?.classList.add('is-selected');
      const row = parsed.rows[selectedIndex];
      if (row.hasGeometry && !this.pending) this.drawHandles(over, row, selectedIndex);
    }
    if (this.pending) this.drawPending(over, stage);

    const list = this.figure.querySelector('.ann-side > .ann-list');
    for (const item of items) {
      const li = this.figure.querySelector<HTMLElement>(`[id="${figure}-${item.key}"]`);
      if (!li) continue;
      li.dataset.annKey = item.key;
      if (item.key === this.selected) {
        li.classList.add('is-selected');
        if (!this.pending) li.append(this.actions(item.row, items.indexOf(item)));
      }
      if (this.editing?.key === item.key) this.openCommentEditor(li, item.row, items.indexOf(item));
    }
    if (this.pending) this.drawPendingForm(list);
  }

  private drawHandles(over: HTMLElement, row: AnnotationRow, index: number): void {
    const { t } = this;
    const shape = shapeOf(row);
    if (!shape) return;
    if (shape.kind === 'pin') {
      const target = element('div', 'ann-move ann-move-pin', { title: t('imageAnnotation.editor.move') });
      target.style.left = `${shape.x}%`;
      target.style.top = `${shape.y}%`;
      target.addEventListener('pointerdown', event => this.beginMove(event, index, shape));
      over.append(target);
      return;
    }
    const box = element('div', 'ann-move ann-move-box', { title: t('imageAnnotation.editor.move') });
    place(box, shape);
    box.addEventListener('pointerdown', event => this.beginMove(event, index, shape));
    over.append(box);
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      const handle = element('button', `ann-handle ann-handle-${corner}`, { type: 'button', tabindex: '-1', 'aria-label': t('imageAnnotation.editor.resizeHandle', { corner: t(`imageAnnotation.editor.corner.${corner}` as const) }) });
      handle.style.left = `${corner.endsWith('w') ? shape.x : shape.x + shape.w}%`;
      handle.style.top = `${corner.startsWith('n') ? shape.y : shape.y + shape.h}%`;
      handle.addEventListener('pointerdown', event => this.beginResize(event, index, shape, corner));
      over.append(handle);
    }
  }

  private drawPending(over: HTMLElement, stage: HTMLElement): void {
    const { shape } = this.pending!;
    const id = nextId(this.host.text);
    const marker = element('div', `ann-pending ann-pending-${shape.kind}`);
    if (shape.kind === 'region') place(marker, shape);
    else {
      marker.style.left = `${shape.x}%`;
      marker.style.top = `${shape.y}%`;
    }
    marker.append(this.text('span', 'ann-pending-badge', String(id)));
    over.append(marker);
    stage.classList.add('has-pending');
  }

  private drawPendingForm(list: Element | null): void {
    const { t } = this;
    const pending = this.pending!;
    const id = nextId(this.host.text);
    const kind = t(pending.shape.kind === 'region' ? 'imageAnnotation.render.kindRegion' : 'imageAnnotation.render.kindPin');
    const li = element('li', 'ann-item ann-pending-item is-selected', { 'data-focus-id': 'pending' });
    li.append(this.text('span', 'ann-ref', String(id)), this.text('span', 'ann-kind', kind));
    const form = this.commentForm(t('imageAnnotation.editor.commentFor', { kind: kind.toLowerCase(), id }), pending.comment, {
      input: value => {
        pending.comment = value;
      },
      save: () => void this.savePending(),
      cancel: () => this.discardPending(),
      blur: () => pending.comment.trim() ? void this.savePending() : this.discardPending(),
    });
    li.append(form);
    let target = list;
    if (!target) {
      target = element('ol', 'ann-list');
      this.figure.querySelector('.ann-side')?.prepend(target);
    }
    target.append(li);
    // Centre the form so a phone's keyboard does not cover it.
    const focus = pending.focusForm;
    pending.focusForm = false;
    queueMicrotask(() => {
      if (focus) form.querySelector('textarea')?.focus({ preventScroll: true });
      li.scrollIntoView?.({ block: 'center' });
    });
  }

  /** The comment textarea with its Save and Cancel buttons and the key hint. */
  private commentForm(label: string, value: string, handlers: { input: (value: string) => void; save: () => void; cancel: () => void; blur: () => void; }): HTMLElement {
    const { t } = this;
    const form = element('div', 'ann-comment ann-form');
    const field = element('textarea', 'ann-textarea', { 'aria-label': label, placeholder: t('imageAnnotation.editor.commentPlaceholder'), rows: '3', 'data-focus-id': 'comment' });
    field.value = value;
    let finished = false;
    const finish = (run: () => void) => {
      if (finished) return;
      finished = true;
      run();
    };
    field.addEventListener('input', () => handlers.input(field.value));
    field.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(handlers.cancel);
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        finish(handlers.save);
      }
    });
    field.addEventListener('blur', event => {
      if (this.redrawing) return;
      if (event.relatedTarget instanceof Node && form.contains(event.relatedTarget)) return;
      finish(handlers.blur);
    });
    const hint = this.text('p', 'ann-hint', t('imageAnnotation.editor.commentHint'));
    const buttons = element('div', 'ann-form-actions');
    buttons.append(this.button('ann-action', t('imageAnnotation.editor.save'), '', () => finish(handlers.save)), this.button('ann-action', t('imageAnnotation.editor.cancel'), '', () => finish(handlers.cancel)));
    form.append(field, hint, buttons);
    return form;
  }

  private openCommentEditor(li: HTMLElement, row: AnnotationRow, index: number): void {
    const { t } = this;
    const editing = this.editing!;
    const kind = t(row.kind === 'region' ? 'imageAnnotation.render.kindRegion' : 'imageAnnotation.render.kindPin');
    const form = this.commentForm(t('imageAnnotation.editor.commentFor', { kind: kind.toLowerCase(), id: row.id ?? '?' }), editing.draft, {
      input: value => {
        editing.draft = value;
      },
      save: () => this.saveComment(index, editing.draft),
      cancel: () => {
        this.editing = undefined;
        this.render();
        this.focusStage();
      },
      blur: () => this.saveComment(index, editing.draft),
    });
    li.querySelector('.ann-comment')?.replaceWith(form);
    queueMicrotask(() => form.querySelector('textarea')?.focus({ preventScroll: true }));
  }

  private actions(row: AnnotationRow, index: number): HTMLElement {
    const { t } = this;
    const actions = element('div', 'ann-actions', { 'data-focus-id': 'actions' });
    const edit = this.button('ann-action', t('imageAnnotation.editor.edit'), '', () => this.startEditing(index));
    edit.dataset.focusId = 'action-edit';
    const resolve = this.button('ann-action', t(row.resolved ? 'imageAnnotation.editor.reopen' : 'imageAnnotation.editor.resolve'), '', () => this.toggleResolved(index));
    resolve.dataset.focusId = 'action-resolve';
    const remove = this.button('ann-action', t('imageAnnotation.editor.delete'), '', () => this.remove(index));
    remove.dataset.focusId = 'action-delete';
    actions.append(edit, resolve, remove);
    return actions;
  }

  // ---------------------------------------------------------------------------
  // Mode, selection and forms

  /** Starts in annotate mode: the entry points that make a block from an image use it. */
  startAnnotating(): void {
    this.setAnnotating(true);
  }

  private setAnnotating(on: boolean): void {
    this.annotating = on;
    this.dom.classList.toggle('is-annotating', on);
    this.toolbarHost.querySelector('.live-annotate-toggle')?.setAttribute('aria-pressed', String(on));
    if (on) this.focusStage();
  }

  select(key: string | undefined, scroll = true): void {
    if (this.pending && key !== undefined) return;
    this.selected = key;
    this.render();
    if (key !== undefined && scroll) this.figure.querySelector(`[id="${this.figureId()}-${key}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }

  private startEditing(index: number): void {
    const parsed = this.parsed();
    const row = parsed?.rows[index];
    const key = this.keyAt(index);
    if (!row || key === undefined) return;
    this.selected = key;
    this.editing = { key, draft: row.comment };
    this.render();
  }

  private startPending(shape: Shape, focusForm: boolean): void {
    this.selected = undefined;
    this.editing = undefined;
    this.pending = { shape, comment: '', focusForm };
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Pointer

  private stageBox(): DOMRect | undefined {
    return this.stage()?.getBoundingClientRect();
  }

  private pointOf(event: PointerEvent): Point | undefined {
    const box = this.stageBox();
    return box ? pointToPercent(event, box) : undefined;
  }

  private capture(event: PointerEvent): void {
    try {
      (event.target as Element).setPointerCapture?.(event.pointerId);
    } catch { /* A synthetic event has no active pointer to capture. */ }
  }

  private startDrag(event: PointerEvent, drag: Omit<Drag, 'pointerId' | 'pointerType' | 'startClient' | 'moved'>): void {
    event.preventDefault();
    event.stopPropagation();
    this.capture(event);
    const target = event.currentTarget as HTMLElement;
    this.drag = { ...drag, pointerId: event.pointerId, pointerType: event.pointerType || 'mouse', startClient: { x: event.clientX, y: event.clientY }, moved: false };
    const move = (next: PointerEvent) => this.onDragMove(next);
    const finish = (next: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', cancel);
      this.onDragEnd(next, true);
    };
    const cancel = (next: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', cancel);
      this.onDragEnd(next, false);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', cancel);
  }

  private beginCreate(event: PointerEvent): void {
    if (!this.annotating || !this.writable || event.button > 0) return;
    const start = this.pointOf(event);
    if (!start) return;
    if (this.pending) {
      // A new press while a form is open saves or drops that one first, as clicking away does.
      const current = this.pending;
      if (current.comment.trim()) void this.savePending();
      else this.discardPending();
    }
    this.startDrag(event, { mode: 'create', start });
  }

  private beginMove(event: PointerEvent, index: number, origin: Shape): void {
    const start = this.pointOf(event);
    if (!start || event.button > 0) return;
    this.startDrag(event, { mode: 'move', start, origin, index });
  }

  private beginResize(event: PointerEvent, index: number, origin: Shape, corner: Corner): void {
    const start = this.pointOf(event);
    if (!start || event.button > 0) return;
    this.startDrag(event, { mode: 'resize', start, origin, corner, index });
  }

  private onDragMove(event: PointerEvent): void {
    const drag = this.drag;
    const point = this.pointOf(event);
    if (!drag || !point || (event.pointerId !== drag.pointerId && event.pointerId !== undefined && drag.pointerId !== undefined)) return;
    if (!drag.moved && !exceedsThreshold(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y, drag.pointerType)) return;
    drag.moved = true;
    const stage = this.stage();
    if (drag.mode === 'create') drag.current = dragShape(drag.start, point);
    else if (drag.origin?.kind === 'region' && drag.mode === 'resize' && drag.corner) drag.current = resizeRegion(drag.origin, drag.corner, point);
    else if (drag.origin) drag.current = moveShape(drag.origin, point.x - drag.start.x, point.y - drag.start.y);
    if (!stage || !drag.current) return;
    stage.classList.add('is-dragging');
    this.drawFeedback(stage, drag.current);
  }

  /** The editing layer's live drawing during a drag; the document is untouched until the pointer is released. */
  private drawFeedback(stage: HTMLElement, shape: Shape): void {
    let feedback = stage.querySelector<HTMLElement>('.ann-feedback');
    if (!feedback) {
      feedback = element('div', 'ann-feedback');
      stage.querySelector('.ann-edit-over')?.append(feedback);
    }
    feedback.className = `ann-feedback ann-feedback-${shape.kind}`;
    if (shape.kind === 'region') {
      place(feedback, shape);
    } else {
      feedback.style.left = `${shape.x}%`;
      feedback.style.top = `${shape.y}%`;
      feedback.style.removeProperty('width');
      feedback.style.removeProperty('height');
    }
  }

  private onDragEnd(event: PointerEvent, commit: boolean): void {
    const drag = this.drag;
    this.drag = undefined;
    this.stage()?.classList.remove('is-dragging');
    this.stage()?.querySelector('.ann-feedback')?.remove();
    if (!drag || !commit) {
      this.render();
      return;
    }
    if (drag.mode === 'create') {
      const point = this.pointOf(event) ?? drag.start;
      this.startPending(drag.moved ? dragShape(drag.start, point) : { kind: 'pin', x: drag.start.x, y: drag.start.y }, true);
      return;
    }
    if (drag.moved && drag.current && drag.index !== undefined) this.setGeometryOf(drag.index, drag.current);
    else this.render();
  }

  // ---------------------------------------------------------------------------
  // Clicks and keys

  private onClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || !this.writable || event.defaultPrevented) return;
    const marker = target.closest<SVGElement>('.ann-marker');
    const ref = target.closest('.ann-ref');
    const item = target.closest<HTMLElement>('.ann-item');
    const key = marker ? this.keyOf(marker) : item?.dataset.annKey;
    if (key === undefined || (!marker && !ref && !item) || target.closest('button, textarea, a.ann-open')) return;
    event.preventDefault();
    event.stopPropagation();
    this.select(key);
  }

  private keyOf(marker: Element): string | undefined {
    const match = new RegExp(`^${this.figureId()}-(.+)-m$`).exec(marker.id);
    return match?.[1];
  }

  private onDoubleClick(event: MouseEvent): void {
    if (!(event.target instanceof Element) || !this.writable || event.target.closest('button, textarea, a')) return;
    const item = event.target.closest<HTMLElement>('.ann-item');
    const key = item?.dataset.annKey;
    if (key === undefined) return;
    event.preventDefault();
    this.startEditing(this.rowIndex(key));
  }

  private onKeydown(event: KeyboardEvent): void {
    if (!this.writable) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key;
    if (modifier && !event.altKey && !isTextField(event.target) && (key.toLowerCase() === 'z' || key.toLowerCase() === 'y')) {
      // CodeMirror's keymap never sees events in a widget that ignores them, so undo is called here.
      event.preventDefault();
      event.stopPropagation();
      (key.toLowerCase() === 'y' || event.shiftKey ? redo : undo)(this.view);
      return;
    }
    if (isTextField(event.target)) return;
    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.pending) this.discardPending();
      else if (this.selected !== undefined) this.select(undefined);
      else if (this.annotating) this.setAnnotating(false);
      return;
    }
    if (event.target !== this.stage()) return;
    this.onStageKey(event);
  }

  private onStageKey(event: KeyboardEvent): void {
    const { key } = event;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.metaKey || event.ctrlKey) return;
    if (key === 'p' || key === 'P') {
      handled();
      this.startPending({ kind: 'pin', x: 50, y: 50 }, false);
    } else if (key === 'r' || key === 'R') {
      handled();
      this.startPending({ kind: 'region', x: 40, y: 40, w: 20, h: 20 }, false);
    } else if (isArrowKey(key)) {
      const modifiers = { shift: event.shiftKey, alt: event.altKey };
      if (this.pending) {
        handled();
        this.pending.shape = nudgeShape(this.pending.shape, key, modifiers);
        this.render();
        return;
      }
      const index = this.rowIndex(this.selected);
      const shape = shapeOf(this.parsed()?.rows[index]);
      if (shape) {
        handled();
        // A run of nudges is one undo step: they share a user event and are not isolated.
        this.setGeometryOf(index, nudgeShape(shape, key, modifiers), NUDGE_EVENT, true);
      }
    } else if (key === 'Enter') {
      handled();
      if (this.pending) this.dom.querySelector<HTMLTextAreaElement>('.ann-pending-item textarea')?.focus();
      else if (this.selected !== undefined) this.startEditing(this.rowIndex(this.selected));
    } else if (key === 'Delete' || key === 'Backspace') {
      const index = this.rowIndex(this.selected);
      if (index >= 0 && !this.pending) {
        handled();
        this.remove(index);
      }
    }
  }
}

function shapeOf(row: AnnotationRow | undefined): Shape | undefined {
  if (!row?.hasGeometry || row.x === undefined || row.y === undefined) return undefined;
  if (row.kind === 'region' && row.w !== undefined && row.h !== undefined) return { kind: 'region', x: row.x, y: row.y, w: row.w, h: row.h };
  return row.kind === 'pin' ? { kind: 'pin', x: row.x, y: row.y } : undefined;
}

function place(node: HTMLElement, shape: Extract<Shape, { kind: 'region'; }>): void {
  node.style.left = `${shape.x}%`;
  node.style.top = `${shape.y}%`;
  node.style.width = `${shape.w}%`;
  node.style.height = `${shape.h}%`;
}
