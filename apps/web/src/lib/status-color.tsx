import { createContext, type ReactNode, useContext } from 'react';
import { type StatusColor, STATUS_CYCLE, statusColor } from '@mygitnotes/core/note-status';
import { useThemeChoice } from '../app/useTheme.js';
import { PALETTE_FAMILIES, type PaletteMode, type PaletteVariant, STATUS_PALETTE } from './palettes.js';
import type { NotebookStatus, StatusColorName } from './types.js';

/** The class that paints a `.status-dot`; the first four palette colours are the theme's success, info, warning and danger tokens. */
export function statusDotClass(color: StatusColor): string {
  switch (color) {
    case 'green':
      return 'bg-success';
    case 'blue':
      return 'bg-info';
    case 'amber':
      return 'bg-warning';
    case 'red':
      return 'bg-danger';
    case 'purple':
      return 'bg-status-purple';
    case 'teal':
      return 'bg-status-teal';
    case 'pink':
      return 'bg-status-pink';
    case 'gray':
      return 'bg-status-gray';
    case 'primary':
      return 'bg-primary';
    case 'muted':
      return 'bg-muted';
  }
}

const MODES: readonly PaletteMode[] = ['light', 'dark'];

/** The hex a palette colour has in one variant: green, blue, amber and red are the variant's own tokens. */
function paletteHex(color: StatusColorName, variant: PaletteVariant, mode: PaletteMode): string {
  switch (color) {
    case 'green':
      return variant.success;
    case 'blue':
      return variant.info;
    case 'amber':
      return variant.warning;
    case 'red':
      return variant.danger;
    default:
      return STATUS_PALETTE[mode][color];
  }
}

/** Squared distance in OKLab, where equal steps look about equally different. */
function colorDistance(a: string, b: string): number {
  const [l1, m1, s1] = oklab(a);
  const [l2, m2, s2] = oklab(b);
  return (l1 - l2) ** 2 + (m1 - m2) ** 2 + (s1 - s2) ** 2;
}

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .7936177850 * m - .0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .8086757660 * s];
}

/**
 * The cycle colour closest to a theme family's primary, summed over its light and dark variants so it does not change
 * with the mode. An inbox wears the primary, so a cycled status must not look like one.
 */
export function statusAvoidColor(familyId: string): StatusColorName {
  const family = PALETTE_FAMILIES.find(candidate => candidate.id === familyId) ?? PALETTE_FAMILIES[0];
  const distance = (color: StatusColorName) => MODES.reduce((sum, mode) => sum + colorDistance(family.variants[mode].primary, paletteHex(color, family.variants[mode], mode)), 0);
  return STATUS_CYCLE.reduce((closest, color) => distance(color) < distance(closest) ? color : closest);
}

/** The cycle colour the active theme family asks statuses to skip. */
export const useStatusAvoidColor = (): StatusColorName => statusAvoidColor(useThemeChoice().familyId);

const StatusColorContext = createContext<readonly NotebookStatus[]>([]);

/** Gives the status dots below it the statuses of the notebooks being shown, which decide each dot's colour. */
export function StatusColorProvider({ statuses, children }: { statuses: readonly NotebookStatus[]; children: ReactNode; }) {
  return <StatusColorContext.Provider value={statuses}>{children}</StatusColorContext.Provider>;
}

/** The dot class for a status in the notebooks being shown. Every status dot in the app resolves through this. */
export function useStatusDotClass(): (status: string) => string {
  const statuses = useContext(StatusColorContext);
  const avoid = useStatusAvoidColor();
  return status => statusDotClass(statusColor(status, statuses, avoid));
}
