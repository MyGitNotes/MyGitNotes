import { type CSSProperties, type KeyboardEvent, useId } from 'react';
import type { BoardElementKey, DrawnArrow } from '../../lib/board/connections.js';
import { ARROW_LABEL_MAX, SECTION_TITLE_MAX, TEXT_MAX } from '../../lib/board/edit.js';
import { BOARD_TEXT_DEFAULT_WIDTH, BOARD_TEXT_FONT, type Point, type Rect, rectCentre } from '../../lib/board/geometry.js';
import type { PlacedBoard } from '../../lib/board/placement.js';
import { boardToScreen, type Camera } from '../../lib/board/zoom.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { Button } from '../Button.js';
import { WorkspaceDialog } from '../WorkspaceDialog.js';
import type { BoardOverlay } from './useBoardPointer.js';
import type { BoardEditor } from './useBoardEditor.js';

const box = (rect: Rect): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.w, height: rect.h });

/** What a gesture under way draws, in board units: the selection box, the section being drawn, the arrow being pulled. */
export function BoardGestureOverlay({ overlay }: { overlay: BoardOverlay; }) {
  const from = overlay.arrow && rectCentre(overlay.arrow.from);
  return (
    <>
      {overlay.box && <div className='board-marquee' aria-hidden='true' style={box(overlay.box)} />}
      {overlay.section && <div className='board-section-draft' aria-hidden='true' style={box(overlay.section)} />}
      {overlay.arrow && from && (
        <svg className='board-lines board-rubber' width='1' height='1' aria-hidden='true' focusable='false'>
          <line x1={from.x} y1={from.y} x2={overlay.arrow.to.x} y2={overlay.arrow.to.y} />
        </svg>
      )}
    </>
  );
}

/**
 * The field of the element being typed in place, over the board at its place on screen: a section's title (a new
 * section's 新區塊 selected for typing), a text, an arrow's label with the labels this board already uses. Enter, or
 * leaving the field, writes it; Escape keeps a new element as it is and drops a change to an existing one. Text takes
 * line breaks, so Mod+Enter or Escape ends it.
 */
export function BoardFieldEditor({ editor, board, arrows, camera, labels }: { editor: BoardEditor; board: PlacedBoard; arrows: readonly DrawnArrow[]; camera: Camera; labels: readonly string[]; }) {
  const { t } = useTranslation();
  const list = useId();
  const { draft } = editor;
  if (!draft) return null;
  const at = (point: Point) => boardToScreen(camera, point);
  const finish = () => {
    editor.commitDraft();
    editor.focusBoard();
  };
  const keys = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, multiline = false) => {
    const end = multiline ? event.key === 'Enter' && (event.metaKey || event.ctrlKey) : event.key === 'Enter';
    if (!end && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape' && (draft.kind === 'rename' || (draft.kind === 'label' && draft.existing))) {
      editor.cancelDraft();
      editor.focusBoard();
    } else finish();
  };
  const select = (event: { currentTarget: HTMLInputElement | HTMLTextAreaElement; }) => event.currentTarget.select();
  if (draft.kind === 'section' || draft.kind === 'rename') {
    const key = draft.kind === 'section' ? draft.id : draft.key;
    const rect = board.sections.find(section => section.key === key)?.rect ?? (draft.kind === 'section' ? draft.rect : undefined);
    if (!rect) return null;
    const corner = at({ x: rect.x + 20, y: rect.y + 10 });
    return <input className='board-editor board-editor-title' style={{ left: corner.x, top: corner.y, width: Math.max(160, (rect.w - 40) * camera.zoom) }} aria-label={t('board.sectionName')} value={draft.title} maxLength={SECTION_TITLE_MAX} autoFocus onFocus={select} onChange={event => editor.setDraft({ ...draft, title: event.target.value })} onKeyDown={event => keys(event)} onBlur={finish} />;
  }
  if (draft.kind === 'text') {
    const corner = at({ x: draft.x, y: draft.y });
    const width = board.texts.find(text => text.id === draft.id)?.rect.w ?? BOARD_TEXT_DEFAULT_WIDTH;
    return <textarea className='board-editor board-editor-text' style={{ left: corner.x, top: corner.y, width: width * camera.zoom, fontSize: Math.max(12, BOARD_TEXT_FONT * camera.zoom) }} aria-label={t('board.textField')} value={draft.text} maxLength={TEXT_MAX} rows={Math.max(2, draft.text.split('\n').length)} autoFocus onChange={event => editor.setDraft({ ...draft, text: event.target.value })} onKeyDown={event => keys(event, true)} onBlur={finish} />;
  }
  const arrow = arrows.find(candidate => candidate.id === draft.id);
  if (!arrow) return null;
  const middle = at(arrow.middle);
  return (
    <>
      <input className='board-editor board-editor-label' style={{ left: middle.x, top: middle.y }} aria-label={t('board.arrowLabel')} placeholder={t('board.arrowLabelHint')} list={labels.length ? list : undefined} value={draft.label} maxLength={ARROW_LABEL_MAX} autoFocus onFocus={select} onChange={event => editor.setDraft({ ...draft, label: event.target.value })} onKeyDown={event => keys(event)} onBlur={finish} />
      {labels.length > 0 && <datalist id={list}>{labels.map(label => <option key={label} value={label} />)}</datalist>}
    </>
  );
}

/** The board's dialogs: the 「連到…」 picker of the element an arrow goes to, and the question before a section goes. */
export function BoardDialogs({ editor, board, titleOf, dynamic }: { editor: BoardEditor; board: PlacedBoard; titleOf: (key: BoardElementKey) => string; dynamic: boolean; }) {
  const { t } = useTranslation();
  const { picker, confirm } = editor;
  if (picker) {
    const targets: { key: BoardElementKey; label: string; }[] = [...board.cards.map(card => ({ key: `card:${card.key}` as const, label: t('board.pickCard', { title: titleOf(`card:${card.key}`) }) })), ...dynamic ? [] : board.sections.map(section => ({ key: `section:${section.key}` as const, label: t('board.sectionTitle', { title: section.title }) })), ...board.texts.map(text => ({ key: `text:${text.id}` as const, label: t('board.pickText', { title: titleOf(`text:${text.id}`) }) }))].filter(target => target.key !== picker);
    return (
      <WorkspaceDialog title={t('board.linkTo', { title: titleOf(picker) })} onClose={editor.closePicker}>
        {targets.length
          ? (
            <ul className='board-picker'>
              {targets.map(target => (
                <li key={target.key}>
                  <Button
                    className='board-picker-option'
                    onClick={() => editor.pick(target.key)}
                  >
                    {target.label}
                  </Button>
                </li>
              ))}
            </ul>
          )
          : <p>{t('board.linkNothing')}</p>}
      </WorkspaceDialog>
    );
  }
  if (!confirm) return null;
  return (
    <WorkspaceDialog title={t('board.deleteSection')} onClose={editor.cancelRemove}>
      <p>{t('board.deleteSectionHint')}</p>
      <div className='workspace-dialog-actions'>
        <Button onClick={editor.cancelRemove}>{t('common.cancel')}</Button>
        <Button variant='danger' onClick={editor.confirmRemove}>{t('board.deleteSectionConfirm')}</Button>
      </div>
    </WorkspaceDialog>
  );
}
