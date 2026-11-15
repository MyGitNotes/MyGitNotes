/**
 * E-reader detection. CSS cannot tell an e-ink screen apart (a BOOX Page reports colour, fast updates and no
 * monochrome), and its user agent string is reduced, so the only signal is the device model Chromium offers as a
 * high-entropy client hint. The model is a hint, never a decision: it only picks the theme a visitor who has not
 * chosen one gets.
 */

/** BOOX model names, longest first so that "Note Air" wins over "Note" and "Max Lumi" over "Max". */
const BOOX_MODEL = /^(?:note\s*air|tab\s*ultra|tab\s*mini|max\s*lumi|palma|page|leaf|poke|note|nova|lumi|max|go)/i;

/**
 * Whether a device model names a BOOX e-reader: a BOOX name at the start, ended by the end of the string, a digit, a
 * space or a capital ("Go103", "Go Color 7", "NoteX3", "MaxLumi2"), not by a lower-case letter ("Pages", "Google").
 */
export function isEReaderModel(model: string): boolean {
  const name = model.trim();
  const match = BOOX_MODEL.exec(name);
  return match !== null && !/^[a-z]/.test(name.slice(match[0].length));
}

interface ModelHints {
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; }>;
}

/** Asks the browser for the device model and checks it; false where the browser has no model hint or refuses it. */
export async function detectEReader(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<boolean> {
  const hints = (nav as (Navigator & { userAgentData?: ModelHints; }) | undefined)?.userAgentData;
  if (typeof hints?.getHighEntropyValues !== 'function') return false;
  try {
    const { model } = await hints.getHighEntropyValues(['model']);
    return isEReaderModel(model ?? '');
  } catch {
    return false;
  }
}
