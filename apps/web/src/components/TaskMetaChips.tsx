import { User } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { PRIORITY_ICON } from '../lib/task-icons.js';
import { PRIORITY_LABEL_KEY } from '../lib/todo-filter.js';
import type { TodoTask } from '../lib/todo-list.js';

/** The owner and priority chips of a task, as list items for the surrounding chip list. */
export function TaskMetaChips({ task }: { task: TodoTask; }) {
  const { t } = useTranslation();
  const PriorityIcon = task.priority ? PRIORITY_ICON[task.priority] : undefined;
  return (
    <>
      {(task.assignees ?? []).map(name => (
        <li key={`@${name}`} className='todo-task-date-chip todo-task-assignee-chip' title={t('panel.todoAssignedTo')}>
          <User aria-hidden='true' />
          {name}
        </li>
      ))}
      {task.priority && PriorityIcon && (
        <li key='priority' className='todo-task-date-chip todo-task-priority-chip' data-priority={task.priority}>
          <PriorityIcon aria-hidden='true' />
          {t(PRIORITY_LABEL_KEY[task.priority])}
        </li>
      )}
    </>
  );
}
