import { useEffect, useState } from 'react';

/** How long a collapse or expand takes; the stylesheets' transitions use the same 200ms. */
export const FOLD_MS = 200;

/**
 * True from the render where `folded` changes until the animation has had time to finish. Stylesheets use it to
 * clip a folding region only while it moves, so an open region keeps its overflow (menus, focus rings).
 * It stays false on the first render: a region that starts folded is drawn folded, not animated into it.
 */
export function useFoldAnimation(folded: boolean): boolean {
  const [state, setState] = useState({ folded, animating: false });
  // Derived during render, so the changed attribute and the animating flag reach the DOM in one commit.
  if (state.folded !== folded) setState({ folded, animating: true });
  useEffect(() => {
    if (!state.animating) return;
    const timer = setTimeout(() => setState(current => ({ ...current, animating: false })), FOLD_MS + 60);
    return () => clearTimeout(timer);
  }, [state]);
  return state.animating || state.folded !== folded;
}
