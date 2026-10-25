import { useEffect, useMemo, useState } from 'react';
import { type CommittedLayer, demoCommittedLayer, subscribeLocalCommits } from './local-commits.js';

/** The layer of a workspace with no local commits; the same object every time. */
export const NO_COMMITTED: CommittedLayer = {};

/**
 * The notes committed in this browser to the demo repositories among `repositories`, re-read after every local commit and
 * every change another tab makes. The same empty object is returned while there are none, so nothing downstream changes.
 */
export function useCommittedLayer(repositories: readonly { id: string; branch: string; demo?: true; }[]): CommittedLayer {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeLocalCommits(() => setVersion(current => current + 1)), []);
  const scopes = repositories.filter(repository => repository.demo).map(repository => `${repository.id}:${repository.branch}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- The joined scopes and the counter are the projection key; the repositories array is new on every refresh.
  return useMemo(() => {
    if (!scopes) return NO_COMMITTED;
    const layer = demoCommittedLayer(repositories);
    return Object.keys(layer).length ? layer : NO_COMMITTED;
  }, [scopes, version]);
}
