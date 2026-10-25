import { Braces, CalendarDays, GitBranch, History, ListTodo, ListTree, Search, Type } from 'lucide-react';
import type { TranslationKey } from '../../lib/i18n/index.js';
import type { PanelToolId } from '../../lib/panel-context.js';

/** The right rail's tools in the order a phone's note sheet offers them: the workspace's, then the note's own. */
export const PHONE_TOOLS: readonly { id: PanelToolId; icon: typeof CalendarDays; label: TranslationKey; }[] = [{ id: 'calendar', icon: CalendarDays, label: 'panel.calendar' }, { id: 'todo', icon: ListTodo, label: 'panel.todo' }, { id: 'changes', icon: GitBranch, label: 'panel.changes' }, { id: 'outline', icon: ListTree, label: 'editor.outline' }, { id: 'find', icon: Search, label: 'editor.findInNote' }, { id: 'frontmatter', icon: Braces, label: 'editor.frontmatter' }, { id: 'view', icon: Type, label: 'editor.viewSettings' }, { id: 'history', icon: History, label: 'history.open' }];

export const phoneToolLabel = (id: PanelToolId): TranslationKey => PHONE_TOOLS.find(tool => tool.id === id)!.label;
