import type { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Frame, Link2, MousePointer2, MoveUpRight, Palette, Redo2, SquarePlus, Trash2, Type, Undo2 } from 'lucide-react';
import { BOARD_TEXT_COLORS } from '@mygitnotes/core/compilation';
import { useTranslation } from '../../lib/i18n/index.js';
import { Tooltip } from '../Tooltip.js';
import type { BoardEditor, BoardTool } from './useBoardEditor.js';

const TOOLS: readonly { tool: BoardTool; label: 'board.tool.select' | 'board.tool.card' | 'board.tool.text' | 'board.tool.section' | 'board.tool.arrow'; icon: ReactNode; }[] = [{ tool: 'select', label: 'board.tool.select', icon: <MousePointer2 size={16} aria-hidden='true' /> }, { tool: 'card', label: 'board.tool.card', icon: <SquarePlus size={16} aria-hidden='true' /> }, { tool: 'text', label: 'board.tool.text', icon: <Type size={16} aria-hidden='true' /> }, { tool: 'section', label: 'board.tool.section', icon: <Frame size={16} aria-hidden='true' /> }, { tool: 'arrow', label: 'board.tool.arrow', icon: <MoveUpRight size={16} aria-hidden='true' /> }];

/**
 * The tools of an editable board, floating at its top left: 選取, 卡片, 文字, 區塊 and 箭頭 (a tool returns to 選取
 * after one use unless it was double-clicked), undo and redo, and for the selection 「連到…」, 刪除 and a text's colour.
 * A dynamic board's sections come from its folders, so its 區塊 is off and says why; 卡片 is off where a new note
 * would have no Git path yet, and says why, and missing where the board cannot create notes.
 */
export function BoardTools({ editor, dynamic }: { editor: BoardEditor; dynamic: boolean; }) {
  const { t } = useTranslation();
  const [only] = editor.selection.size === 1 ? [...editor.selection] : [];
  const text = only?.startsWith('text:') ? only : undefined;
  return (
    <div className='board-tools' role='toolbar' aria-label={t('board.tools')} data-board-control=''>
      <div className='board-tool-group' role='group' aria-label={t('board.toolGroup')}>
        {TOOLS.filter(({ tool }) => tool !== 'card' || editor.card).map(({ tool, label, icon }) => {
          const reason = tool === 'section' && dynamic ? t('board.dynamicSections') : tool === 'card' ? editor.card?.off : undefined;
          const off = Boolean(reason);
          const hint = reason ?? (editor.tool === tool && editor.sticky ? t('board.toolSticky', { tool: t(label) }) : t('board.toolHint', { tool: t(label) }));
          return (
            <Tooltip key={tool} label={hint}>
              <button type='button' className='ui-icon-button board-tool' aria-label={t(label)} aria-pressed={editor.tool === tool} aria-disabled={off || undefined} data-sticky={editor.tool === tool && editor.sticky || undefined} onClick={() => reason ? editor.setNotice(reason) : editor.setTool(tool)} onDoubleClick={() => !off && editor.setTool(tool, tool !== 'select')}>{icon}</button>
            </Tooltip>
          );
        })}
      </div>
      <span className='board-tool-separator' aria-hidden='true' />
      <Tooltip label={t('board.undo')}>
        <button type='button' className='ui-icon-button' aria-label={t('board.undo')} disabled={!editor.canUndo} onClick={editor.undo}>
          <Undo2 size={16} aria-hidden='true' />
        </button>
      </Tooltip>
      <Tooltip label={t('board.redo')}>
        <button type='button' className='ui-icon-button' aria-label={t('board.redo')} disabled={!editor.canRedo} onClick={editor.redo}>
          <Redo2 size={16} aria-hidden='true' />
        </button>
      </Tooltip>
      {editor.selection.size > 0 && (
        <>
          <span className='board-tool-separator' aria-hidden='true' />
          {editor.canLink && (
            <Tooltip label={t('board.linkHint')}>
              <button type='button' className='ui-icon-button' aria-label={t('board.link')} onClick={() => editor.openPicker()}>
                <Link2 size={16} aria-hidden='true' />
              </button>
            </Tooltip>
          )}
          {text && (
            <DropdownMenu.Root>
              <Tooltip label={t('board.textColor')}>
                <DropdownMenu.Trigger className='ui-icon-button' aria-label={t('board.textColor')}>
                  <Palette size={16} aria-hidden='true' />
                </DropdownMenu.Trigger>
              </Tooltip>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className='focus-menu' align='start' sideOffset={4} collisionPadding={8}>
                  <DropdownMenu.Item onSelect={() => editor.recolor(undefined)}>
                    <span className='board-swatch' aria-hidden='true' />
                    <span>{t('board.textColorDefault')}</span>
                  </DropdownMenu.Item>
                  {BOARD_TEXT_COLORS.map(color => (
                    <DropdownMenu.Item key={color} onSelect={() => editor.recolor(color)}>
                      <span className={`board-swatch board-text-tone-${color}`} aria-hidden='true' />
                      <span>{t(`notebookAppearance.color.${color}`)}</span>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          <Tooltip label={t('board.remove')}>
            <button type='button' className='ui-icon-button' aria-label={t('board.remove')} onClick={() => editor.requestRemove()}>
              <Trash2 size={16} aria-hidden='true' />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
