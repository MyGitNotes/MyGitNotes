import { Tooltip } from '../Tooltip.js';
import { Minus, Pencil, Plus, X } from 'lucide-react';
import type { CompilationController } from '../../lib/use-compilation.js';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { I18nContextValue } from '../../lib/i18n/index.js';

interface GraphLanePanelProps {
  t: I18nContextValue['t'];
  activeLane: CompilationRow | undefined;
  onClose: () => void;
  laneRows: CompilationRow[];
  onSelectLane: (id: string) => void;
  showOutside: boolean;
  onToggleShowOutside: (checked: boolean) => void;
  screen: CompilationController | undefined;
  onEditLane: () => void;
  laneMembers: Set<string>;
  visibleSelected: string[];
  onChangeMembership: (add: boolean) => void;
}

/** The lane picker and per-lane actions (edit, save layout, membership) shown when the lane panel is open. */
export function GraphLanePanel({ t, activeLane, onClose, laneRows, onSelectLane, showOutside, onToggleShowOutside, screen, onEditLane, laneMembers, visibleSelected, onChangeMembership }: GraphLanePanelProps) {
  return (
    <section className='graph-lane-panel' aria-label={t('graph.chooseLane')}>
      <header>
        <strong>{activeLane?.name || t('graph.lanes')}</strong>
        <Tooltip label={t(activeLane ? 'graph.minimizeLane' : 'common.close')}>
          <button aria-label={t(activeLane ? 'graph.minimizeLane' : 'common.close')} onClick={onClose}>{activeLane ? <Minus size={16} /> : <X size={16} />}</button>
        </Tooltip>
      </header>
      <select aria-label={t('graph.chooseLane')} value={activeLane?.id || ''} onChange={event => onSelectLane(event.target.value)}>
        <option value=''>{t('graph.allLanes')}</option>
        {laneRows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
      {activeLane && (
        <>
          <label>
            <input type='checkbox' checked={showOutside} onChange={event => onToggleShowOutside(event.target.checked)} />
            {t('graph.showOutsideLane')}
          </label>
          {showOutside && <p>{t('graph.outsideLaneHint')}</p>}
          <Tooltip label={t('screen.editRow')}>
            <button className='ui-button' disabled={!screen?.writable} onClick={onEditLane}>
              <Pencil size={14} />
              {t('screen.editRow')}
            </button>
          </Tooltip>
          {/* A compilation's layout belongs to its whiteboard now; this page keeps a lane's layout for the visit only, so it offers no layout save. */}
          {activeLane.kind === 'custom'
            ? (
              <div className='graph-lane-membership'>
                <button className='ui-button' disabled={!screen?.writable || !visibleSelected.some(path => !laneMembers.has(path))} onClick={() => onChangeMembership(true)}>
                  <Plus size={14} />
                  {t('graph.addToLane')}
                </button>
                <button className='ui-button' disabled={!screen?.writable || !visibleSelected.some(path => laneMembers.has(path))} onClick={() => onChangeMembership(false)}>
                  <Minus size={14} />
                  {t('graph.removeFromLane')}
                </button>
              </div>
            )
            : <p>{t('graph.dynamicLaneHint')}</p>}
        </>
      )}
      {screen?.error && <p role='alert'>{screen.error}</p>}
    </section>
  );
}
