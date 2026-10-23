import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AttrGroups, AttrSpec } from '../../lib/infographics/model.js';
import { AttrField } from './AttrField.js';
import type { Translate } from './labels.js';

interface Props {
  groups: AttrGroups;
  values: Record<string, string> | undefined;
  t: Translate;
  onChange: (spec: AttrSpec) => (value: string | boolean) => void;
}

/**
 * The fields of one set of attributes: the essential ones always, the rest behind a "More settings" disclosure
 * that starts open only when one of them already has a value. Remount it (with a key) to start afresh.
 */
export function AttrGroup({ groups, values, t, onChange }: Props) {
  const id = useId();
  const [open, setOpen] = useState(() => groups.more.some(attr => values?.[attr.key] !== undefined));
  const field = (attr: AttrSpec) => <AttrField key={attr.key} spec={attr} value={values?.[attr.key]} t={t} onChange={onChange(attr)} />;
  return (
    <>
      {groups.essential.map(field)}
      {groups.more.length > 0 && (
        <>
          <button
            type='button'
            className='ig-more-toggle'
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight aria-hidden='true' />
            {t('infographic.editor.moreSettings')}
          </button>
          {open && <div id={id} className='ig-more'>{groups.more.map(field)}</div>}
        </>
      )}
    </>
  );
}
