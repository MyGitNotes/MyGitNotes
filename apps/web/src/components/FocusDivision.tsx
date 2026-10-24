import './focus.css';
import React from 'react';
import { type FocusDivision, type FocusLayout, type FocusNode, focusPanes, legacyFocusTree } from '@mygitnotes/core/focus-page';
import { useTranslation } from '../lib/i18n/index.js';

/** A layout's splits as nested boxes; `leaf` draws one pane. */
const LayoutNode: React.FC<{ node: FocusNode; leaf: (pane: string) => React.ReactNode; }> = ({ node, leaf }) => {
  if (node.kind === 'pane') return <>{leaf(node.id)}</>;
  return <span className='focus-layout-split' data-orientation={node.orientation}>{node.children.map(child => <LayoutNode key={child.id} node={child} leaf={leaf} />)}</span>;
};

/** The layout's panes drawn as a small diagram, used in the Focus lists and the division picker. */
export const LayoutIcon: React.FC<{ layout: FocusLayout; }> = ({ layout }) => (
  <span className='focus-layout-icon' aria-hidden='true'>
    <LayoutNode node={layout.root} leaf={pane => <span key={pane} className='focus-layout-pane' />} />
  </span>
);

/** A division as a layout; empty panes are enough for the drawing, and no division has more than four. */
export const divisionLayout = (division: FocusDivision): FocusLayout => ({ root: legacyFocusTree(division, [[], [], [], []]) });

export const DivisionIcon: React.FC<{ division: FocusDivision; }> = ({ division }) => <LayoutIcon layout={divisionLayout(division)} />;

/** A larger layout drawing whose panes are choices; `current` marks the pane that already holds the item. */
export const LayoutThumbnail: React.FC<{ layout: FocusLayout; selected: string; current?: string; label: string; onSelect: (pane: string) => void; }> = ({ layout, selected, current, label, onSelect }) => {
  const { t } = useTranslation();
  const panes = focusPanes(layout).map(pane => pane.id);
  return (
    <div
      className='focus-layout-thumbnail'
      role='radiogroup'
      aria-label={label}
      onKeyDown={event => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const next = (panes.indexOf(selected) + step + panes.length) % panes.length;
        onSelect(panes[next]);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
      }}
    >
      <LayoutNode
        node={layout.root}
        leaf={pane => (
          <button
            key={pane}
            type='button'
            role='radio'
            className='focus-layout-pane'
            aria-checked={pane === selected}
            tabIndex={pane === selected ? 0 : -1}
            data-current={pane === current || undefined}
            onClick={() => onSelect(pane)}
          >
            <span>{t('focus.paneNumber', { number: panes.indexOf(pane) + 1 })}</span>
            {pane === current && <small>{t('focus.currentPane')}</small>}
          </button>
        )}
      />
    </div>
  );
};
