/** How the note editor shows a Markdown note: the live editor, the source text, or the source beside the rendered note. */
export type EditorMode = 'live' | 'raw' | 'split';

/** The query parameter that names the editor mode of the page. */
export const EDITOR_MODE_PARAM = 'mode';

/** Each mode as the URL names it; live, the default, is left out of the URL. */
const URL_NAMES: Record<EditorMode, string> = { live: 'live', raw: 'source', split: 'split' };
const MODES_BY_NAME = new Map(Object.entries(URL_NAMES).map(([mode, name]) => [name, mode as EditorMode]));

/** The mode `?mode=live|source|split` names; live when the URL names none or one it does not know. */
export function editorModeOf(search: string): EditorMode {
  const name = new URLSearchParams(search).get(EDITOR_MODE_PARAM);
  return (name !== null && MODES_BY_NAME.get(name)) || 'live';
}

/** The decoded name of one `name=value` part of a query. */
export function queryPartName(part: string): string {
  const name = part.split('=', 1)[0]!.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * `search` with the mode set: a mode already named is replaced in its place, a new one goes last, and live is taken
 * out. Every other part of the query is kept as written (a bare `zoom` stays bare). Answers `?…`, or an empty string
 * when nothing is left.
 */
export function searchWithEditorMode(search: string, mode: EditorMode): string {
  const parts = search.replace(/^\?/, '').split('&').filter(Boolean);
  const named = `${EDITOR_MODE_PARAM}=${URL_NAMES[mode]}`;
  const at = parts.findIndex(part => queryPartName(part) === EDITOR_MODE_PARAM);
  const kept = parts.filter(part => queryPartName(part) !== EDITOR_MODE_PARAM);
  if (mode !== 'live') kept.splice(at === -1 ? kept.length : at, 0, named);
  return kept.length ? `?${kept.join('&')}` : '';
}

/**
 * The mode an editor shows for the mode the URL names: split needs zoom on a screen wider than a phone, so a phone and
 * a Focus pane show live instead, leaving the URL as it is.
 */
export function shownEditorMode(mode: EditorMode, { frame, phone }: { frame: 'zoom' | 'pane'; phone: boolean; }): EditorMode {
  return mode === 'split' && (phone || frame !== 'zoom') ? 'live' : mode;
}
