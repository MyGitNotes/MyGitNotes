import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageStep } from '../lib/book-paging.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';

export interface BookPagerProps {
  /** The zero-based index of the page shown. */
  index: number;
  /** The pages loaded so far. */
  total: number;
  /** More chapters can still be loaded, so the last loaded page is not the last page. */
  hasMore: boolean;
  /** The next chapters are loading. */
  loadingMore: boolean;
  onStep: (step: PageStep) => void;
}

/** The footer of a paged book: Previous, "3 / 14" and Next. */
export function BookPager({ index, total, hasMore, loadingMore, onStep }: BookPagerProps) {
  const { t } = useTranslation();
  const last = index >= total - 1;
  const counts = { page: index + 1, total };
  return (
    <nav className='compilation-book-pager' aria-label={t('book.pages')}>
      <Button type='button' disabled={index <= 0} aria-keyshortcuts='ArrowLeft' onClick={() => onStep('previous')}>
        <ChevronLeft size={16} aria-hidden='true' />
        <span>{t('book.previousPage')}</span>
      </Button>
      <span className='compilation-book-page-count' role='status' aria-label={t('book.pageOf', counts)}>{t(hasMore ? 'book.pageCountMore' : 'book.pageCount', counts)}</span>
      <Button type='button' disabled={last && (!hasMore || loadingMore)} aria-keyshortcuts='ArrowRight' onClick={() => onStep('next')}>
        <span>{t('book.nextPage')}</span>
        <ChevronRight size={16} aria-hidden='true' />
      </Button>
    </nav>
  );
}
