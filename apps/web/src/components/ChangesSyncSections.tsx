import { useEffect, useRef } from 'react';
import { useWorkspaceGitSync } from '../lib/workspace-git-sync.js';
import { GitSyncSection } from './GitSyncSection.js';

export function ChangesSyncSections() {
  const sync = useWorkspaceGitSync();
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sync?.reveal || !group.current) return;
    const repository = sync.reveal.repository;
    const target = Array.from(group.current.querySelectorAll<HTMLElement>('[data-sync-repository]')).find(node => node.dataset.syncRepository === repository) ?? group.current;
    target.scrollIntoView?.({ block: 'start' });
    target.focus({ preventScroll: true });
    sync.didReveal();
  }, [sync]);
  if (!sync?.targets.length) return null;
  return <div ref={group} tabIndex={-1} className='changes-sync-sections'>{sync.targets.map(target => <GitSyncSection key={target.id} target={target} />)}</div>;
}
