import { MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../Button.js';
import type { AgentDialog } from '../../lib/pi-agent/transcript.js';
import type { DialogAnswer } from '../../lib/pi-agent/session.js';
import { useTranslation } from '../../lib/i18n/index.js';

/** A Pi extension asking the user, such as `ask_user`, which RPC mode turns into select, confirm, input or editor dialogs. */
export function AgentDialogCard({ dialog, onAnswer }: { dialog: AgentDialog; onAnswer: (answer: DialogAnswer) => void; }) {
  const { t } = useTranslation();
  const [text, setText] = useState(dialog.prefill ?? '');
  const cancel = () => onAnswer({ cancelled: true });
  // RPC dialogs carry everything in the title: ask_user's sequential fallback puts the question, its option list and previews there on separate lines.
  const [firstLine = '', ...restLines] = dialog.title.split('\n');
  const heading = firstLine.trim() || t('piAgent.dialog');
  const detail = restLines.join('\n').trim();
  return (
    <section className='pi-agent-dialog' role='group' aria-label={heading}>
      <header>
        <MessageCircleQuestion aria-hidden='true' />
        <h3>{heading}</h3>
      </header>
      {detail && <p className='pi-agent-text pi-agent-dialog-detail'>{detail}</p>}
      {dialog.message && <p className='pi-agent-text'>{dialog.message}</p>}
      {dialog.method === 'select' && <div className='pi-agent-dialog-options'>{(dialog.options ?? []).map(option => <Button key={option} onClick={() => onAnswer({ value: option })}>{option}</Button>)}</div>}
      {dialog.method === 'confirm' && (
        <div className='pi-agent-dialog-actions'>
          <Button variant='primary' onClick={() => onAnswer({ confirmed: true })}>{t('piAgent.yes')}</Button>
          <Button onClick={() => onAnswer({ confirmed: false })}>{t('piAgent.no')}</Button>
        </div>
      )}
      {(dialog.method === 'input' || dialog.method === 'editor') && (
        <form
          className='pi-agent-dialog-form'
          onSubmit={event => {
            event.preventDefault();
            onAnswer({ value: text });
          }}
        >
          {dialog.method === 'input' ? <input className='ui-control' value={text} placeholder={dialog.placeholder} aria-label={heading} onChange={event => setText(event.target.value)} autoFocus /> : <textarea className='ui-control' rows={6} value={text} aria-label={heading} onChange={event => setText(event.target.value)} autoFocus />}
          <div className='pi-agent-dialog-actions'>
            <Button type='submit' variant='primary'>{t('piAgent.submit')}</Button>
          </div>
        </form>
      )}
      <div className='pi-agent-dialog-actions'>
        <Button size='small' onClick={cancel}>{t('common.cancel')}</Button>
      </div>
    </section>
  );
}
