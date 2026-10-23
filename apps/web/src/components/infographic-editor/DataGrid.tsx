import { type ClipboardEvent, type CSSProperties, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, memo, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Plus, Star } from 'lucide-react';
import { type CellIssue, isRouteRow } from '../../lib/infographics/model.js';
import { cellMatrix, type CellPos, type Direction, gridColumns, inRange, isCellEditable, isHighlighted, parseTsv, rangeOf, rangeToTsv, rowIndexAt, rowSelection, rowsOf, single } from '../../lib/infographics/grid.js';
import { type CommitMove, type EditorAction, type EditorState, rowEdits } from '../../lib/infographics/editor-state.js';
import { columnLabel, issueText, type Translate } from './labels.js';
import { RowMenu } from './RowMenu.js';

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  t: Translate;
  /** Problems in the cells of the active tab. */
  issues: CellIssue[];
  inputRef: RefObject<HTMLInputElement>;
  /** The text now in the shared input, while a cell is being typed; the editor refreshes its preview from it. */
  onDraft: (value: string) => void;
  /** Mod+Enter: save, with the text of the cell being typed if there is one. */
  onSave: (pending: string | null) => void;
  onClose: () => void;
  autoFocus: boolean;
}

const MOVES: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end' };
const COMMIT_MOVES = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const;

const cellOf = (target: EventTarget | null): CellPos | null => {
  const cell = target instanceof Element ? target.closest<HTMLElement>('[data-cell]') : null;
  return cell ? { row: Number(cell.dataset.row), col: Number(cell.dataset.col) } : null;
};

/**
 * The editor's grid. Its cells are static elements; one shared `<input>` sits over the active cell and takes the keys.
 * What the writer types stays in that input until the cell is committed, so typing re-renders nothing here.
 */
export const DataGrid = memo(function DataGrid({ state, dispatch, t, issues, inputRef, onDraft, onSave, onClose, autoFocus }: Props) {
  const { block, tab, sel, edit } = state;
  const columns = useMemo(() => gridColumns(block), [block]);
  const matrix = useMemo(() => cellMatrix(block, tab), [block, tab]);
  const rows = rowsOf(block, tab);
  const dims = { rows: matrix.length, cols: columns.length };
  const range = rangeOf(sel);
  const active = sel.anchor;
  const scroller = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [rowDrag, setRowDrag] = useState<{ from: number; over: number; } | null>(null);
  const issueAt = useMemo(() => new Map(issues.map(issue => [`${issue.row}:${issue.column}`, issue])), [issues]);
  const columnWidths = columns.map(column => column.type === 'text' ? 'minmax(9rem, 1.4fr)' : 'minmax(7rem, 1fr)').join(' ');

  const send = (action: EditorAction) => dispatch(action);
  const focusInput = () => inputRef.current?.focus({ preventScroll: true });
  const startEdit = (initial: string, replace: boolean) => send({ type: 'edit', initial, replace });
  const cellText = (pos: CellPos) => matrix[pos.row]?.[pos.col] ?? '';
  const commit = (move: CommitMove) => send({ type: 'commit', move, value: inputRef.current?.value ?? '' });

  // The input lies over the active cell, in the grid's own scrolling coordinates.
  useLayoutEffect(() => {
    const input = inputRef.current, cell = scroller.current?.querySelector<HTMLElement>(`[data-cell][data-row="${active.row}"][data-col="${active.col}"]`);
    if (!input) return;
    if (!cell) {
      input.style.display = 'none';
      return;
    }
    Object.assign(input.style, { display: '', left: `${cell.offsetLeft}px`, top: `${cell.offsetTop}px`, width: `${cell.offsetWidth}px`, minHeight: `${cell.offsetHeight}px` });
  });

  useLayoutEffect(() => {
    scroller.current?.querySelector<HTMLElement>(`[data-cell][data-row="${active.row}"][data-col="${active.col}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active.row, active.col, tab]);

  // Starting an edit puts the cell's text in the input; ending it empties the input for the next keystroke.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (!edit) {
      if (input.value) input.value = '';
      return;
    }
    if (edit.initial !== null && input.value !== edit.initial) input.value = edit.initial;
    if (edit.initial !== null) input.setSelectionRange(input.value.length, input.value.length);
    focusInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when an edit starts or ends; the input is a stable ref.
  }, [edit]);

  // Opened from a menu, the grid asks for focus again a frame later, once the menu has let go of it.
  useEffect(() => {
    if (!autoFocus) return;
    focusInput();
    const frame = requestAnimationFrame(focusInput);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus on mount only.
  }, []);

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const pendingValue = () => edit ? inputRef.current?.value ?? '' : null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const { key } = event;
    // Keys that belong to an IME composition (a Chinese or Japanese reading being chosen) are not ours.
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      event.stopPropagation();
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (mod && key === 'Enter') {
      handled();
      onSave(pendingValue());
      return;
    }
    if (edit) {
      event.stopPropagation();
      if (key === 'Enter') {
        handled();
        commit(event.shiftKey ? 'up' : 'enter');
      } else if (key === 'Tab') {
        handled();
        commit(event.shiftKey ? 'previous' : 'next');
      } else if (key === 'Escape') {
        handled();
        send({ type: 'cancel-edit' });
      } else if (edit.replace && key in COMMIT_MOVES && !mod && !event.altKey) {
        handled();
        commit(COMMIT_MOVES[key as keyof typeof COMMIT_MOVES]);
      }
      return;
    }
    if (key === 'Escape') {
      handled();
      onClose();
    } else if (mod && (key === 'z' || key === 'Z' || key === 'y')) {
      handled();
      send({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' });
    } else if (mod && (key === 'a' || key === 'A')) {
      handled();
      send({ type: 'select', sel: { anchor: { row: 0, col: 0 }, focus: { row: dims.rows - 1, col: dims.cols - 1 } } });
    } else if (key in MOVES) {
      handled();
      const direction = mod && key === 'ArrowUp' ? 'top' : mod && key === 'ArrowDown' ? 'bottom' : mod && key === 'ArrowLeft' ? 'home' : mod && key === 'ArrowRight' ? 'end' : MOVES[key];
      send({ type: 'move', direction, extend: event.shiftKey });
    } else if (key === 'Tab') {
      handled();
      send({ type: 'commit', move: event.shiftKey ? 'previous' : 'next', value: '' });
    } else if (key === 'Enter' || key === 'F2') {
      handled();
      startEdit(cellText(active), false);
    } else if (key === 'Delete' || key === 'Backspace') {
      handled();
      send({ type: 'clear' });
    } else if (key.length === 1 && !mod && !event.altKey) {
      // The character goes into the input and its change event starts the edit, which keeps IME input working.
      event.stopPropagation();
      if (!isCellEditable(block, tab, active)) event.preventDefault();
    } else if (!mod) {
      event.stopPropagation();
    }
  };

  const onInput = (value: string) => {
    if (!edit) {
      if (!isCellEditable(block, tab, active)) {
        if (inputRef.current) inputRef.current.value = '';
        return;
      }
      send({ type: 'edit', initial: null, replace: true });
    }
    onDraft(value);
  };

  const onCopy = (event: ClipboardEvent<HTMLInputElement>, cut: boolean) => {
    if (edit || !dims.rows) return;
    event.preventDefault();
    event.stopPropagation();
    event.clipboardData.setData('text/plain', rangeToTsv(block, tab, range));
    if (cut) send({ type: 'clear' });
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (edit || !dims.rows) return;
    event.preventDefault();
    const matrixIn = parseTsv(event.clipboardData.getData('text/plain'));
    if (matrixIn.length) send({ type: 'paste', matrix: matrixIn });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0) return;
    const pos = cellOf(event.target);
    if (!pos) return;
    const sameCell = sel.anchor.row === pos.row && sel.anchor.col === pos.col && sel.focus.row === pos.row && sel.focus.col === pos.col;
    if (event.shiftKey) send({ type: 'select', sel: { anchor: sel.anchor, focus: pos } });
    else if (event.pointerType === 'touch' && sameCell && !edit) startEdit(cellText(pos), false);
    else {
      send({ type: 'commit', move: 'stay', value: inputRef.current?.value ?? '' });
      send({ type: 'select', sel: single(pos) });
      dragging.current = event.pointerType !== 'touch';
    }
    focusInput();
  };

  const onPointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const pos = cellOf(event.target);
    if (pos && (pos.row !== sel.focus.row || pos.col !== sel.focus.col)) send({ type: 'select', sel: { anchor: sel.anchor, focus: pos } });
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const pos = cellOf(event.target);
    if (!pos || !isCellEditable(block, tab, pos)) return;
    send({ type: 'select', sel: single(pos) });
    startEdit(cellText(pos), false);
  };

  const rowElements = () => [...(scroller.current?.querySelectorAll<HTMLElement>('[data-grid-row]') ?? [])];

  const startRowDrag = (event: ReactPointerEvent<HTMLButtonElement>, from: number) => {
    if (event.button > 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setRowDrag({ from, over: from });
  };
  const moveRowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!rowDrag) return;
    const over = rowIndexAt(rowElements().map(element => element.getBoundingClientRect()), event.clientY);
    if (over >= 0 && over !== rowDrag.over) setRowDrag({ ...rowDrag, over });
  };
  const endRowDrag = (event: ReactPointerEvent<HTMLButtonElement>, drop: boolean) => {
    if (!rowDrag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const { from, over } = rowDrag;
    setRowDrag(null);
    if (drop && over !== from) send({ type: 'change', apply: rowEdits.move(from, over) });
    focusInput();
  };

  const change = (apply: ReturnType<typeof rowEdits.insert>) => send({ type: 'change', apply });

  return (
    <div className='ig-grid-wrap'>
      <div ref={scroller} className='ig-grid-scroll'>
        <div className='ig-grid' role='grid' aria-label={t('infographic.editor.grid')} aria-rowcount={rows.length + 1} aria-colcount={columns.length} style={{ '--ig-columns': columnWidths } as CSSProperties} onPointerDown={onPointerDown} onPointerOver={onPointerOver} onDoubleClick={onDoubleClick} onMouseDown={event => cellOf(event.target) && event.preventDefault()}>
          <div className='ig-grid-row ig-grid-head' role='row'>
            <div role='presentation' className='ig-grip-cell' />
            <div role='presentation' className='ig-num-cell' />
            <div role='columnheader' className='ig-star-cell' title={t('infographic.editor.highlightColumn')}>
              <Star aria-label={t('infographic.editor.highlightColumn')} />
            </div>
            {columns.map((column, index) => <div key={`${column.key}${index}`} role='columnheader' className='ig-head-cell'>{columnLabel(t, block.kind, index)}</div>)}
            <div role='presentation' className='ig-menu-cell' />
          </div>
          {rows.map((row, rowIndex) => {
            const highlighted = isHighlighted(row);
            const route = block.kind === 'map' && isRouteRow(row.fields);
            return (
              <div key={rowIndex} className='ig-grid-row' role='row' aria-rowindex={rowIndex + 2} data-grid-row data-row-index={rowIndex} data-dragging={rowDrag?.from === rowIndex || undefined} data-drop-target={rowDrag && rowDrag.over === rowIndex && rowDrag.from !== rowIndex ? rowDrag.over > rowDrag.from ? 'after' : 'before' : undefined}>
                <div role='gridcell' className='ig-grip-cell'>
                  <button type='button' className='ig-grip' aria-label={t('infographic.editor.dragRow', { row: rowIndex + 1 })} title={t('infographic.editor.dragRow', { row: rowIndex + 1 })} onPointerDown={event => startRowDrag(event, rowIndex)} onPointerMove={moveRowDrag} onPointerUp={event => endRowDrag(event, true)} onPointerCancel={event => endRowDrag(event, false)}>
                    <GripVertical aria-hidden='true' />
                  </button>
                </div>
                <div role='gridcell' className='ig-num-cell'>
                  <button type='button' className='ig-row-number' aria-label={t('infographic.editor.selectRow', { row: rowIndex + 1 })} onClick={() => send({ type: 'select', sel: rowSelection(rowIndex, dims) })}>{rowIndex + 1}</button>
                </div>
                <div role='gridcell' className='ig-star-cell'>
                  <button type='button' className='ig-star' aria-label={t('infographic.editor.highlightRow', { row: rowIndex + 1 })} title={t('infographic.editor.highlightRow', { row: rowIndex + 1 })} aria-pressed={highlighted} onClick={() => change(rowEdits.highlight(rowIndex))}>
                    <Star aria-hidden='true' />
                  </button>
                </div>
                {columns.map((_column, col) => {
                  const issue = issueAt.get(`${rowIndex}:${col}`);
                  const disabled = route && col === 1;
                  const selected = inRange(range, { row: rowIndex, col });
                  const isActive = active.row === rowIndex && active.col === col;
                  return <div key={col} role='gridcell' className='ig-cell' data-cell data-row={rowIndex} data-col={col} data-selected={selected || undefined} data-active={isActive || undefined} data-invalid={issue ? 'true' : undefined} data-disabled={disabled || undefined} aria-selected={selected} aria-invalid={issue ? true : undefined} title={issue ? issueText(t, block, { ...issue, child: undefined }) : disabled ? t('infographic.editor.routeNoPosition') : undefined}>{disabled ? '—' : matrix[rowIndex]?.[col]}</div>;
                })}
                <div role='gridcell' className='ig-menu-cell'>
                  <RowMenu label={t('infographic.editor.rowMenu', { row: rowIndex + 1 })} onDone={focusInput} items={[{ id: 'above', label: t('infographic.editor.insertAbove'), run: () => change(rowEdits.insert(rowIndex)) }, { id: 'below', label: t('infographic.editor.insertBelow'), run: () => change(rowEdits.insert(rowIndex + 1)) }, { id: 'duplicate', label: t('infographic.editor.duplicateRow'), run: () => change(rowEdits.duplicate(rowIndex)) }, { id: 'up', label: t('infographic.editor.moveUp'), disabled: rowIndex === 0, run: () => change(rowEdits.move(rowIndex, rowIndex - 1)) }, { id: 'down', label: t('infographic.editor.moveDown'), disabled: rowIndex === rows.length - 1, run: () => change(rowEdits.move(rowIndex, rowIndex + 1)) }, { id: 'delete', label: t('infographic.editor.deleteRow'), danger: true, run: () => change(rowEdits.remove(rowIndex)) }]} />
                </div>
              </div>
            );
          })}
        </div>
        {!rows.length && <p className='ig-empty'>{t('infographic.editor.noRows')}</p>}
        <input
          ref={inputRef}
          className='ig-cell-input'
          data-editing={edit ? 'true' : undefined}
          type='text'
          autoComplete='off'
          spellCheck={false}
          aria-label={dims.rows ? t('infographic.editor.cellLabel', { column: columnLabel(t, block.kind, active.col), row: active.row + 1 }) : t('infographic.editor.noRows')}
          disabled={!dims.rows}
          onKeyDown={onKeyDown}
          onChange={event => onInput(event.target.value)}
          onCompositionStart={() => onInput(inputRef.current?.value ?? '')}
          onCopy={event => onCopy(event, false)}
          onCut={event => onCopy(event, true)}
          onPaste={onPaste}
          onBlur={() => {
            if (edit) commit('stay');
          }}
        />
      </div>
      <button type='button' className='ig-add-row' onClick={() => change(rowEdits.insert(rows.length))}>
        <Plus aria-hidden='true' />
        {t('infographic.editor.addRow')}
      </button>
    </div>
  );
});
