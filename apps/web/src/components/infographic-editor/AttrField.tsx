import { useId } from 'react';
import type { AttrSpec } from '../../lib/infographics/model.js';
import { attrLabel, optionLabel, type Translate } from './labels.js';

interface Props {
  spec: AttrSpec;
  /** The attribute's value, or undefined when the block does not set it. */
  value: string | undefined;
  t: Translate;
  onChange: (value: string | boolean) => void;
}

/** One attribute of a block or child container, edited by the control its type calls for. */
export function AttrField({ spec, value, t, onChange }: Props) {
  const id = useId();
  const label = attrLabel(t, spec);
  if (spec.type === 'flag') {
    return (
      <label className='ig-field ig-field-flag'>
        <input type='checkbox' checked={value !== undefined} onChange={event => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  if (spec.type === 'select') {
    // A value the editor does not list (a palette written by hand) is kept and shown rather than silently replaced.
    const options = spec.options ?? [];
    const extra = value && !options.includes(value) ? [value] : [];
    return (
      <div className='ig-field'>
        <label htmlFor={id}>{label}</label>
        <select id={id} value={value ?? ''} onChange={event => onChange(event.target.value)}>
          <option value=''>{t('infographic.option.default')}</option>
          {[...options, ...extra].map(option => <option key={option} value={option}>{optionLabel(t, option)}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div className='ig-field'>
      <label htmlFor={id}>{label}</label>
      <input id={id} type='text' inputMode={spec.type === 'number' ? 'decimal' : undefined} placeholder={spec.type === 'numbers' ? t('infographic.attr.ticksHint') : undefined} value={value ?? ''} onChange={event => onChange(event.target.value)} />
    </div>
  );
}
