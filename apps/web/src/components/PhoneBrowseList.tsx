import { type ReactNode } from 'react';
import './phone-browse-list.css';

/**
 * A phone's list screen below its bar: beside a Focus, the path line (where the list is and how many notes it holds), then the list,
 * which scrolls on its own. The notebook's folders live in the drawer's 目錄 tab, so nothing sits under the list.
 */
export function PhoneBrowseList({ path, children }: { path?: ReactNode; children: ReactNode; }) {
  return (
    <div className='phone-browse-list'>
      {path && (
        <div className='phone-browse-path'>
          <div className='phone-browse-path-content'>{path}</div>
        </div>
      )}
      <div className='workspace-scroll phone-browse-scroll'>{children}</div>
    </div>
  );
}
