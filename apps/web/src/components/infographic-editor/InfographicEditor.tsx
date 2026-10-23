import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { committed, type EditorState, initialState, reduce } from '../../lib/infographics/editor-state.js';
import { isBlankRow, rowsOf, setAttr, setChildAttr, withoutBlankRows } from '../../lib/infographics/grid.js';
import { type AttrSpec, checkCells, COMMON_ATTRS, type InfographicBlock, KIND_SPECS, parseInfographic, serializeInfographic } from '../../lib/infographics/model.js';
import { AttrField } from './AttrField.js';
import { ChildTabs } from './ChildTabs.js';
import { DataGrid } from './DataGrid.js';
import { childName, childTabLabel, issueText, kindLabel, type Translate } from './labels.js';
import { type PreviewHandle, PreviewPane } from './PreviewPane.js';

export interface InfographicEditorProps {
  /** The block's source, which must parse as an infographic without problems. */
  source: string;
  t: Translate;
  /** The HTML of one figure's source, as the note view draws it. */
  renderFigure: (source: string) => string;
  /** Called once with the block's new source when the writer saves. */
  onSave: (source: string) => void;
  /** Called when the writer leaves without saving. */
  onClose: () => void;
  autoFocus?: boolean;
}

function initial(source: string): EditorState {
  const block = parseInfographic(source);
  if (!block || block.problems.length) throw new Error('The infographic editor opens only blocks the grid can hold.');
  return initialState(block);
}

/**
 * The data editor of one infographic block: attribute fields, child containers as tabs, a spreadsheet-like grid
 * and a preview. The draft lives here; nothing reaches the document until `onSave`.
 */
export function InfographicEditor({ source, t, renderFigure, onSave, onClose, autoFocus = true }: InfographicEditorProps) {
  const [state, dispatch] = useReducer(reduce, source, initial);
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = useRef<PreviewHandle>(null);
  const [firstHtml] = useState(() => renderFigure(serializeInfographic(withoutBlankRows(state.block))));
  const { block, tab } = state;
  const spec = KIND_SPECS[block.kind];
  // A row nobody has filled in yet is a placeholder, not a mistake.
  const issues = useMemo(() => checkCells(block).filter(issue => !isBlankRow(rowsOf(block, issue.child ?? 0)[issue.row] ?? { fields: [] })), [block]);
  const tabIssues = useMemo(() => issues.filter(issue => block.children.length ? issue.child === tab : issue.child === undefined), [issues, block.children.length, tab]);

  const drawn = useRef(block);
  useEffect(() => {
    if (drawn.current === block) return;
    drawn.current = block;
    preview.current?.schedule(block);
  }, [block]);

  /** The draft with the text of the cell being typed, if any, written in. */
  const finalBlock = (pending: string | null): InfographicBlock => committed(latest.current, pending ?? (latest.current.edit ? inputRef.current?.value ?? '' : null)).block;
  const save = (pending: string | null) => onSave(serializeInfographic(withoutBlankRows(finalBlock(pending))));
  const onDraft = (value: string) => {
    // The typed text is previewed without leaving the grid's own state, which is only written at commit.
    preview.current?.schedule(committed({ ...latest.current, edit: latest.current.edit ?? { initial: null, replace: true } }, value).block);
  };

  // A click anywhere but the shared input ends a cell edit first, so no button works on a stale draft (Safari does not blur on a button click).
  const commitPending = (event: ReactPointerEvent) => {
    if (latest.current.edit && event.target !== inputRef.current) dispatch({ type: 'commit', move: 'stay', value: inputRef.current?.value ?? '' });
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      save(null);
    } else if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const setBlockAttr = (attr: AttrSpec) => (value: string | boolean) => dispatch({ type: 'change', merge: `attr:${attr.key}`, apply: snapshot => ({ block: setAttr(snapshot.block, attr, value) }) });
  const setChild = (attr: AttrSpec) => (value: string | boolean) => dispatch({ type: 'change', merge: `child:${tab}:${attr.key}`, apply: snapshot => ({ block: setChildAttr(snapshot.block, snapshot.tab, attr, value) }) });
  const needsChild = Boolean(spec.child?.required) && block.children.length === 0 && block.rows.length === 0;

  return (
    <div className='ig-editor' role='group' aria-label={t('infographic.editor.panel', { kind: kindLabel(t, block.kind) })} onKeyDown={onKeyDown} onPointerDownCapture={commitPending}>
      <div className='ig-editor-head'>
        <span className='ig-badge'>{kindLabel(t, block.kind)}</span>
      </div>
      <fieldset className='ig-attrs'>
        <legend>{t('infographic.editor.attributes')}</legend>
        {[...COMMON_ATTRS, ...spec.attrs].map(attr => <AttrField key={attr.key} spec={attr} value={block.attrs[attr.key]} t={t} onChange={setBlockAttr(attr)} />)}
      </fieldset>
      <div className='ig-data'>
        <h4 className='ig-section'>{t('infographic.editor.data')}</h4>
        <ChildTabs state={state} dispatch={dispatch} t={t} />
        {spec.child && block.children.length > 0 && (
          <fieldset className='ig-attrs ig-child-attrs'>
            <legend>{t('infographic.editor.childAttrs', { name: childTabLabel(t, block, tab) })}</legend>
            {spec.child.attrs.map(attr => <AttrField key={`${tab}:${attr.key}`} spec={attr} value={block.children[tab]?.attrs[attr.key]} t={t} onChange={setChild(attr)} />)}
          </fieldset>
        )}
        {needsChild ? <p className='ig-empty'>{t('infographic.editor.noChild', { name: childName(t, block.kind) })}</p> : <DataGrid state={state} dispatch={dispatch} t={t} issues={tabIssues} inputRef={inputRef} onDraft={onDraft} onSave={save} onClose={onClose} autoFocus={autoFocus} />}
        {issues.length > 0 && (
          <div className='ig-issues' role='group' aria-label={t('infographic.editor.issues')}>
            <h5>{t('infographic.editor.issues')}</h5>
            <ul>
              {issues.map(issue => (
                <li key={`${issue.child ?? ''}:${issue.row}:${issue.column}`}>
                  <button
                    type='button'
                    onClick={() => {
                      if (issue.child !== undefined) dispatch({ type: 'tab', tab: issue.child });
                      dispatch({ type: 'select', sel: { anchor: { row: issue.row, col: issue.column }, focus: { row: issue.row, col: issue.column } } });
                      inputRef.current?.focus();
                    }}
                  >
                    {issueText(t, block, issue)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <h4 className='ig-section'>{t('infographic.editor.preview')}</h4>
      <PreviewPane ref={preview} label={t('infographic.editor.preview')} initial={firstHtml} render={renderFigure} />
      <div className='ig-editor-foot'>
        <span className='ig-hint'>{t('infographic.editor.hint')}</span>
        <div className='ig-actions live-directive-editor-actions'>
          <button type='button' className='live-directive-btn-cancel' onClick={onClose}>{t('infographic.editor.cancel')}</button>
          <button type='button' className='live-directive-btn-save' onClick={() => save(null)}>{t('infographic.editor.save')}</button>
        </div>
      </div>
    </div>
  );
}
