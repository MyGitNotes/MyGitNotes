import { EINK_FAMILY, INK, PALETTE_FAMILIES, type PaletteFamily, type PaletteMode, type PaletteVariant, STATUS_PALETTE } from './palettes.js';

export type ThemeMode = PaletteMode | 'system';

export interface ThemeChoice {
  familyId: string;
  mode: ThemeMode;
}

/** What an edition registers: families that join the built-ins, and which family a visitor with no saved choice gets. */
export interface ThemeRegistration {
  /** A family whose id equals a built-in's replaces it in its place; any other is listed after the built-ins. */
  families?: readonly PaletteFamily[];
  /** The id of a built-in or registered family; Flexoki when left out. */
  defaultFamily?: string;
}

/** What the page shows for the saved choice: the family it wears, and whether a detected e-reader picked that family. */
export interface ThemeView {
  choice: ThemeChoice;
  familyId: string;
  /** E-ink is shown because an e-reader was detected and the choice is still the untouched default. */
  auto: boolean;
}

/** The built-in family an e-reader gets while its visitor has chosen no theme. */
export const EINK_FAMILY_ID = EINK_FAMILY.id;

let themeChoice: ThemeChoice | undefined;
/** Whether the person picked a theme in a picker; until then the default choice yields to a detected e-reader. */
let themeChosen: boolean | undefined;
let eReaderDetected: boolean | undefined;
let themeView: ThemeView | undefined;

/** The first built-in family, Flexoki, is the community default. */
let families: readonly PaletteFamily[] = PALETTE_FAMILIES;
let defaultFamily: PaletteFamily = PALETTE_FAMILIES[0];

/**
 * Fills the registry; call it before the first render. Each call starts over from the built-ins, so `registerThemes({})` resets.
 * A `defaultFamily` that names no known family throws and leaves the earlier registry in place.
 */
export function registerThemes({ families: extra = [], defaultFamily: defaultId }: ThemeRegistration): void {
  const byId = new Map(PALETTE_FAMILIES.map(family => [family.id, family]));
  for (const family of extra) byId.set(family.id, family);
  const merged = [...byId.values()];
  const chosen = defaultId === undefined ? merged[0] : merged.find(family => family.id === defaultId);
  if (!chosen) throw new Error(`themes.defaultFamily "${defaultId}" names no known palette family (known: ${merged.map(family => family.id).join(', ')})`);
  families = merged;
  defaultFamily = chosen;
  themeChoice = undefined;
  themeChosen = undefined;
  eReaderDetected = undefined;
  themeView = undefined;
}

/** The built-in families followed by the registered ones; the settings pickers list these. */
export const listFamilies = (): readonly PaletteFamily[] => families;

const THEME_FAMILY_KEY = 'github_notes_theme';
const THEME_MODE_KEY = 'github_notes_theme_mode';
/** The resolved colours, read by the inline script in index.html so the first paint already wears the theme. */
const THEME_TOKENS_KEY = 'github_notes_theme_tokens';
/** Set once the person picks a theme; a saved default family and mode alone may come from a visit that chose nothing. */
const THEME_CHOSEN_KEY = 'github_notes_theme_chosen';
/** The last e-reader detection, so the first render of the next visit already knows it. */
const E_READER_KEY = 'github_notes_e_reader';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch { /* The flag lasts for this page only. */ }
}

/** Retired single-mode themes; a saved retired id still tells us the mode the user chose. */
const RETIRED_THEME_MODES: Record<string, PaletteMode> = { 'clean-indigo': 'light', 'warm-sepia': 'light', 'forest-emerald': 'light', 'github-dark': 'dark', 'nord-arctic': 'dark', 'midnight-violet': 'dark' };

export function getFamily(id: string): PaletteFamily {
  return families.find(family => family.id === id) ?? defaultFamily;
}

function isMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Unknown or retired family ids resolve to the edition's default family (Flexoki in the community edition); the saved mode is kept. */
export function resolveThemeChoice(savedFamily: string | null, savedMode: string | null): ThemeChoice {
  const familyId = families.find(family => family.id === savedFamily)?.id ?? defaultFamily.id;
  const mode = isMode(savedMode) ? savedMode : (savedFamily && RETIRED_THEME_MODES[savedFamily]) || 'system';
  return { familyId, mode };
}

function getSavedTheme(): ThemeChoice {
  try {
    return resolveThemeChoice(localStorage.getItem(THEME_FAMILY_KEY), localStorage.getItem(THEME_MODE_KEY));
  } catch {
    return { familyId: defaultFamily.id, mode: 'system' };
  }
}

const themeListeners = new Set<() => void>();

/** Current theme choice, shared by the settings dialog and the editor's view panel. */
export const getThemeChoice = () => themeChoice ??= getSavedTheme();

export function subscribeThemeChoice(listener: () => void) {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

function notifyTheme() {
  themeView = undefined;
  for (const listener of themeListeners) listener();
}

/** The person's own choice from a picker; from then on it wins over a detected e-reader, the default choice included. */
export function setThemeChoice(choice: ThemeChoice) {
  themeChoice = choice;
  if (!themeChosen) writeFlag(THEME_CHOSEN_KEY, true);
  themeChosen = true;
  notifyTheme();
}

/** Records the e-reader detection made at startup (`detectEReader`), kept for the next visit's first render. */
export function setEReaderDetected(detected: boolean): void {
  writeFlag(E_READER_KEY, detected);
  if (eReaderDetected === detected) return;
  eReaderDetected = detected;
  notifyTheme();
}

/** The family a choice shows: E-ink on a detected e-reader while the choice is the default one nobody picked. */
function viewOf(choice: ThemeChoice): ThemeView {
  themeChosen ??= readFlag(THEME_CHOSEN_KEY);
  eReaderDetected ??= readFlag(E_READER_KEY);
  const untouched = !themeChosen && choice.familyId === defaultFamily.id && choice.mode === 'system';
  const auto = eReaderDetected && untouched && families.some(family => family.id === EINK_FAMILY_ID) && defaultFamily.id !== EINK_FAMILY_ID;
  return { choice, familyId: auto ? EINK_FAMILY_ID : choice.familyId, auto };
}

/** The current choice and what it shows; the same object until either changes, so React can subscribe to it. */
export function getThemeView(): ThemeView {
  const choice = getThemeChoice();
  if (themeView?.choice !== choice) themeView = viewOf(choice);
  return themeView;
}

export function resolveMode(mode: ThemeMode): PaletteMode {
  if (mode !== 'system') return mode;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function buttonTextColor(background: string): string {
  const hex = background.replace('#', '');
  const rgb = [0, 2, 4].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? INK.black : INK.white;
}

/** CSS custom properties for one variant; every UI colour resolves from these. */
export function themeTokens(variant: PaletteVariant): Record<string, string> {
  const tokens: Record<string, string> = { '--color-bg': variant.background, '--color-surface': variant.surface, '--color-sidebar': variant.sidebar, '--color-border': variant.border, '--color-text': variant.text, '--color-muted': variant.muted, '--color-primary': variant.primary, '--color-primary-hover': variant.primaryHover, '--color-on-primary': buttonTextColor(variant.primary), '--color-on-primary-hover': buttonTextColor(variant.primaryHover), '--color-selection': variant.selection, '--color-code-bg': variant.codeBackground, '--color-danger': variant.danger, '--color-on-danger': buttonTextColor(variant.danger), '--color-warning': variant.warning, '--color-on-warning': buttonTextColor(variant.warning), '--color-success': variant.success, '--color-on-success': buttonTextColor(variant.success), '--color-info': variant.info, '--color-on-info': buttonTextColor(variant.info), '--color-scrim': INK.black, '--color-on-scrim': INK.white };
  variant.accents.forEach((accent, index) => {
    tokens[`--color-accent-${index + 1}`] = accent;
  });
  return tokens;
}

/** CSS custom properties for the notebook status colours of one mode; the other four status colours are the theme's own tokens. */
export function statusTokens(mode: PaletteMode): Record<string, string> {
  return Object.fromEntries(Object.entries(STATUS_PALETTE[mode]).map(([name, value]) => [`--color-status-${name}`, value]));
}

/** The mode a family is shown in for a light, dark or system choice. */
function familyMode(family: PaletteFamily, mode: ThemeMode): PaletteMode {
  return family.fixedMode ?? resolveMode(mode);
}

/** Every custom property `applyTheme` sets for a family in one mode: the variant's, the status colours and the family's own. */
export function familyTokens(family: PaletteFamily, mode: PaletteMode): Record<string, string> {
  const shown = family.fixedMode ?? mode;
  return { ...themeTokens(family.variants[shown]), ...statusTokens(shown), ...family.tokens };
}

/**
 * Paints the browser's own chrome (the title bar of an installed app, the status bar of a phone) in the theme's background.
 * index.html ships one tag per colour scheme for the first paint; the person's choice can differ from the system's, so the first
 * tag takes the colour for every scheme and the rest go.
 */
export function syncThemeColor(color: string, doc: Document = document): void {
  const [first, ...rest] = doc.head.querySelectorAll('meta[name="theme-color"]');
  const meta = first ?? doc.head.appendChild(Object.assign(doc.createElement('meta'), { name: 'theme-color' }));
  meta.removeAttribute('media');
  meta.setAttribute('content', color);
  for (const extra of rest) extra.remove();
}

export function applyTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_FAMILY_KEY, choice.familyId);
    localStorage.setItem(THEME_MODE_KEY, choice.mode);
  } catch { /* Keep the in-page theme. */ }

  const family = getFamily(viewOf(choice).familyId);
  const mode = familyMode(family, choice.mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', family.id);
  root.setAttribute('data-theme-mode', mode);
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  const tokens = familyTokens(family, mode);
  // A family's own tokens stay on the root until removed; the next family falls back to the ones index.css derives.
  for (const other of families) for (const name of Object.keys(other.tokens ?? {})) if (!(name in tokens)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  syncThemeColor(tokens['--color-bg']);
  try {
    localStorage.setItem(THEME_TOKENS_KEY, JSON.stringify({ mode, tokens }));
  } catch { /* The first paint falls back to the default colours. */ }
}
