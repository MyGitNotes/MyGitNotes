import type { ReactNode } from 'react';
import { ExternalLink, Link as LinkIcon } from 'lucide-react';
import { Link, useInRouterContext } from 'react-router-dom';
import { useTranslation } from '../lib/i18n/index.js';
import type { ShownSidebarLink } from '../lib/web-features.js';
import './sidebar-links.css';

/** Where the links sit: the sidebar's footer, the icon rail, or a phone's filter sheet. */
export type SidebarLinksVariant = 'sidebar' | 'rail' | 'sheet';

const groupClass: Record<SidebarLinksVariant, string> = { sidebar: 'sidebar-links', rail: 'sidebar-rail-links', sheet: 'phone-sheet-section phone-sheet-list sidebar-sheet-links' };
const linkClass: Record<SidebarLinksVariant, string> = { sidebar: 'sidebar-link', rail: 'ui-icon-button sidebar-rail-button', sheet: 'phone-sheet-item' };

/** One anchor: a URL opens in a new tab without an opener; a path goes through the router when there is one (so a base path is kept), else it is a plain link. */
function SidebarLinkAnchor({ link, className, label, title, onNavigate, children }: { link: ShownSidebarLink; className: string; label?: string; title?: string; onNavigate?: () => void; children: ReactNode; }) {
  const routed = useInRouterContext();
  if (link.external) return <a className={className} href={link.href} target='_blank' rel='noopener noreferrer' aria-label={label} title={title}>{children}</a>;
  if (routed) return <Link className={className} to={link.href} aria-label={label} title={title} onClick={onNavigate}>{children}</Link>;
  return <a className={className} href={link.href} aria-label={label} title={title} onClick={onNavigate}>{children}</a>;
}

/** The links editions add to the sidebar (`WebFeature.sidebarLinks`), as a small group of rows or rail icons. Render it only when there are links. */
export function SidebarLinks({ links, variant, onNavigate }: { links: readonly ShownSidebarLink[]; variant: SidebarLinksVariant; /** Called when a path of the app is followed, such as to close the sheet. */ onNavigate?: () => void; }) {
  const { t } = useTranslation();
  return (
    <nav className={groupClass[variant]} aria-label={t('sidebar.links')}>
      {links.map(link => {
        const Icon = link.icon ?? LinkIcon;
        const name = link.external ? t('sidebar.linkNewTab', { label: link.label }) : link.label;
        if (variant === 'rail') {
          return (
            <SidebarLinkAnchor key={link.id} link={link} className={linkClass.rail} label={name} title={link.label} onNavigate={onNavigate}>
              <Icon aria-hidden='true' />
            </SidebarLinkAnchor>
          );
        }
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
