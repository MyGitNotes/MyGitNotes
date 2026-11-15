import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export function EditorNotice({ children, actions, tone = 'warning' }: { children: ReactNode; actions?: ReactNode; tone?: 'warning' | 'error' | 'success'; }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`editor-notice ${tone === 'warning' ? '' : `editor-notice-${tone}`}`}>
      <div className='editor-notice-message'>
        {tone === 'success' ? <CheckCircle2 className='w-4 h-4 shrink-0' aria-hidden='true' /> : <AlertCircle className='w-4 h-4 shrink-0' />}
        <div className='min-w-0'>{children}</div>
      </div>
      {actions && <div className='editor-notice-actions'>{actions}</div>}
    </div>
  );
}
