import { useEffect, useSyncExternalStore } from 'react';
import { applyTheme, getThemeChoice, getThemeView, setThemeChoice, subscribeThemeChoice } from '../lib/themes.js';

/** Reads and changes the shared theme choice; any component may use it. */
export const useThemeChoice = () => useSyncExternalStore(subscribeThemeChoice, getThemeChoice);

/** The shared choice with the family the page shows for it, which a detected e-reader can make E-ink. */
export const useThemeView = () => useSyncExternalStore(subscribeThemeChoice, getThemeView, getThemeView);

/** Applies the shared theme choice to the document; mount once at the app root. */
export function useTheme() {
  // A new view comes with every change of the choice and with the e-reader detection, which can change the family shown.
  const view = useThemeView();

  useEffect(() => {
    const { choice } = view;
    applyTheme(choice);
    if (choice.mode !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme(choice);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [view]);

  return { currentTheme: view.choice, handleSelectTheme: setThemeChoice };
}
