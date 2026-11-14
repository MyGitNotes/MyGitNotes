import type { useTranslation } from './i18n/index.js';
import { isSortField, metadataSortKey, type SortField } from './note-sort.js';

/** The sort menu's entries for frontmatter keys: each `metadata.<key>` field in both orders, labelled by its key. */
export function metadataSortOptions(t: ReturnType<typeof useTranslation>['t'], fields: readonly string[]): { value: string; label: string; }[] {
  return [...new Set(fields)].filter((field): field is SortField => isSortField(field) && metadataSortKey(field) !== undefined).flatMap(field => {
    const key = metadataSortKey(field)!;
    return [{ value: `${field}:desc`, label: t('sort.metadataDesc', { key }) }, { value: `${field}:asc`, label: t('sort.metadataAsc', { key }) }];
  });
}
