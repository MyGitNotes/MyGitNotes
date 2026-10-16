import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useState } from 'react';
import { useTranslation } from '../../lib/i18n/index.js';
import { ASSISTANT_DOCK_KEY_STEP, assistantDock, assistantDockWidth, maxAssistantDockWidth, MIN_ASSISTANT_DOCK_WIDTH, useAssistantDock } from '../../lib/assistant-dock.js';
import { usePhone } from '../../lib/use-phone.js';
import { AgentPanel } from '../pi-agent/AgentPanel.js';
import { useAssistantDockVisible } from './useAssistantDockVisible.js';
import './assistant-dock.css';

/** The window's width, followed as it changes, since the dock's bounds are fractions of it. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth);
  useLayoutEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

/**
 * The assistant: Pi's conversation in a column on the right edge of the window. It is a sibling of the app shell in
 * the layout, so the page reflows beside it instead of sitting under it; the zoom overlays end at its left edge through
 * `--assistant-dock-width`. Below 768px it is a full-screen sheet above the page.
 */
export function AssistantDock({ onOpenAgents, agentsDisabled }: { onOpenAgents?: () => void; agentsDisabled?: boolean; }) {
  const { t } = useTranslation();
  const visible = useAssistantDockVisible();
  const dock = useAssistantDock();
  const phone = usePhone();
  const viewport = useViewportWidth();
  const width = assistantDockWidth(dock, viewport);
  const reserved = visible && !phone ? width : 0;
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--assistant-dock-width', `${reserved}px`);
    return () => document.documentElement.style.setProperty('--assistant-dock-width', '0px');
  }, [reserved]);
  if (!visible) return null;
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) assistantDock.setWidth(window.innerWidth - event.clientX, window.innerWidth);
  };
  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  // The dock is on the right, so the edge moves left to widen it.
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? ASSISTANT_DOCK_KEY_STEP : event.key === 'ArrowRight' ? -ASSISTANT_DOCK_KEY_STEP : 0;
    if (!step) return;
    event.preventDefault();
    assistantDock.setWidth(width + step, window.innerWidth);
  };
  return (
    <div id='assistant-dock' className='assistant-dock' data-expanded={dock.expanded || undefined} style={phone ? undefined : { width }}>
      <AgentPanel
        dock={{
          expanded: dock.expanded,
          onToggleExpanded: phone ? undefined : () => assistantDock.setExpanded(!dock.expanded),
          onClose: assistantDock.close,
          // On a phone the sheet covers the page, so it steps aside for the page it opened.
          onOpenAgents: onOpenAgents && (() => {
            onOpenAgents();
            if (phone) assistantDock.close();
          }),
          agentsDisabled,
        }}
      />
      {/* After the panel in the tab order, so focus runs header, conversation, message box; it sits on the dock's left edge. */}
      {!phone && <div className='assistant-dock-resizer' role='separator' aria-orientation='vertical' aria-label={t('piAgent.dock.resize')} aria-valuenow={width} aria-valuemin={MIN_ASSISTANT_DOCK_WIDTH} aria-valuemax={maxAssistantDockWidth(viewport)} tabIndex={0} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onKeyDown={resizeByKey} />}
    </div>
  );
}
