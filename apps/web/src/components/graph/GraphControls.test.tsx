// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../../lib/i18n/index.js';
import { StatusColorProvider } from '../../lib/status-color.js';
import { GraphControls } from './GraphControls.js';

afterEach(() => {
  cleanup();
  window.localStorage.removeItem('github-notes:language');
});

const legend = (mode: 'status' | 'folder', language: string) => {
  window.localStorage.setItem('github-notes:language', language);
  render(
    <I18nProvider>
      <StatusColorProvider statuses={[{ name: 'review', label: { en: 'In review', 'zh-TW': '審核中' } }, 'done']}>
        <GraphControls controlsRef={{ current: null } as never} filterPanel={null} appearance={{ mode, palette: 'soft', labels: 'all' }} onAppearanceChange={() => {}} visibleColorGroups={[{ key: 'review', label: 'review', color: 'red' }, { key: 'done', label: 'done', color: 'blue' }, { key: '', label: '', color: 'gray' }]} appearanceSaveError={false} />
      </StatusColorProvider>
    </I18nProvider>,
  );
  return within(screen.getByRole('list', { hidden: true })).getAllByRole('listitem', { hidden: true }).map(item => item.textContent);
};

it('names the legend entries of a status colouring by the label for the UI language', () => {
  expect(legend('status', 'zh-TW')).toEqual(['審核中', '完成', '無狀態']);
  cleanup();
  expect(legend('status', 'en')).toEqual(['In review', 'done', 'No status']);
});

it('leaves a legend that is not coloured by status as given', () => {
  expect(legend('folder', 'zh-TW')).toEqual(['review', 'done', '無狀態']);
});
