import { type Dispatch, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, X } from 'lucide-react';
import { canAddChild, childNameKey } from '../../lib/infographics/grid.js';
import { childEdits, type EditorAction, type EditorState } from '../../lib/infographics/editor-state.js';
import { KIND_SPECS } from '../../lib/infographics/model.js';
import { withAttr } from '../../lib/infographics/grid.js';
import { childName, childTabLabel, type Translate } from './labels.js';

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  t: Translate;
}

/** The child containers of a block (scenarios, series, lanes, groups) as tabs, with add, remove, rename and reorder. */
export function ChildTabs({ state, dispatch, t }: Props) {
  const { block, tab } = state;
  const spec = KIND_SPECS[block.kind].child;
  const [renaming, setRenaming] = useState<number | null>(null);
  const cancelled = useRef(false);
  if (!spec) return null;
  const name = childName(t, block.kind);
  const nameKey = childNameKey(block.kind);
  const nameSpec = spec.attrs.find(attr => attr.key === nameKey) ?? { key: nameKey, type: 'text' as const };
  const addable = canAddChild(block);

  const rename = (index: number, value: string) => {
    setRenaming(null);
    dispatch({ type: 'change', apply: snapshot => ({ block: { ...snapshot.block, children: snapshot.block.children.map((child, i) => i === index ? { ...child, attrs: withAttr(child.attrs, nameSpec, value.trim()) } : child) } }) });
  };

  return (
    <div className='ig-tabs-row'>
      <div className='ig-tabs' role='tablist' aria-label={t('infographic.editor.childList', { name })}>
        {block.children.map((_child, index) =>
          renaming === index
            ? (
              <input
                key={index}
                className='ig-tab-rename'
                autoFocus
                aria-label={t('infographic.editor.renameChild', { name })}
                defaultValue={block.children[index].attrs[nameKey] ?? ''}
                onFocus={event => event.currentTarget.select()}
                onBlur={event => cancelled.current ? (cancelled.current = false) : rename(index, event.currentTarget.value)}
                onKeyDown={event => {
                  event.stopPropagation();
                  if (event.key === 'Enter') event.currentTarget.blur();
                  else if (event.key === 'Escape') {
                    cancelled.current = true;
                    setRenaming(null);
                  }
                }}
              />
            )
            : <button key={index} type='button' role='tab' className='ig-tab' aria-selected={index === tab} tabIndex={index === tab ? 0 : -1} onClick={() => dispatch({ type: 'tab', tab: index })} onDoubleClick={() => setRenaming(index)}>{childTabLabel(t, block, index)}</button>
        )}
        <button type='button' className='ig-tab-tool' aria-label={t('infographic.editor.addChild', { name })} title={addable ? t('infographic.editor.addChild', { name }) : t('infographic.editor.childLimit', { count: spec.max ?? 0 })} disabled={!addable} onClick={() => dispatch({ type: 'change', apply: childEdits.add() })}>
          <Plus aria-hidden='true' />
        </button>
      </div>
      {block.children.length > 0 && (
        <div className='ig-tab-tools' role='group' aria-label={childTabLabel(t, block, tab)}>
          <button type='button' className='ig-tab-tool' aria-label={t('infographic.editor.moveChildLeft', { name })} title={t('infographic.editor.moveChildLeft', { name })} disabled={tab === 0} onClick={() => dispatch({ type: 'change', apply: childEdits.move(tab, tab - 1) })}>
            <ChevronLeft aria-hidden='true' />
          </button>
          <button type='button' className='ig-tab-tool' aria-label={t('infographic.editor.moveChildRight', { name })} title={t('infographic.editor.moveChildRight', { name })} disabled={tab >= block.children.length - 1} onClick={() => dispatch({ type: 'change', apply: childEdits.move(tab, tab + 1) })}>
            <ChevronRight aria-hidden='true' />
          </button>
          <button type='button' className='ig-tab-tool' aria-label={t('infographic.editor.renameChild', { name })} title={t('infographic.editor.renameChild', { name })} onClick={() => setRenaming(tab)}>
            <Pencil aria-hidden='true' />
          </button>
          <button type='button' className='ig-tab-tool' data-danger aria-label={t('infographic.editor.removeChild', { name })} title={t('infographic.editor.removeChild', { name })} onClick={() => dispatch({ type: 'change', apply: childEdits.remove(tab) })}>
            <X aria-hidden='true' />
          </button>
        </div>
      )}
    </div>
  );
}
