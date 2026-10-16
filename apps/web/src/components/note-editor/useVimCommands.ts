import { useEffect, useRef, useState } from 'react';
import { VIM_COMMAND_EVENT, type VimCommand } from '../../lib/vim-mode.js';

export interface VimCommandHandlers {
  /** `:w`: resolves whether the note is written, so `:wq` closes only a note that was. */
  write: () => Promise<boolean>;
  /** `:q`: absent where the note cannot be closed from its editor, as in a Focus pane. */
  quit?: () => void;
}

/** Answers the Vim ex commands raised inside the element the returned ref is set on. */
export function useVimCommands(handlers: VimCommandHandlers) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const current = useRef(handlers);
  /* eslint-disable react/refs -- The listener reads the latest handlers without resubscribing on every render. */
  current.current = handlers;
  /* eslint-enable react/refs */
  useEffect(() => {
    if (!root) return;
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<VimCommand>).detail;
      event.stopPropagation();
      const { write, quit } = current.current;
      if (command === 'quit') quit?.();
      else {
        void write().then(written => {
          if (written && command === 'writeQuit') current.current.quit?.();
        });
      }
    };
    root.addEventListener(VIM_COMMAND_EVENT, onCommand);
    return () => root.removeEventListener(VIM_COMMAND_EVENT, onCommand);
  }, [root]);
  return setRoot;
}
