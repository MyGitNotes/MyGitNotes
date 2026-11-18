// @vitest-environment jsdom
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { FOLD_MS } from '../lib/use-fold-animation.js';
import { zhTW } from '../lib/i18n/zh-TW.js';
import { BrowseDock, BrowseDockToggle } from './BrowseDock.js';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

afterEach(cleanup);

const baseProps = { placement: 'left' as const, size: 280, onSizeChange: vi.fn(), collapsed: false };

it('renders only the browse content when narrow and narrowView is browse', () => {
  /* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
  render(createElement(BrowseDock, { ...baseProps, narrow: true, narrowView: 'browse', browse: createElement('div', null, 'browse-content'), children: createElement('div', null, 'focus-content') }));
  /* eslint-enable react/no-children-prop */
  expect(screen.getByText('browse-content')).toBeInTheDocument();
  expect(screen.queryByText('focus-content')).not.toBeInTheDocument();
});

it('renders only the Focus content when narrow and narrowView is focus', () => {
  /* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
  render(createElement(BrowseDock, { ...baseProps, narrow: true, narrowView: 'focus', browse: createElement('div', null, 'browse-content'), children: createElement('div', null, 'focus-content') }));
  /* eslint-enable react/no-children-prop */
  expect(screen.getByText('focus-content')).toBeInTheDocument();
  expect(screen.queryByText('browse-content')).not.toBeInTheDocument();
});

it('collapsed keeps the browse region mounted but inert, with the Focus area shown and no control over it', () => {
  /* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
  const { container } = render(createElement(BrowseDock, { ...baseProps, narrow: false, collapsed: true, narrowView: 'browse', browse: createElement('div', null, 'browse-content'), children: createElement('div', null, 'focus-content') }));
  /* eslint-enable react/no-children-prop */
  expect(screen.getByText('focus-content')).toBeInTheDocument();
  expect(container.querySelector('.browse-dock')).toHaveAttribute('data-collapsed', 'true');
  // Kept in the tree so expanding it again animates and the Focus never remounts; inert so nothing in it takes focus.
  expect(screen.getByText('browse-content').closest('[inert]')).not.toBeNull();
  expect(screen.getByText('focus-content').closest('[inert]')).toBeNull();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('expanded leaves the browse region reachable', () => {
  /* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
  const { container } = render(createElement(BrowseDock, { ...baseProps, narrow: false, collapsed: false, narrowView: 'browse', browse: createElement('div', null, 'browse-content'), children: createElement('div', null, 'focus-content') }));
  /* eslint-enable react/no-children-prop */
  expect(container.querySelector('.browse-dock')).not.toHaveAttribute('data-collapsed');
  expect(container.querySelector('[inert]')).toBeNull();
});

it('keeps the Focus area mounted, not remounted, across collapse and expand', () => {
  const mounts = vi.fn();
  const unmounts = vi.fn();
  const FocusContent = () => {
    useEffect(() => {
      mounts();
      return unmounts;
    }, []);
    return createElement('div', { 'data-testid': 'focus-content' }, 'focus-content');
  };
  /* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
  const dock = (collapsed: boolean) => createElement(BrowseDock, { ...baseProps, narrow: false, collapsed, narrowView: 'browse', browse: createElement('div', null, 'browse-content'), children: createElement(FocusContent) });
  /* eslint-enable react/no-children-prop */
  const { rerender } = render(dock(false));
  const focus = screen.getByTestId('focus-content');
  for (const collapsed of [true, false, true, false]) {
    rerender(dock(collapsed));
    expect(screen.getByTestId('focus-content')).toBe(focus);
  }
  expect(mounts).toHaveBeenCalledTimes(1);
  expect(unmounts).not.toHaveBeenCalled();
});

it('starts collapsed without an animation and animates only the change', () => {
  vi.useFakeTimers();
  try {
    /* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
    const dock = (collapsed: boolean) => createElement(BrowseDock, { ...baseProps, narrow: false, collapsed, narrowView: 'browse', browse: createElement('div', null, 'browse-content'), children: createElement('div', null, 'focus-content') });
    /* eslint-enable react/no-children-prop */
    const { container, rerender } = render(dock(true));
    expect(container.querySelector('.browse-dock')).not.toHaveAttribute('data-animating');
    rerender(dock(false));
    expect(container.querySelector('.browse-dock')).toHaveAttribute('data-animating');
    act(() => {
      vi.advanceTimersByTime(FOLD_MS + 100);
    });
    expect(container.querySelector('.browse-dock')).not.toHaveAttribute('data-animating');
  } finally {
    vi.useRealTimers();
  }
});

it('renders both regions, with no control over them, when docked and expanded', () => {
  /* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
  render(createElement(BrowseDock, { ...baseProps, narrow: false, collapsed: false, narrowView: 'browse', browse: createElement('div', null, 'browse-content'), children: createElement('div', null, 'focus-content') }));
  /* eslint-enable react/no-children-prop */
  expect(screen.getByText('browse-content')).toBeInTheDocument();
  expect(screen.getByText('focus-content')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('names the divider between the browse region and the Focus by what dragging it resizes', () => {
  /* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
  const { rerender } = render(createElement(BrowseDock, { ...baseProps, narrow: false, narrowView: 'browse', browse: createElement('div', null, 'browse-content'), children: createElement('div', null, 'focus-content') }));
  expect(screen.getByRole('separator', { name: 'Resize browse panel width' })).toBeInTheDocument();
  rerender(createElement(BrowseDock, { ...baseProps, placement: 'top', narrow: false, narrowView: 'browse', browse: createElement('div', null, 'browse-content'), children: createElement('div', null, 'focus-content') }));
  /* eslint-enable react/no-children-prop */
  expect(screen.getByRole('separator', { name: 'Resize browse panel height' })).toBeInTheDocument();
  expect([zhTW['focus.resizeBrowseWidth'], zhTW['focus.resizeBrowseHeight']]).toEqual(['調整瀏覽區的寬度', '調整瀏覽區的高度']);
});

it('toggle collapses an expanded dock and reopens a collapsed one', () => {
  const onCollapsedChange = vi.fn();
  const { rerender } = render(createElement(BrowseDockToggle, { placement: 'left', collapsed: false, onCollapsedChange }));
  fireEvent.click(screen.getByLabelText('Collapse browse panel and header'));
  expect(onCollapsedChange).toHaveBeenLastCalledWith(true);
  rerender(createElement(BrowseDockToggle, { placement: 'left', collapsed: true, onCollapsedChange }));
  fireEvent.click(screen.getByLabelText('Expand browse panel and header'));
  expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
});

it('toggle reports whether the browse region is expanded', () => {
  const { rerender } = render(createElement(BrowseDockToggle, { placement: 'left', collapsed: false, onCollapsedChange: vi.fn() }));
  expect(screen.getByRole('button', { name: 'Collapse browse panel and header' })).toHaveAttribute('aria-expanded', 'true');
  rerender(createElement(BrowseDockToggle, { placement: 'left', collapsed: true, onCollapsedChange: vi.fn() }));
  expect(screen.getByRole('button', { name: 'Expand browse panel and header' })).toHaveAttribute('aria-expanded', 'false');
});

/** A left dock that carries its own toggle while open, and a toolbar that shows one only to reopen it, as the Notes page lays them out. */
function MovingToggle() {
  const [collapsed, setCollapsed] = useState(false);
  const waiting = useRef(false);
  const focusHandoff = useMemo(() => ({
    request: () => {
      waiting.current = true;
    },
    claim: () => {
      const claimed = waiting.current;
      waiting.current = false;
      return claimed;
    },
  }), []);
  const toggle = <BrowseDockToggle placement='left' collapsed={collapsed} onCollapsedChange={setCollapsed} focusHandoff={focusHandoff} />;
  return (
    <div>
      <div role='toolbar' aria-label='Notes toolbar'>{collapsed ? toggle : null}</div>
      <BrowseDock {...baseProps} collapsed={collapsed} narrow={false} narrowView='browse' browse={<div data-testid='dock'>{toggle}</div>}>
        <div>focus-content</div>
      </BrowseDock>
    </div>
  );
}

it('a toggle that moves between the dock and the toolbar keeps the keyboard on it, and the collapsed dock reopens from the toolbar', () => {
  render(<MovingToggle />);
  const toolbar = screen.getByRole('toolbar', { name: 'Notes toolbar' });
  expect(within(toolbar).queryByRole('button')).not.toBeInTheDocument();
  const inDock = within(screen.getByTestId('dock')).getByRole('button', { name: 'Collapse browse panel and header' });
  inDock.focus();
  fireEvent.click(inDock);
  const reopen = within(toolbar).getByRole('button', { name: 'Expand browse panel and header' });
  expect(reopen).toHaveAttribute('aria-expanded', 'false');
  expect(reopen).toHaveFocus();
  expect(screen.getByTestId('dock').closest('[inert]')).not.toBeNull();
  fireEvent.click(reopen);
  expect(within(toolbar).queryByRole('button')).not.toBeInTheDocument();
  const back = within(screen.getByTestId('dock')).getByRole('button', { name: 'Collapse browse panel and header' });
  expect(back).toHaveAttribute('aria-expanded', 'true');
  expect(back).toHaveFocus();
});
