import { type RefObject, useEffect } from 'react';

/** The agent's message box appears only once its session's history has, which a hosted sandbox can take half a minute to reach. */
const REQUEST_LIFETIME_MS = 60_000;
let requestedAt = 0;
const listeners = new Set<() => void>();

/** The person moved on before the box appeared; it must not take focus from where they went. */
function cancelOnFocusElsewhere(event: FocusEvent) {
  if (event.target instanceof Element && event.target.closest('.pi-agent-panel')) return;
  requestedAt = 0;
  document.removeEventListener('focusin', cancelOnFocusElsewhere, true);
}

/** Asks the agent panel to focus its message box, now or as soon as the box appears. */
export function requestAgentInputFocus() {
  requestedAt = Date.now();
  document.addEventListener('focusin', cancelOnFocusElsewhere, true);
  for (const listener of listeners) listener();
}

/** Focuses `input` while a request is pending; checked after every render, since the box mounts after its panel. */
export function useAgentInputFocusRequest(input: RefObject<HTMLTextAreaElement | null>) {
  const take = () => {
    const element = input.current;
    if (!requestedAt) return;
    if (Date.now() - requestedAt > REQUEST_LIFETIME_MS) requestedAt = 0;
    if (!requestedAt || !element || element.disabled || !element.isConnected) return;
    requestedAt = 0;
    document.removeEventListener('focusin', cancelOnFocusElsewhere, true);
    element.focus();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Every render may be the one that mounts or enables the box.
  useEffect(take);
  useEffect(() => {
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `take` reads only the ref and the module's request.
  }, [input]);
}
