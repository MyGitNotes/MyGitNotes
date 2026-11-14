import { useEffect } from 'react';
import { hydrateQrCodes } from './qrcode.js';

/** Draws the QR codes inside a surface that mounts `renderNote` HTML. */
export function useQrCodes(surface: { readonly current: HTMLElement | null; }, html: string) {
  useEffect(() => surface.current ? hydrateQrCodes(surface.current) : undefined, [surface, html]);
}
