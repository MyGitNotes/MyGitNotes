import { type CSSProperties, type MouseEvent, type ReactNode, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ApiError } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';
import { appearanceEditable, type NotebookAppearance, saveNotebookAppearance } from '../lib/notebook-appearance.js';
import type { NotebookConfig } from '../lib/types.js';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { NotebookAppearanceDialog } from './NotebookAppearanceDialog.js';

export interface NotebookAppearanceOptions {
  /** The notebooks by key, as the page lists them. */
  notebooks: NotebookConfig[];
  repositoryFor: (notebookId: string) => WorkspaceRepository | undefined;
  refreshWorkspace: (fresh?: boolean) => Promise<void>;
  /** Keeps the revision a save answered, since a refetch may still answer from the snapshot before it. */
  setManifestRevision: (repository: string, revision: string) => void;
}

export interface NotebookAppearanceControls {
  /**
   * A notebook row's context menu: where the notebook's manifest can be written it opens the menu holding 「外觀…」
   * at the pointer (or under the row, from the keyboard's menu key); elsewhere it leaves the browser's own menu.
   */
  onContextMenu: (event: MouseEvent<HTMLElement>, notebookId: string) => void;
  /** The menu and the appearance dialog, mounted once on the page. */
  element: ReactNode;
}

interface MenuAt {
  notebookId: string;
  x: number;
  y: number;
  /** The row the menu came from, which takes the focus back when the menu closes. */
  row: HTMLElement;
}

/**
 * A notebook's appearance, set from its row's context menu (「外觀…」): the picker saves the icon and colour into the
 * notebook's manifest through `PUT /api/workspace/config`, Settings' own write path, then refreshes the workspace.
 * A manifest that moved meanwhile (409) is reloaded and the dialog asks to press Done again.
 */
export function useNotebookAppearance({ notebooks, repositoryFor, refreshWorkspace, setManifestRevision }: NotebookAppearanceOptions): NotebookAppearanceControls {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const chosen = useRef(false);

  const onContextMenu = (event: MouseEvent<HTMLElement>, notebookId: string) => {
    if (!appearanceEditable(repositoryFor(notebookId))) return;
    event.preventDefault();
    const row = event.currentTarget;
    const rect = row.getBoundingClientRect();
    // The keyboard's menu key reports no pointer position: the menu opens under the row instead.
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    setMenu({ notebookId, x: fromKeyboard ? rect.left + 12 : event.clientX, y: fromKeyboard ? rect.bottom : event.clientY, row });
  };

  const save = async (notebookId: string, appearance: NotebookAppearance) => {
    const repository = repositoryFor(notebookId);
    if (!repository) throw new Error(t('notebook.unavailable'));
    try {
      setManifestRevision(repository.id, await saveNotebookAppearance(repository, notebookId, appearance));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await refreshWorkspace(true).catch(() => undefined);
        throw new Error(t('notebookAppearance.conflict'));
      }
      throw error;
    }
    await refreshWorkspace(true);
  };

  const notebook = editing ? notebooks.find(candidate => candidate.id === editing) : undefined;
  const menuTitle = menu ? notebooks.find(candidate => candidate.id === menu.notebookId)?.title ?? '' : '';
  // An invisible point at the pointer anchors the menu, so the row's own click never opens it.
  const anchor: CSSProperties = { position: 'fixed', left: menu?.x ?? 0, top: menu?.y ?? 0, width: 0, height: 0 };
  const element = (
    <>
      {menu && (
        <DropdownMenu.Root
          open
          modal={false}
          onOpenChange={open => {
            if (!open) setMenu(null);
          }}
        >
          <DropdownMenu.Trigger asChild>
            <span aria-hidden='true' style={anchor} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className='sidebar-tag-menu'
              align='start'
              sideOffset={2}
              collisionPadding={8}
              aria-label={t('notebookAppearance.menuLabel', { title: menuTitle })}
              onCloseAutoFocus={event => {
                event.preventDefault();
                // The dialog keeps this row as the place its focus goes back to.
                menu.row.focus();
                if (chosen.current) {
                  chosen.current = false;
                  setEditing(menu.notebookId);
                }
              }}
            >
              <DropdownMenu.Item
                onSelect={() => {
                  chosen.current = true;
                }}
              >
                {t('notebookAppearance.menu')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {editing && notebook && (
        <NotebookAppearanceDialog
          key={editing}
          notebook={notebook}
          onSave={appearance => save(editing, appearance)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
  return { onContextMenu, element };
}
