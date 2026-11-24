import { Tooltip } from '../Tooltip.js';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import YAML from 'yaml';
import { stringifyFrontmatterYaml } from '@mygitnotes/core/frontmatter';
import { Code } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { LoadingStatus } from '../LoadingStatus.js';

// CodeMirror loads only when the YAML source view opens, not with the editor.
const FileSourceEditor = lazy(() => import('../FileSourceEditor.js').then(module => ({ default: module.FileSourceEditor })));

export type FrontmatterViewMode = 'form' | 'yaml';
type Metadata = Record<string, unknown>;

/**
 * The panel's heading with its Form / YAML switch; opening YAML seeds the source from `yamlSource`, or else from the
 * current metadata. Without `titled` the heading is the switch alone, where what holds the panel names it.
 */
export function FrontmatterHeader({ mode, metadata, yamlSource, onMode, onYaml, titled = true }: { mode: FrontmatterViewMode; metadata: Metadata; yamlSource?: string; onMode: (mode: FrontmatterViewMode) => void; onYaml: (text: string) => void; titled?: boolean; }) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center ${titled ? 'justify-between' : 'justify-end'} pb-2 mb-3 border-b border-line shrink-0`}>
      {titled && <span className='font-semibold text-xs text-fg'>{t('editor.frontmatter')}</span>}
      <div className='inline-flex rounded-md p-0.5 bg-sidebar text-[11px]'>
        <button type='button' onClick={() => onMode('form')} className={`px-2 py-0.5 rounded font-medium transition-colors ${mode === 'form' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>{t('editor.formMode')}</button>
        <button
          type='button'
          onClick={() => {
            onYaml(yamlSource ?? stringifyFrontmatterYaml(metadata));
            onMode('yaml');
          }}
          className={`px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-colors ${mode === 'yaml' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
        >
          <Code className='w-3 h-3' />
          {t('editor.yamlMode')}
        </button>
      </div>
    </div>
  );
}

/** The same YAML text, whatever its line endings and trailing blank lines. */
const sameYaml = (a: string, b: string) => a.replace(/\r\n/g, '\n').trimEnd() === b.replace(/\r\n/g, '\n').trimEnd();

/**
 * The YAML view: every valid mapping replaces the metadata (with the text it came from, and the text the view last
 * wrote or opened on, which a shared note's write compares with what others changed since), and anything else shows
 * its error and changes nothing. A shared note's view is given its `source`, the block as it is now (with
 * `sourceError` while it does not parse): whenever the block changes and nothing typed here waits to be written, the
 * view shows it, and a text that is the block as it is writes nothing (VQ P2-1).
 */
export function FrontmatterYaml({ yamlText, setYamlText, yamlError, setYamlError, locked, setMetadata, source, sourceError }: { yamlText: string; setYamlText: (value: string) => void; yamlError: string; setYamlError: (value: string) => void; locked: boolean; setMetadata: (metadata: Metadata, text: string, shown: string) => void; source?: string; sourceError?: string; }) {
  const { t } = useTranslation();
  // The text typed in between may not parse: what was last written is what the note's frontmatter was made from.
  const written = useRef(yamlText);
  const write = (metadata: Metadata, text: string) => {
    setMetadata(metadata, text, written.current);
    written.current = text;
  };
  // Set before the text changes, so the editor's echo of it reads as nothing typed.
  useEffect(() => {
    if (source === undefined || yamlText !== written.current || sameYaml(yamlText, source)) return;
    written.current = source;
    setYamlText(source);
    setYamlError(sourceError ?? '');
  }, [source, sourceError, yamlText, setYamlText, setYamlError]);
  return (
    <div className='flex-1 flex flex-col text-xs space-y-2'>
      {yamlError && <div className='p-2 rounded bg-danger-soft border border-danger/40 text-danger font-mono text-[11px] break-words'>{yamlError}</div>}
      <div className='flex-1 border border-line rounded-md overflow-hidden min-h-[340px]'>
        <Suspense fallback={<LoadingStatus className='p-3'>{t('editor.loadingEditor')}</LoadingStatus>}>
          <FileSourceEditor
            path='metadata.yaml'
            content={yamlText}
            readOnly={locked}
            label='YAML Metadata'
            wrap
            onChange={(newYaml) => {
              setYamlText(newYaml);
              // The block as it is now, such as the text the view opened on or followed: shown here, nothing to write.
              if (source !== undefined && sameYaml(newYaml, source)) {
                written.current = newYaml;
                setYamlError(sourceError ?? '');
                return;
              }
              try {
                const parsed = YAML.parse(newYaml);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  write(parsed as Metadata, newYaml);
                  setYamlError('');
                } else if (newYaml.trim() === '') {
                  write({}, newYaml);
                  setYamlError('');
                } else {
                  setYamlError(`${t('editor.yamlError')}: Root must be a mapping`);
                }
              } catch (err) {
                setYamlError(err instanceof Error ? err.message : t('editor.yamlError'));
              }
            }}
          />
        </Suspense>
      </div>
      <p className='text-[11px] text-muted leading-tight'>{t('editor.yamlHint')}</p>
    </div>
  );
}

export interface MetadataFieldSpec {
  key: string;
  type: 'string' | 'boolean' | 'number';
  label: string;
  /** Declared by configuration, so it stays even when empty and cannot be removed here. */
  isConfigured: boolean;
}

/** The fields other than the reserved ones: those configuration declares, then any other key the metadata holds. */
export function metadataFieldSpecs(metadata: Metadata, reserved: ReadonlySet<string>, configured: { key: string; type?: MetadataFieldSpec['type']; label?: string; }[] = []): MetadataFieldSpec[] {
  const inferred = (key: string): MetadataFieldSpec['type'] => typeof metadata[key] === 'boolean' ? 'boolean' : typeof metadata[key] === 'number' ? 'number' : 'string';
  const fields: MetadataFieldSpec[] = [];
  const seen = new Set<string>();
  for (const field of configured) {
    if (reserved.has(field.key)) continue;
    fields.push({ key: field.key, type: field.type || inferred(field.key), label: field.label || field.key, isConfigured: true });
    seen.add(field.key);
  }
  for (const key of Object.keys(metadata)) {
    if (reserved.has(key) || seen.has(key)) continue;
    fields.push({ key, type: inferred(key), label: key, isConfigured: false });
    seen.add(key);
  }
  return fields;
}

/** The extra fields, under a "Metadata" heading: checkboxes for booleans, inputs for the rest, with remove for unconfigured keys. */
export function MetadataFieldList({ fields, metadata, setMetadata }: { fields: MetadataFieldSpec[]; metadata: Metadata; setMetadata: (metadata: Metadata) => void; }) {
  const { t } = useTranslation();
  if (!fields.length) return null;
  return (
    <div className='pt-2 border-t border-line space-y-3'>
      <span className='block text-muted font-semibold mb-1'>{t('editor.metadata') || 'Metadata'}</span>
      {fields.map((field) => {
        if (field.type === 'boolean') {
          return (
            <label key={field.key} className='flex items-center gap-2 min-h-8 cursor-pointer select-none'>
              <input type='checkbox' aria-label={field.label} checked={Boolean(metadata[field.key])} onChange={(e) => setMetadata({ ...metadata, [field.key]: e.target.checked })} className='w-4 h-4 accent-primary rounded' />
              <span className='text-fg font-medium'>{field.label}</span>
            </label>
          );
        }

        return (
          <div key={field.key}>
            <div className='flex items-center justify-between mb-1'>
              <label className='text-muted font-semibold'>{field.label}</label>
              {!field.isConfigured && (
                <Tooltip label='Remove field'>
                  <button
                    type='button'
                    onClick={() => {
                      const next = { ...metadata };
                      delete next[field.key];
                      setMetadata(next);
                    }}
                    className='text-[10px] text-muted hover:text-danger'
                  >
                    ×
                  </button>
                </Tooltip>
              )}
            </div>
            <input
              type={field.type === 'number' ? 'number' : 'text'}
              aria-label={field.label}
              value={metadata[field.key] === undefined || metadata[field.key] === null ? '' : typeof metadata[field.key] === 'object' ? JSON.stringify(metadata[field.key]) : String(metadata[field.key])}
              onChange={(e) => {
                let val: unknown = e.target.value;
                if (field.type === 'number') {
                  const num = Number(e.target.value);
                  val = isNaN(num) ? e.target.value : num;
                }
                setMetadata({ ...metadata, [field.key]: val });
              }}
              className='ui-control w-full text-xs'
            />
          </div>
        );
      })}
    </div>
  );
}

/** A name box and "+" that adds an empty field; `newFieldKey` may be lifted so a parent keeps it across remounts. */
export function AddMetadataField({ metadata, setMetadata, newFieldKey: liftedKey, setNewFieldKey: setLiftedKey }: { metadata: Metadata; setMetadata: (metadata: Metadata) => void; newFieldKey?: string; setNewFieldKey?: (value: string) => void; }) {
  const [localKey, setLocalKey] = useState('');
  const newFieldKey = liftedKey ?? localKey;
  const setNewFieldKey = setLiftedKey ?? setLocalKey;
  const add = () => {
    const key = newFieldKey.trim();
    if (key && !metadata[key]) setMetadata({ ...metadata, [key]: '' });
    setNewFieldKey('');
  };
  return (
    <div className='pt-2 border-t border-line'>
      <div className='flex gap-1.5 items-center'>
        <input
          type='text'
          placeholder='New field name...'
          value={newFieldKey}
          onChange={(e) => setNewFieldKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newFieldKey.trim()) {
              e.preventDefault();
              add();
            }
          }}
          className='ui-control flex-1 text-xs py-1'
        />
        <button type='button' onClick={add} disabled={!newFieldKey.trim()} className='px-2 py-1 text-xs bg-line hover:bg-fg/10 rounded disabled:opacity-50 text-fg'>+</button>
      </div>
    </div>
  );
}
