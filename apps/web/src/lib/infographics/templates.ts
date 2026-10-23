/** The working example the editor inserts for each infographic kind, in the writer's language. */

import type { TranslationKey } from '../i18n/en.js';
import { INFOGRAPHIC_KINDS, type InfographicKind } from './model.js';

export type InfographicTranslate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** The kinds in the order the insert menu lists them. */
export const INFOGRAPHIC_MENU: readonly InfographicKind[] = INFOGRAPHIC_KINDS;

/** The source to insert for `kind`: a complete block that renders without edits, with its text in `t`'s language. */
export function infographicTemplate(kind: InfographicKind, t: InfographicTranslate): string {
  return t(`infographic.template.${kind}` as TranslationKey);
}
