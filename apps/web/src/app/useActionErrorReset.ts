import { useEffect, useRef } from 'react';

/**
 * Clears the page's action error once the person moves on to another address (another note, folder, filter or search),
 * so a refusal such as 「A note already exists…」 is said where it happened and not left above lists it no longer concerns.
 */
export function useActionErrorReset(address: string, setActionError: (message: string) => void): void {
  const shown = useRef(address);
  useEffect(() => {
    if (shown.current === address) return;
    shown.current = address;
    setActionError('');
  }, [address, setActionError]);
}
