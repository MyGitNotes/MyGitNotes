import { createContext, type ReactNode, useContext } from 'react';
import { type StatusColor, statusColor } from '@mygitnotes/core/note-status';
import type { NotebookStatus } from './types.js';

/** The class that paints a `.status-dot`; the first four palette colours are the theme's success, info, warning and danger tokens. */
export function statusDotClass(color: StatusColor): string {
  switch (color) {
    case 'green':
      return 'bg-success';
    case 'blue':
      return 'bg-info';
    case 'amber':
      return 'bg-warning';
    case 'red':
      return 'bg-danger';
    case 'purple':
      return 'bg-status-purple';
    case 'teal':
      return 'bg-status-teal';
    case 'pink':
      return 'bg-status-pink';
    case 'gray':
      return 'bg-status-gray';
    case 'primary':
      return 'bg-primary';
    case 'muted':
      return 'bg-muted';
  }
}

const StatusColorContext = createContext<readonly NotebookStatus[]>([]);

/** Gives the status dots below it the statuses of the notebooks being shown, which decide each dot's colour. */
export function StatusColorProvider({ statuses, children }: { statuses: readonly NotebookStatus[]; children: ReactNode; }) {
  return <StatusColorContext.Provider value={statuses}>{children}</StatusColorContext.Provider>;
}

/** The dot class for a status in the notebooks being shown. Every status dot in the app resolves through this. */
export function useStatusDotClass(): (status: string) => string {
  const statuses = useContext(StatusColorContext);
  return status => statusDotClass(statusColor(status, statuses));
}
