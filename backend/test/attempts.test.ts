import { describe, it, expect } from 'vitest';
import { isFinalAttempt } from '../src/queue/attempts';

describe('isFinalAttempt', () => {
  it('is false while retries remain', () => {
    expect(isFinalAttempt({ attemptsMade: 1, opts: { attempts: 2 } })).toBe(false);
  });
  it('is true once attempts are used up', () => {
    expect(isFinalAttempt({ attemptsMade: 2, opts: { attempts: 2 } })).toBe(true);
  });
  it('treats a missing attempts option as a single attempt', () => {
    expect(isFinalAttempt({ attemptsMade: 1, opts: {} })).toBe(true);
  });
  it('treats an unknown job as final', () => {
    expect(isFinalAttempt(undefined)).toBe(true);
  });
});
