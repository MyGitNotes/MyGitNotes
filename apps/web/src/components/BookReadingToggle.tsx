import { BookOpen, ScrollText } from 'lucide-react';
import type { BookReadingMode } from '../lib/book-reading.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';

const MODES = [{ value: 'continuous', icon: ScrollText }, { value: 'paged', icon: BookOpen }] as const;

/** The book bar's switch between continuous and paged reading; the choice belongs to this device, not to the compilation. */
export function BookReadingToggle({ mode, onChange }: { mode: BookReadingMode; onChange: (mode: BookReadingMode) => void; }) {
  const { t } = useTranslation();
  return (
    <div className='compilation-book-modes' role='group' aria-label={t('book.readingMode')}>
      {MODES.map(({ value, icon: Icon }) => (
        <Button
          key={value}
          type='button'
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
        >
          <Icon size={14} aria-hidden='true' />
          <span>{t(`book.mode.${value}`)}</span>
        </Button>
      ))}
    </div>
  );
}
