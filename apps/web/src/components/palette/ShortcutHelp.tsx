import './shortcut-help.css';
import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { ResolvedCommand } from '../../lib/commands/registry.js';
import { en } from '../../lib/i18n/en.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { describeKeys, formatKeys, parseKeys } from '../../lib/keyboard/keys.js';
import { keymapEntry, SHORTCUT_GROUPS } from '../../lib/keyboard/keymap.js';
import { type KeyEnvironment, keyEnvironment } from '../../lib/keyboard/platform.js';
import { isVimChord, VIM_CHEATSHEET } from '../../lib/keyboard/vim-cheatsheet.js';
import { useVimMode } from '../../lib/vim-mode.js';

interface ShortcutHelpProps {
  /** Every registry command: each KEYMAP entry and each registered palette-only command. */
  commands: readonly ResolvedCommand[];
  env?: KeyEnvironment;
}

/** Why a row cannot be used here, or null. Keys a CodeMirror keymap or a widget handles act wherever their scope has focus. */
function unavailableReason(command: ResolvedCommand, notHere: string): string | null {
  if (command.handler !== null && command.handler !== 'dispatcher') return null;
  if (!command.registered) return notHere;
  return command.availability.enabled ? null : command.availability.reason;
}

/** The keyboard shortcut list, generated from the registry, grouped and filtered by name or key; with Vim mode on, Vim's keys follow as their own group, which the filter `vim` finds whole. */
export function ShortcutHelp({ commands, env = keyEnvironment }: ShortcutHelpProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const headingPrefix = useId();
  const then = t('shortcuts.then');
  const rows = useMemo(() =>
    commands.map(command => {
      const labels = command.keys.map(keys => formatKeys(keys, env));
      const scopes = command.scopes?.map(scope => t(`shortcuts.scope.${scope}`)) ?? [];
      // Typed key text (`mod+/`, `ctrl+shift+p`) and the shown labels (`⌘/`, `G then N`) both find a row.
      const keyText = command.handler ? keymapEntry(command.id).bindings.map(binding => binding.keys) : [];
      const haystack = [command.title, command.englishTitle, command.description ?? '', ...command.keywords, command.id, ...scopes, ...keyText, ...command.keys.map(keys => describeKeys(keys, env, then)), ...labels.flat()].join('\n').toLocaleLowerCase();
      return { command, labels, scopes, haystack, reason: unavailableReason(command, t('shortcuts.unavailableHere')) };
    }), [commands, env, t, then]);
  const vimMode = useVimMode();
  const vimRows = useMemo(() =>
    vimMode
      ? VIM_CHEATSHEET.map(item => {
        const labels = item.keys.map(keys => isVimChord(keys) ? formatKeys(parseKeys(keys), env) : [keys]);
        const haystack = ['vim', t('shortcuts.group.vim'), t(item.title), en[item.title], item.id, ...item.keys, ...labels.flat()].join('\n').toLocaleLowerCase();
        return { id: `vim.${item.id}`, title: t(item.title), labels, haystack };
      })
      : [], [vimMode, env, t]);
  const needle = filter.trim().toLocaleLowerCase();
  const matches = (haystack: string) => !needle || needle.split(/\s+/).every(word => haystack.includes(word));
  const shown = rows.filter(row => matches(row.haystack));
  const shownVim = vimRows.filter(row => matches(row.haystack));
  const count = shown.length + shownVim.length;
  return (
    <div className='shortcut-help' data-registry-count={commands.length}>
      <label className='keyboard-shortcuts-search'>
        <Search aria-hidden='true' />
        <input type='search' aria-label={t('shortcuts.filter')} placeholder={t('shortcuts.filterPlaceholder')} value={filter} onChange={event => setFilter(event.target.value)} autoComplete='off' />
      </label>
      <p className='shortcut-help-count' role='status'>{count ? t('shortcuts.count', { count }) : t('shortcuts.noShortcutResults')}</p>
      <div className='shortcut-help-groups'>
        {SHORTCUT_GROUPS.map(group => {
          const groupRows = shown.filter(row => row.command.group === group);
          if (!groupRows.length) return null;
          const headingId = `${headingPrefix}-${group}`;
          return (
            <section key={group} className='shortcut-help-group' aria-labelledby={headingId}>
              <h3 id={headingId}>{t(`shortcuts.group.${group}`)}</h3>
              <ul>
                {groupRows.map(({ command, labels, scopes, reason }) => (
                  <li key={command.id} data-shortcut-id={command.id} data-unavailable={reason ? true : undefined}>
                    <span className='shortcut-help-name'>
                      <span>{command.title}</span>
                      {command.description && <small>{command.description}</small>}
                      {scopes.length > 0 && <small className='shortcut-help-scope'>{scopes.join(' · ')}</small>}
                      {reason && <small className='shortcut-help-reason'>{reason}</small>}
                    </span>
                    <ShortcutKeys labels={labels} then={then} none={t('shortcuts.noKey')} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {shownVim.length > 0 && (
          <section className='shortcut-help-group' data-shortcut-group='vim' aria-labelledby={`${headingPrefix}-vim`}>
            <h3 id={`${headingPrefix}-vim`}>{t('shortcuts.group.vim')}</h3>
            <ul>
              {shownVim.map(({ id, title, labels }) => (
                <li key={id} data-shortcut-id={id}>
                  <span className='shortcut-help-name'>
                    <span>{title}</span>
                  </span>
                  <ShortcutKeys labels={labels} then={then} none={t('shortcuts.noKey')} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** A row's bindings, each a run of chords joined by "then", the bindings set apart by slashes. */
function ShortcutKeys({ labels, then, none }: { labels: readonly (readonly string[])[]; then: string; none: string; }) {
  return (
    <span className='shortcut-help-keys'>
      {labels.length
        ? labels.map((chords, index) => (
          <span key={index} className='shortcut-help-binding'>
            {index > 0 && <small>/</small>}
            {chords.map((label, chord) => (
              <span key={chord}>
                {chord > 0 && <small>{then}</small>}
                <kbd>{label}</kbd>
              </span>
            ))}
          </span>
        ))
        : <small>{none}</small>}
    </span>
  );
}
