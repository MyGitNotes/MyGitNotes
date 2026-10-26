import { type ReactNode, useId, useMemo, useState } from 'react';
import { isNoteHidden, withNoteStatus } from '@mygitnotes/core/note-status';
import { Select } from '../Select.js';
import { NotebookMetadataField } from '../../lib/types.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { useStatusLabel } from '../../lib/status-color.js';
import { noteStem } from '../../lib/note-move.js';
import { cleanTag, noteTags, suggestTags, withoutTag, withTag } from './tag-edit.js';
import { AddMetadataField, FrontmatterHeader, FrontmatterYaml, MetadataFieldList, metadataFieldSpecs } from './FrontmatterParts.js';

const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set(['title', 'status', 'hiden', 'tags', 'created', 'updated']);

export interface NoteFrontmatterPanelProps {
  metadata: Record<string, unknown>;
  setMetadata: (metadata: Record<string, unknown>) => void;
  statuses: string[];
  metadataFields?: NotebookMetadataField[];
  availableTags: string[];
  locked: boolean;
  newFieldKey: string;
  setNewFieldKey: (value: string) => void;
  frontmatterViewMode: 'form' | 'yaml';
  setFrontmatterViewMode: (mode: 'form' | 'yaml') => void;
  yamlText: string;
  setYamlText: (value: string) => void;
  yamlError: string;
  setYamlError: (value: string) => void;
  tagInput: string;
  setTagInput: (value: string) => void;
  isTagDropdownOpen: boolean;
  setIsTagDropdownOpen: (value: boolean) => void;
  /** Renames the note to the title typed here, its file name following, as the note row's title does; absent where the title is only a field. */
  onRename?: (title: string) => Promise<void> | void;
  /** Shown below the fields, in the same scroll. */
  children?: ReactNode;
}

/** The title field: typed freely, then Enter or leaving the field renames the note (title and file name together). Without a rename it edits the field. */
function TitleField({ metadata, setMetadata, onRename }: Pick<NoteFrontmatterPanelProps, 'metadata' | 'setMetadata' | 'onRename'>) {
  const { t } = useTranslation();
  const title = String(metadata.title || '');
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    if (next && next !== title && noteStem(next)) void onRename?.(next);
  };
  return (
    <div>
      <label htmlFor={id} className='block text-muted font-semibold mb-1'>{t('editor.title')}</label>
      <input
        id={id}
        type='text'
        value={onRename ? draft ?? title : title}
        onChange={event => onRename ? setDraft(event.target.value) : setMetadata({ ...metadata, title: event.target.value })}
        onBlur={onRename ? commit : undefined}
        onKeyDown={event => {
          if (!onRename || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape' && draft !== null) {
            event.stopPropagation();
            setDraft(null);
          }
        }}
        placeholder={t('editor.titlePlaceholder')}
        data-escape-local={draft !== null ? '' : undefined}
        aria-invalid={draft !== null && draft.trim() !== '' && !noteStem(draft) ? true : undefined}
        className='ui-control w-full'
      />
      {onRename && draft !== null && draft.trim() !== '' && !noteStem(draft) && <p className='text-xs text-danger mt-1' role='status'>{t('files.renameInvalid')}</p>}
    </div>
  );
}

/** A note's frontmatter: title, status, tags with autocomplete, custom metadata fields, and a raw-YAML view; `children` follow it. */
export function NoteFrontmatterPanel({ metadata, setMetadata, statuses, metadataFields, availableTags, locked, newFieldKey, setNewFieldKey, frontmatterViewMode, setFrontmatterViewMode, yamlText, setYamlText, yamlError, setYamlError, tagInput, setTagInput, isTagDropdownOpen, setIsTagDropdownOpen, onRename, children }: NoteFrontmatterPanelProps) {
  const { t } = useTranslation();
  const labelOf = useStatusLabel();

  const customFields = useMemo(() => metadataFieldSpecs(metadata, RESERVED_METADATA_KEYS, metadataFields), [metadataFields, metadata]);

  const currentTags = useMemo(() => noteTags(metadata), [metadata]);
  const suggestedTags = useMemo(() => suggestTags(availableTags, currentTags, tagInput), [availableTags, currentTags, tagInput]);

  const handleAddTag = (tagToAdd: string) => {
    if (!cleanTag(tagToAdd)) return;
    setMetadata(withTag(metadata, tagToAdd));
    setTagInput('');
    setIsTagDropdownOpen(false);
  };

  const handleRemoveTag = (tagToRemove: string) => setMetadata(withoutTag(metadata, tagToRemove));

  return (
    <div className='note-frontmatter-panel note-panel-scroll flex flex-col h-full'>
      <FrontmatterHeader
        mode={frontmatterViewMode}
        metadata={metadata}
        onMode={setFrontmatterViewMode}
        onYaml={text => {
          setYamlText(text);
          setYamlError('');
        }}
      />
      {frontmatterViewMode === 'form'
        ? (
          <fieldset disabled={locked} className='note-metadata min-w-0 text-xs animate-fadeIn space-y-3'>
            <TitleField metadata={metadata} setMetadata={setMetadata} onRename={onRename} />
            <div>
              <label className='block text-muted font-semibold mb-1'>{t('editor.status')}</label>
              <Select aria-label={t('editor.status')} disabled={locked} value={String(metadata.status || '')} onValueChange={value => setMetadata(withNoteStatus(metadata, value))} options={Array.from(new Set(['', ...statuses, String(metadata.status || '')])).map(value => ({ value, label: value ? labelOf(value) : t('editor.noStatus') }))} className={`w-full ${metadata.status ? '' : 'status-empty'}`} />
              <label className='flex items-center gap-2 min-h-11 cursor-pointer'>
                <input type='checkbox' aria-label={t('editor.hideNote')} checked={isNoteHidden(metadata)} onChange={event => setMetadata({ ...metadata, hiden: event.target.checked })} className='w-4 h-4 accent-primary' />
                {t('editor.hideNote')}
              </label>
            </div>
            {/* Tags with Autocomplete */}
            <div className='relative'>
              <label className='block text-muted font-semibold mb-1'>{t('editor.tags')}</label>
              <div className='flex flex-wrap items-center gap-1.5 p-1.5 bg-surface border border-line rounded-md min-h-[35px] relative'>
                {currentTags.map((tag) => (
                  <span key={tag} className='inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-fg/5 text-fg border border-line'>
                    <span>{tag}</span>
                    <button type='button' onClick={() => handleRemoveTag(tag)} className='text-muted hover:text-danger font-bold ml-0.5'>×</button>
                  </span>
                ))}
                <div className='flex-1 min-w-[100px] relative'>
                  <input
                    type='text'
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      setIsTagDropdownOpen(true);
                    }}
                    onFocus={() => setIsTagDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsTagDropdownOpen(false), 250)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        handleAddTag(tagInput);
                      } else if (e.key === 'Backspace' && !tagInput && currentTags.length > 0) {
                        handleRemoveTag(currentTags[currentTags.length - 1]);
                      }
                    }}
                    placeholder={currentTags.length === 0 ? t('editor.addTagPlaceholder') : t('editor.addPlaceholder')}
                    className='w-full text-xs bg-transparent focus:outline-none text-fg'
                  />
                  {/* Autocomplete Dropdown */}
                  {isTagDropdownOpen && suggestedTags.length > 0 && (
                    <div className='absolute top-full left-0 mt-1 w-52 bg-surface border border-line rounded-lg shadow-xl z-50 max-h-40 overflow-y-auto py-1'>
                      {suggestedTags.map((st) => (
                        <button
                          key={st}
                          type='button'
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleAddTag(st);
                          }}
                          className='w-full text-left px-3 py-1.5 text-xs hover:bg-fg/5 flex items-center justify-between text-fg'
                        >
                          <span className='font-semibold'>{st}</span>
                          <span className='text-[10px] text-muted'>{t('editor.add')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* Quick suggestion suggestions below */}
              {suggestedTags.length > 0 && !tagInput && (
                <div className='flex items-center gap-1.5 mt-1 text-[11px] text-muted flex-wrap'>
                  <span>{t('editor.suggestions')}</span>
                  {suggestedTags.slice(0, 5).map((st) => <button key={st} type='button' onClick={() => handleAddTag(st)} style={{ color: 'var(--color-primary)' }} className='hover:underline font-medium'>+{st}</button>)}
                </div>
              )}
            </div>
            <MetadataFieldList fields={customFields} metadata={metadata} setMetadata={setMetadata} />
            <AddMetadataField metadata={metadata} setMetadata={setMetadata} newFieldKey={newFieldKey} setNewFieldKey={setNewFieldKey} />
          </fieldset>
        )
        : <FrontmatterYaml yamlText={yamlText} setYamlText={setYamlText} yamlError={yamlError} setYamlError={setYamlError} locked={locked} setMetadata={setMetadata} />}
      {children}
    </div>
  );
}
