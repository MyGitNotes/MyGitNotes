import { createElement, useEffect, useState } from 'react';
import { loadLucideIcons, type LucideIcon, lucideIconsLoaded } from '../lib/icons/lucide-registry.js';

/** Whether the Lucide set has loaded; asking starts the load, and the component renders again once it arrives. */
export function useLucideIcons(wanted = true): boolean {
  const [loaded, setLoaded] = useState(lucideIconsLoaded);
  useEffect(() => {
    if (!wanted || loaded) return;
    let current = true;
    loadLucideIcons().then(() => current && setLoaded(true), () => undefined);
    return () => {
      current = false;
    };
  }, [wanted, loaded]);
  return loaded;
}

/** One Lucide icon drawn as an SVG from its shapes, in `currentColor`; `icon` comes from `lucideIcon`. */
export function LucideGlyph({ icon, size = 24, strokeWidth = 2 }: { icon: LucideIcon | undefined; size?: number; strokeWidth?: number; }) {
  return <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={strokeWidth} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>{icon?.children.map(([tag, attributes], index) => createElement(tag, { key: index, ...Object.fromEntries(Object.entries(attributes).filter(([key]) => key !== 'key')) }))}</svg>;
}
