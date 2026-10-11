import { describe, it, expect } from 'vitest';
import { escapeRegex } from '../src/utils/escapeRegex';
import { isCrawlJobStatus } from '../src/models/CrawlJob.model';

describe('escapeRegex', () => {
  it.each(['(', '.*', 'a+$', '[x]', 'a{2}|b', 'x\\y/z^?'])('matches %s literally', (s) => {
    expect(() => new RegExp(escapeRegex(s))).not.toThrow();
    expect(new RegExp(escapeRegex(s)).test(s)).toBe(true);
  });

  it('does not treat metacharacters as a pattern', () => {
    expect(new RegExp(escapeRegex('.*')).test('abc')).toBe(false);
    expect(new RegExp(escapeRegex('a+$')).test('aaa')).toBe(false);
  });
});

describe('isCrawlJobStatus', () => {
  it('accepts known statuses only', () => {
    expect(isCrawlJobStatus('running')).toBe(true);
    expect(isCrawlJobStatus('bogus')).toBe(false);
    expect(isCrawlJobStatus({ $ne: 'x' })).toBe(false);
    expect(isCrawlJobStatus(['running'])).toBe(false);
  });
});
