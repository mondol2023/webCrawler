import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { authenticateHandshake } from '../src/services/socketService';
import { signAccessToken } from '../src/utils/jwt';

describe('authenticateHandshake', () => {
  const t = signAccessToken({ _id: new Types.ObjectId(), role: 'user', email: 'a@b.co' } as never);

  it('returns null with no cookie and no auth token', () => {
    expect(authenticateHandshake(undefined, undefined)).toBeNull();
  });

  it('returns null for an invalid cookie token', () => {
    expect(authenticateHandshake('accessToken=garbage', undefined)).toBeNull();
  });

  it('accepts a valid accessToken cookie', () => {
    expect(authenticateHandshake(`accessToken=${t}`, undefined)?.email).toBe('a@b.co');
  });

  it('falls back to the auth token', () => {
    expect(authenticateHandshake(undefined, t)?.role).toBe('user');
  });
});
