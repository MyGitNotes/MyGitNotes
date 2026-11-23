import type { ReactNode } from 'react';
import { ExternalLink, Link as LinkIcon } from 'lucide-react';
import { Link, useInRouterContext } from 'react-router-dom';
import { useTranslation } from '../lib/i18n/index.js';
import type { ShownSidebarLink } from '../lib/web-features.js';
import { Tooltip } from './Tooltip.js';
import './sidebar-links.css';

/** Where the links sit: the sidebar's footer (or under the browse dock's filters), or a phone's filter sheet. */
export type SidebarLinksVariant = 'sidebar' | 'sheet';

const groupClass: Record<SidebarLinksVariant, string> = { sidebar: 'sidebar-links', sheet: 'phone-sheet-section phone-sheet-list sidebar-sheet-links' };
const linkClass: Record<SidebarLinksVariant, string> = { sidebar: 'sidebar-link', sheet: 'phone-sheet-item' };

/** One anchor: a URL opens in a new tab without an opener; a path goes through the router when there is one (so a base path is kept), else it is a plain link. `title` names it by tooltip. */
function SidebarLinkAnchor({ link, className, label, title, onNavigate, children }: { link: ShownSidebarLink; className: string; label?: string; title?: string; onNavigate?: () => void; children: ReactNode; }) {
  const routed = useInRouterContext();
  const anchor = link.external ? <a className={className} href={link.href} target='_blank' rel='noopener noreferrer' aria-label={label}>{children}</a> : routed ? <Link className={className} to={link.href} aria-label={label} onClick={onNavigate}>{children}</Link> : <a className={className} href={link.href} aria-label={label} onClick={onNavigate}>{children}</a>;
  // In the sidebar, where the rail hides the label, a tooltip names the link.
  return title ? <Tooltip label={title} side='right'>{anchor}</Tooltip> : anchor;
}

/** The links editions add to the sidebar (`WebFeature.sidebarLinks`), as a small group of rows. Render it only when there are links. */
export function SidebarLinks({ links, variant, onNavigate }: { links: readonly ShownSidebarLink[]; variant: SidebarLinksVariant; /** Called when a path of the app is followed, such as to close the sheet. */ onNavigate?: () => void; }) {
  const { t } = useTranslation();
  return (
    <nav className={groupClass[variant]} aria-label={t('sidebar.links')}>
      {links.map(link => {
        const Icon = link.icon ?? LinkIcon;
        const name = link.external ? t('sidebar.linkNewTab', { label: link.label }) : link.label;
        return (
          <SidebarLinkAnchor key={link.id} link={link} className={linkClass[variant]} label={link.external ? name : undefined} title={variant === 'sidebar' ? link.label : undefined} onNavigate={onNavigate}>
            <Icon aria-hidden='true' />
            <span className='sidebar-link-label'>{link.label}</span>
            {link.external && <ExternalLink className='sidebar-link-external' aria-hidden='true' />}
          </SidebarLinkAnchor>
        );
      })}
    </nav>
  );
}
