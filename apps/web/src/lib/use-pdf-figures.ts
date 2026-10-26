import { useEffect } from 'react';
import { hydratePdfFigures } from './annotations/pdf-figure.js';
import { useTranslation } from './i18n/index.js';

/** Turns the PDF annotation figures inside a surface that mounts `renderNote` HTML into page viewers. */
export function usePdfFigures(surface: { readonly current: HTMLElement | null; }, html: string) {
  const { t } = useTranslation();
  useEffect(() => surface.current ? hydratePdfFigures(surface.current, { t }) : undefined, [surface, html, t]);
}
