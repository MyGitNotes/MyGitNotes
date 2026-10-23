import type { TranslationKey } from '../../lib/i18n/en.js';
import { en } from '../../lib/i18n/en.js';
import { childNameKey } from '../../lib/infographics/grid.js';
import { type AttrSpec, type CellIssue, childNameOf, type InfographicBlock, type InfographicKind, type InfographicProblem, KIND_SPECS } from '../../lib/infographics/model.js';

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

const known = (key: string): key is TranslationKey => key in en;

export const kindLabel = (t: Translate, kind: InfographicKind) => t(`infographic.kind.${kind}` as TranslationKey);

export const kindPurpose = (t: Translate, kind: InfographicKind) => t(`infographic.kind.${kind}.purpose` as TranslationKey);

/** The header of grid column `index` of `kind`; columns past the kind's own are extra fields. */
export function columnLabel(t: Translate, kind: InfographicKind, index: number): string {
  const column = KIND_SPECS[kind].columns[index];
  return column ? t(`infographic.column.${kind}.${column.key}` as TranslationKey) : t('infographic.editor.extraColumn', { number: index - KIND_SPECS[kind].columns.length + 1 });
}

export function attrLabel(t: Translate, spec: AttrSpec): string {
  const key = `infographic.attr.${spec.key}`;
  return known(key) ? t(key) : spec.key;
}

/** A fixed attribute value (palette, base map, status) in words; an unknown value shows as written. */
export function optionLabel(t: Translate, value: string): string {
  const key = `infographic.option.${value}`;
  return known(key) ? t(key) : value;
}

/** The singular name of the kind's child container: scenario, series, lane or group. */
export function childName(t: Translate, kind: InfographicKind): string {
  const name = childNameOf(kind);
  return name ? t(`infographic.editor.child.${name}` as TranslationKey) : '';
}

/** What a child's tab says: its name attribute, or "Scenario 2" when it has none. */
export function childTabLabel(t: Translate, block: InfographicBlock, index: number): string {
  return block.children[index]?.attrs[childNameKey(block.kind)]?.trim() || t('infographic.editor.childTitle', { name: childName(t, block.kind), number: index + 1 });
}

/** A problem in words; `firstLine` is the document line the block starts on, so the message names the line the writer sees. */
export function problemText(t: Translate, problem: InfographicProblem, firstLine = 1): string {
  return t(`infographic.problem.${problem.code}` as TranslationKey, { line: firstLine + problem.line });
}

export function issueText(t: Translate, block: InfographicBlock, issue: CellIssue): string {
  const message = t(`infographic.issue.${issue.code}` as TranslationKey, { row: issue.row + 1, column: columnLabel(t, block.kind, issue.column) });
  return issue.child === undefined ? message : t('infographic.issue.inChild', { child: childTabLabel(t, block, issue.child), message });
}
