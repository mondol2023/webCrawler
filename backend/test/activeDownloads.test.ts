import { describe, it, expect } from 'vitest';
import { register, cancel, unregister } from '../src/services/media/activeDownloads';

describe('activeDownloads', () => {
  it('cancel aborts the registered signal and unregisters it', () => {
    const s = register('a');
    expect(cancel('a')).toBe(true);
    expect(s.aborted).toBe(true);
    expect(cancel('a')).toBe(false);
  });

  it('register throws for an id that is already active', () => {
    register('b');
    expect(() => register('b')).toThrow();
    unregister('b');
    expect(() => register('b')).not.toThrow();
    unregister('b');
  });
});
