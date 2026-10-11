import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { cookieMaxAge } from '../src/controllers/auth.controller';

describe('cookieMaxAge', () => {
  it('derives the cookie lifetime from the JWT exp claim', () => {
    const t = jwt.sign({}, 'x'.repeat(32), { expiresIn: '15m' });
    expect(Math.abs(cookieMaxAge(t) - 900_000)).toBeLessThanOrEqual(2000);
  });

  it('floors at 0 for expired or undecodable tokens', () => {
    const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 60 }, 'x'.repeat(32));
    expect(cookieMaxAge(expired)).toBe(0);
    expect(cookieMaxAge('garbage')).toBe(0);
  });
});
