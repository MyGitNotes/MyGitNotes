import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, FileText, GalleryHorizontalEnd, LayoutTemplate, ListTree, Plus } from 'lucide-react';
import { SelectButtonGroup, SelectButtonPrimary, SelectButtonTrigger } from './SelectButton.js';
import { useTranslation } from '../lib/i18n/index.js';

/** What the New split button creates or opens. A read-only notebook gets no New button at all, so its owner passes none of these. */
export interface NewNoteActions {
  onNewNote: () => void;
  /** Each of these creates at once, with default values, at the notebook root. */
  onNewCompilation: () => void;
  onNewOutline?: () => void;
  /** The notebook's note templates, each a New menu item that creates a note from it. */
  templates?: { id: string; title: string; }[];
  onNewFromTemplate?: (templateId: string) => void;
  /** Opens the notebook's Manage templates dialog. */
  onManageTemplates?: () => void;
  /** Opens the legacy bookmark import; a read-only notebook reaches it from the recovery notice instead, or from a writable notebook. */
  onImportLegacy?: () => void;
}

/**
 * The New split button: the main part creates a note, the chevron lists what else creates or imports notes and manages templates. It sits in
 * the header on the Notes page, and in the toolbar that stays while the header and the browse region are folded away.
 */
export function NewNoteMenu({ onNewNote, onNewCompilation, onNewOutline, templates = [], onNewFromTemplate, onManageTemplates, onImportLegacy }: NewNoteActions) {
  const { t } = useTranslation();
  return (
    <SelectButtonGroup className='new-note-menu'>
      <SelectButtonPrimary aria-label={t('header.newNote')} title={t('header.newNote')} onClick={onNewNote} className='ui-button-primary header-new-note'>
        <Plus aria-hidden='true' />
        <span>{t('header.newNote')}</span>
      </SelectButtonPrimary>
      <DropdownMenu.Root>
        <SelectButtonTrigger className='ui-button-primary' aria-label={t('header.newMenu')} title={t('header.newMenu')}>
          <ChevronDown aria-hidden='true' />
        </SelectButtonTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} aria-label={t('header.newMenu')}>
            <DropdownMenu.Item onSelect={onNewNote}>
              <Plus size={14} aria-hidden='true' />
              {t('header.newNote')}
            </DropdownMenu.Item>
            {onNewFromTemplate && templates.map(template => (
              <DropdownMenu.Item key={template.id} onSelect={() => onNewFromTemplate(template.id)}>
                <FileText size={14} aria-hidden='true' />
                {t('header.newFromTemplate', { template: template.title })}
              </DropdownMenu.Item>
            ))}
            {onManageTemplates && (
              <DropdownMenu.Item onSelect={onManageTemplates}>
                <LayoutTemplate size={14} aria-hidden='true' />
                {t('templates.manage')}
              </DropdownMenu.Item>
            )}
            {onNewOutline && (
              <DropdownMenu.Item onSelect={onNewOutline}>
                <ListTree size={14} aria-hidden='true' />
                {t('outline.new')}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item onSelect={onNewCompilation}>
              <GalleryHorizontalEnd size={14} aria-hidden='true' />
              {t('compilation.new')}
            </DropdownMenu.Item>
            {onImportLegacy && <DropdownMenu.Item onSelect={onImportLegacy}>{t('legacyOutline.title')}</DropdownMenu.Item>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </SelectButtonGroup>
  );
}
