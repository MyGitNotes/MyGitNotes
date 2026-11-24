import type React from 'react';
import { AgentFocusCommand } from '../components/pi-agent/AgentFocusCommand.js';
import { LiveDraftsProvider } from '../components/live/live-drafts.js';
import { WorkspaceLinks } from '../components/WorkspaceLinks.js';
import { CompilationActionsProvider } from '../lib/compilation-actions.js';
import { NoteEditingProvider } from '../lib/note-editing.js';
import { NoteLocationProvider } from '../lib/note-location.js';
import { OutlineActionsProvider } from '../lib/outline-actions.js';
import { PhoneNotesProvider } from '../lib/phone-notes.js';
import { PiAgentProvider } from '../lib/pi-agent/session.js';
import { StatusColorProvider } from '../lib/status-color.js';
import type { NotebookConfig } from '../lib/types.js';
import { TypstPreviewProvider } from '../lib/typst-preview/preview-target.js';
import { WorkspaceGitSyncProvider } from '../lib/workspace-git-sync.js';
import { EditorModeRouteProvider } from './editor-mode-route.js';
import { LiveEditLinkProvider } from './live-edit-link.js';
import type { WorkspaceState } from './workspace-state.js';

/** A stable empty list while the workspace config loads, so the agent provider's value does not churn. */
const NO_NOTEBOOKS: NotebookConfig[] = [];

type Prop<C extends React.JSXElementConstructor<any>, K extends keyof React.ComponentProps<C>> = React.ComponentProps<C>[K];

interface Props {
  remote: WorkspaceState['remote'];
  loading: WorkspaceState['loading'];
  sourceId: WorkspaceState['sourceId'];
  notebooks: NotebookConfig[] | undefined;
  folders: WorkspaceState['folders'];
  repositories: WorkspaceState['repositories'];
  agentEnabled: boolean;
  webAgentTools: Prop<typeof PiAgentProvider, 'webTools'>;
  outlineActions: Prop<typeof OutlineActionsProvider, 'value'>;
  statusEntries: Prop<typeof StatusColorProvider, 'statuses'>;
  phoneNotes: Prop<typeof PhoneNotesProvider, 'value'>;
  syncTargets: Prop<typeof WorkspaceGitSyncProvider, 'targets'>;
  onSynced: Prop<typeof WorkspaceGitSyncProvider, 'onSynced'>;
  onRevealChanges: Prop<typeof WorkspaceGitSyncProvider, 'onRevealChanges'>;
  liveEditTarget: Prop<typeof LiveEditLinkProvider, 'target'>;
  compilationActions: Prop<typeof CompilationActionsProvider, 'value'>;
  liveDrafts: Prop<typeof LiveDraftsProvider, 'value'>;
  openLink: Prop<typeof WorkspaceLinks, 'onOpenNote'>;
  locateNote: Prop<typeof NoteLocationProvider, 'locate'>;
  /** What every note editor shares: how it registers, its props, and the note actions it offers. */
  noteEditing: Omit<React.ComponentProps<typeof NoteEditingProvider>, 'children'>;
  children: React.ReactNode;
}

/** The contexts the workspace's views read: the agent, outlines, status colours, Typst preview, phone screens, git sync, live edit links, and note editing. */
export function WorkspaceProviders({ remote, loading, sourceId, notebooks, folders, repositories, agentEnabled, webAgentTools, outlineActions, statusEntries, phoneNotes, syncTargets, onSynced, onRevealChanges, liveEditTarget, compilationActions, liveDrafts, openLink, locateNote, noteEditing, children }: Props) {
  // A local workspace starts its Pi agent in the background, so the agent tab opens onto a warm session.
  return (
    <PiAgentProvider webTools={remote ? webAgentTools : undefined} enabled={agentEnabled} defaultRepository={sourceId} notebooks={notebooks ?? NO_NOTEBOOKS} repositories={repositories}>
      <AgentFocusCommand />
      <OutlineActionsProvider value={outlineActions}>
        <StatusColorProvider statuses={statusEntries}>
          {/* The Typst preview and its citations run on this machine, so only a local workspace has them. */}
          <TypstPreviewProvider enabled={!remote && !loading}>
            <PhoneNotesProvider value={phoneNotes}>
              <EditorModeRouteProvider>
                <WorkspaceGitSyncProvider enabled={!remote} targets={syncTargets} onSynced={onSynced} flushEditors={noteEditing.flushEditors} onRevealChanges={onRevealChanges}>
                  <LiveEditLinkProvider target={liveEditTarget}>
                    <CompilationActionsProvider value={compilationActions}>
                      <LiveDraftsProvider value={liveDrafts}>
                        <WorkspaceLinks notebooks={notebooks || []} folders={folders} onOpenNote={openLink}>
                          <NoteLocationProvider locate={locateNote}>
                            <NoteEditingProvider {...noteEditing}>{children}</NoteEditingProvider>
                          </NoteLocationProvider>
                        </WorkspaceLinks>
                      </LiveDraftsProvider>
                    </CompilationActionsProvider>
                  </LiveEditLinkProvider>
                </WorkspaceGitSyncProvider>
              </EditorModeRouteProvider>
            </PhoneNotesProvider>
          </TypstPreviewProvider>
        </StatusColorProvider>
      </OutlineActionsProvider>
    </PiAgentProvider>
  );
}
