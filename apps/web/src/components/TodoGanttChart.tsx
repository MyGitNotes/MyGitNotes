import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { stripTaskTokens } from '../lib/task-tokens.js';
import { PRIORITY_ICON } from '../lib/task-icons.js';
import { PRIORITY_LABEL_KEY } from '../lib/todo-filter.js';
import { computeGanttEntries, computeGanttRange, computeGanttTicks, GANTT_SCALES, ganttDayWidth, type GanttRow, type GanttScale, getSavedGanttScale, saveGanttScale } from '../lib/todo-gantt.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { TodoTask } from '../lib/todo-list.js';
import { Button } from './Button.js';

/** Days of history kept visible left of today when the chart first opens or the scale changes. */
const LEAD_DAYS = 2;

const SCALE_LABEL_KEY: Record<GanttScale, 'panel.todoGanttScaleDay' | 'panel.todoGanttScaleWeek' | 'panel.todoGanttScaleMonth'> = { day: 'panel.todoGanttScaleDay', week: 'panel.todoGanttScaleWeek', month: 'panel.todoGanttScaleMonth' };

interface TodoGanttChartProps {
  tasks: TodoTask[];
  /** Notes with a `milestone` date; each is drawn as a diamond on its day. */
  milestones: NoteListItem[];
  today: string;
  onOpenTask: (task: TodoTask) => void;
  onOpenMilestone: (note: NoteListItem) => void;
}

function barTitle(row: GanttRow, priorityLabel?: string): string {
  const text = stripTaskTokens(row.task.lineText);
  const when = row.kind === 'range' ? `${row.task.start} → ${row.task.due}` : row.kind === 'dueOnly' ? row.task.due : row.task.start;
  return [text, when, priorityLabel, ...row.task.assignees.map(name => `@${name}`)].filter(Boolean).join(' · ');
}

/** `'day'`/`'week'` ticks show `MM-DD`; `'month'` ticks show a locale month/year (e.g. "Sep 2026" / "2026年9月"). */
function tickLabel(date: string, scale: GanttScale, language: string): string {
  if (scale !== 'month') return date.slice(5);
  const [year, month] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short' }).format(Date.UTC(year, month - 1, 1));
}

export function TodoGanttChart({ tasks, milestones, today, onOpenTask, onOpenMilestone }: TodoGanttChartProps) {
  const { t, language } = useTranslation();
  const [scale, setScale] = useState<GanttScale>(getSavedGanttScale);
  const dayWidth = ganttDayWidth(scale);
  const range = useMemo(() => computeGanttRange(tasks, today, scale, milestones), [tasks, today, scale, milestones]);
  const rows = useMemo(() => computeGanttEntries(tasks, milestones, range), [tasks, milestones, range]);
  const ticks = useMemo(() => computeGanttTicks(range, scale), [range, scale]);
  const trackWidth = range.days * dayWidth;
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasRows = rows.length > 0;

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, (range.todayOffset - LEAD_DAYS) * dayWidth);
  }, [range.todayOffset, dayWidth, hasRows]);

  const changeScale = (next: GanttScale) => {
    setScale(next);
    saveGanttScale(next);
  };

  const scaleToggle = <div className='todo-gantt-scale-toggle' role='group'>{GANTT_SCALES.map(option => <Button key={option} type='button' aria-pressed={scale === option} onClick={() => changeScale(option)}>{t(SCALE_LABEL_KEY[option])}</Button>)}</div>;

  if (rows.length === 0) {
    return (
      <>
        {scaleToggle}
        <p className='todo-empty'>{t('panel.todoGanttEmpty')}</p>
      </>
    );
  }

  return (
    <div className='todo-gantt' role='group' aria-label={t('panel.todoGanttTimeline')}>
      {scaleToggle}
      <div className='todo-gantt-scroll' ref={scrollRef}>
        <div className='todo-gantt-header todo-gantt-row'>
          <div className='todo-gantt-label-cell' />
          <div className='todo-gantt-track' style={{ width: trackWidth }}>
            {ticks.map(tick => <span key={tick.offset} className='todo-gantt-tick' style={{ left: tick.offset * dayWidth }}>{tickLabel(tick.date, scale, language)}</span>)}
            <span className='todo-gantt-today-line' style={{ left: range.todayOffset * dayWidth }} title={t('panel.todoGanttToday')} aria-hidden='true' />
          </div>
        </div>
        {rows.map(entry => {
          if (entry.type === 'milestone') {
            const label = `${t('panel.todoGanttMilestone')}: ${entry.note.title} · ${entry.date}`;
            return (
              <div className='todo-gantt-row todo-gantt-milestone-row' key={`milestone:${entry.note.notebookId}:${entry.note.path}`}>
                <button type='button' className='todo-gantt-label-cell todo-gantt-label-button' title={label} onClick={() => onOpenMilestone(entry.note)}>{entry.note.title}</button>
                <div className='todo-gantt-track' style={{ width: trackWidth }}>
                  <span className='todo-gantt-today-line' style={{ left: range.todayOffset * dayWidth }} aria-hidden='true' />
                  <button type='button' className='todo-gantt-milestone' style={{ left: (entry.offset + 0.5) * dayWidth }} title={label} aria-label={label} onClick={() => onOpenMilestone(entry.note)} />
                  <span className='todo-gantt-milestone-title' style={{ left: (entry.offset + 0.5) * dayWidth }} aria-hidden='true'>{entry.note.title}</span>
                </div>
              </div>
            );
          }
          const { row } = entry;
          const priority = row.task.priority;
          const PriorityIcon = priority ? PRIORITY_ICON[priority] : undefined;
          const priorityLabel = priority ? t(PRIORITY_LABEL_KEY[priority]) : undefined;
          return (
            <div className='todo-gantt-row' key={row.task.id}>
              <button type='button' className='todo-gantt-label-cell todo-gantt-label-button' title={`${stripTaskTokens(row.task.lineText)} · ${row.task.noteTitle}`} onClick={() => onOpenTask(row.task)}>{PriorityIcon && <PriorityIcon aria-label={priorityLabel} className='todo-gantt-priority-icon' data-priority={priority} />}{stripTaskTokens(row.task.lineText)}</button>
              <div className='todo-gantt-track' style={{ width: trackWidth }}>
                <span className='todo-gantt-today-line' style={{ left: range.todayOffset * dayWidth }} aria-hidden='true' />
                <span className={`todo-gantt-bar todo-gantt-bar-${row.kind}`} style={{ left: row.offset * dayWidth, width: row.span * dayWidth }} data-priority={priority} title={barTitle(row, priorityLabel)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
