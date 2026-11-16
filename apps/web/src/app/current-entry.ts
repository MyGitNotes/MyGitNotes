import { useCallback, useContext } from 'react';
import { type Location, UNSAFE_NavigationContext } from 'react-router-dom';

/**
 * The location of the history entry the browser is on now. The location a render saw falls behind the history once a
 * navigation is made: until that render's effects ran, and while React Router renders the next location as a transition.
 */
export function useHistoryLocation(): () => Location {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  // The navigator of BrowserRouter and MemoryRouter is their history, which tells the entry it is on.
  const history = navigator as { location?: Location; };
  if (!history.location) throw new Error('The address of the page needs a router whose navigator tells its location (BrowserRouter or MemoryRouter).');
  return useCallback(() => history.location!, [history]);
}

/**
 * Whether the history is still on the entry `key`. An address computed from the location a render saw replaces the
 * entry it was computed for only, never a newer one the person made meanwhile.
 */
export function useCurrentEntry() {
  const current = useHistoryLocation();
  return useCallback((key: string) => current().key === key, [current]);
}
