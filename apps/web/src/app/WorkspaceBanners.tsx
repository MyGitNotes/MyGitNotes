import type React from 'react';
import { AlertTriangle } from 'lucide-react';
import { DemoBanner } from '../components/DemoBanner.js';
import { DerivedManifestNotice } from '../components/WorkspaceSetup.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';

interface Props {
  /** Whether a local workspace has the core baseline branch checked out. */
  coreBaseline: boolean;
  /** The notice of old outlines and bookmarks left to recover. */
  legacyNotice: React.ReactNode;
  defaultRepository: WorkspaceState['defaultRepository'];
  /** Whether the default repository, when it keeps no manifest, can create one from its derived layout. */
  manifestWritable: boolean;
  onManifestCreated: React.ComponentProps<typeof DerivedManifestNotice>['onCreated'];
}

/** The notices above the header: the core baseline branch, legacy outlines to recover, the demo, and a derived manifest. */
export function WorkspaceBanners({ coreBaseline, legacyNotice, defaultRepository, manifestWritable, onManifestCreated }: Props) {
  const { t } = useTranslation();
  return (
    <>
      {/* Core Branch User Guidance Banner (Theme-aware, harmonized with active palette) */}
      {coreBaseline && (
        <div className='shrink-0 flex-none px-4 py-2 text-xs flex items-center justify-between font-medium border-b transition-colors' style={{ backgroundColor: 'var(--color-sidebar)', borderColor: 'var(--color-line)', color: 'var(--color-text)' }}>
          <div className='flex items-center gap-2.5'>
            <AlertTriangle className='w-4 h-4 text-warning shrink-0' />
            <span className='px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-on-primary shrink-0 shadow-xs' style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>{t('nav.coreBaseline')}</span>
            <span className='text-muted'>{t('nav.coreBanner')}</span>
          </div>
        </div>
      )}
      {legacyNotice}
      <DemoBanner />
      {defaultRepository?.manifest === 'derived' && defaultRepository.config && <DerivedManifestNotice repository={defaultRepository.id} config={defaultRepository.config} configRevision={defaultRepository.configRevision} canWrite={manifestWritable} onCreated={onManifestCreated} />}
    </>
  );
}
