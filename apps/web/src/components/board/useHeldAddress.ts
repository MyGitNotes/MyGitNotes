import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Location, useLocation, useNavigate } from 'react-router-dom';

/**
 * What a view shows of what its address names (a board of the 白板 page, the note of a board's side panel), held while
 * the address moves on until what it shows is saved. Back and Forward change the address at once, and the editor on
 * screen must not unmount unsaved: `save` saves what is shown (true when nothing needs saving), then the view follows
 * the address; a refused save keeps it, and the address it showed is put back in place of the new one. A change the
 * view makes itself after saving announces where it goes (`expect`) and is followed without saving again. While
 * `owns` is false the address names something else (the 白板 page is leaving this board), so the view holds still.
 */
export function useHeldAddress<T>(named: T, keyOf: (value: T) => string, save: (shown: T) => Promise<boolean>, owns = true) {
  const location = useLocation();
  const navigate = useNavigate();
  const [shown, setShown] = useState(named);
  const shownAt = useRef<Location>(location);
  const expected = useRef<string | undefined>(undefined);
  const settling = useRef(false);
  const latest = useRef({ named, save, shown });
  useLayoutEffect(() => {
    latest.current = { named, save, shown };
  });
  const namedKey = keyOf(named), shownKey = keyOf(shown);
  useEffect(() => {
    if (!owns) return;
    if (namedKey === shownKey) {
      shownAt.current = location;
      expected.current = undefined;
      return;
    }
    if (settling.current) return;
    settling.current = true;
    const known = expected.current === namedKey;
    expected.current = undefined;
    void (known ? Promise.resolve(true) : latest.current.save(latest.current.shown)).then(saved => {
      settling.current = false;
      if (saved) return setShown(latest.current.named);
      const { pathname, search, hash, state } = shownAt.current;
      navigate({ pathname, search, hash }, { replace: true, state });
    });
  }, [namedKey, shownKey, owns, location, navigate]);
  return { shown, expect: (value: T) => void (expected.current = keyOf(value)) };
}
