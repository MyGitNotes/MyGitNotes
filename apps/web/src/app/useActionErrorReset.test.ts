// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useActionErrorReset } from './useActionErrorReset.js';

describe('useActionErrorReset', () => {
  it('keeps an action’s error while the person stays, and clears it once they move on to another address', () => {
    const setActionError = vi.fn();
    const hook = renderHook(({ at }: { at: string; }) => useActionErrorReset(at, setActionError), { initialProps: { at: '/notebooks/nb?q=pla' } });
    hook.rerender({ at: '/notebooks/nb?q=pla' });
    expect(setActionError).not.toHaveBeenCalled();
    hook.rerender({ at: '/notebooks/nb' });
    expect(setActionError).toHaveBeenCalledWith('');
  });
});
