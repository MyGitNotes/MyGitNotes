import type { TranslationKey } from '../../lib/i18n/en.js';
import { en } from '../../lib/i18n/en.js';
import { childNameKey } from '../../lib/infographics/grid.js';
import { type AttrSpec, type CellIssue, childNameOf, type GridInfographicKind, type InfographicBlock, type InfographicKind, type InfographicProblem, KIND_SPECS } from '../../lib/infographics/model.js';

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

const known = (key: string): key is TranslationKey => key in en;

export const kindLabel = (t: Translate, kind: InfographicKind) => t(`infographic.kind.${kind}` as TranslationKey);

export const kindPurpose = (t: Translate, kind: InfographicKind) => t(`infographic.kind.${kind}.purpose` as TranslationKey);

/** The header of grid column `index` of `kind`; columns past the kind's own are extra fields. */
export function columnLabel(t: Translate, kind: GridInfographicKind, index: number): string {
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
export function childName(t: Translate, kind: GridInfographicKind): string {
  const name = childNameOf(kind);
  return name ? t(`infographic.editor.child.${name}` as TranslationKey) : '';
}

/** The singular name of a child container called `name` (a ladder's rung, span bar or footer). */
export function childNameFor(t: Translate, name: string): string {
  const key = `infographic.editor.child.${name}`;
  return known(key) ? t(key) : name;
}

/**
 * What a child's tab says: its name attribute, or "Scenario 2" when it has none. An extra container (a ladder's span
 * bar or footer) is counted by itself, as there is only one of it.
 */
export function childTabLabel(t: Translate, block: InfographicBlock, index: number): string {
  const child = block.children[index];
  const main = childNameOf(block.kind);
  const named = child?.attrs[childNameKey(block.kind)]?.trim();
  if (named) return named;
  if (child && main && child.name !== main) return childNameFor(t, child.name);
  const number = block.children.slice(0, index + 1).filter(other => !main || other.name === main).length;
  return t('infographic.editor.childTitle', { name: childName(t, block.kind), number });
}

/** A problem in words; `firstLine` is the document line the block starts on, so the message names the line the writer sees. */
export function problemText(t: Translate, problem: InfographicProblem, firstLine = 1): string {
  return t(`infographic.problem.${problem.code}` as TranslationKey, { line: firstLine + problem.line });
}

export function issueText(t: Translate, block: InfographicBlock, issue: CellIssue): string {
  const message = t(`infographic.issue.${issue.code}` as TranslationKey, { row: issue.row + 1, column: columnLabel(t, block.kind, issue.column) });
  return issue.child === undefined ? message : t('infographic.issue.inChild', { child: childTabLabel(t, block, issue.child), message });
}
