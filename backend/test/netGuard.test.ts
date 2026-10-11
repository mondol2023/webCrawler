import { describe, it, expect } from 'vitest';
import { isPrivateAddress, assertPublicUrl, assertPublicProxyUrl, guardedLookup, publicAgents, BlockedHostError } from '../src/services/media/netGuard';

describe('isPrivateAddress', () => {
  it.each(['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:127.0.0.1', '64:ff9b::7f00:1', '::1', 'fd00::1', '127.0.0.1', '10.1.2.3', '169.254.169.254'])(
    'refuses %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(['8.8.8.8', '2606:4700:4700::1111', '::ffff:808:808'])(
    'allows %s', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

it('rejects bracketed hex-mapped metadata URL', async () => {
  await expect(assertPublicUrl('http://[::ffff:169.254.169.254]/')).rejects.toBeInstanceOf(BlockedHostError);
});

it('rejects a private proxy host but accepts socks scheme parsing', async () => {
  await expect(assertPublicProxyUrl('http://127.0.0.1:6379')).rejects.toBeInstanceOf(BlockedHostError);
  await expect(assertPublicProxyUrl('socks5://user:pw@localhost:1080')).rejects.toBeInstanceOf(BlockedHostError);
});

it('guardedLookup errors for localhost', async () => {
  const err = await new Promise((r) => guardedLookup('localhost', {}, (e) => r(e)));
  expect((err as NodeJS.ErrnoException).code).toBe('EBLOCKED');
});

describe('publicAgents', () => {
  // net.connect skips `lookup` for literal IPs, so the agents must check them
  // too — otherwise a redirect to http://127.0.0.1/ would sail through.
  it.each(['http://127.0.0.1:1/', 'http://[::ffff:7f00:1]:1/'])('refuses literal private host %s', async (target) => {
    const http = await import('http');
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      http.get(target, { agent: publicAgents().httpAgent }, () => resolve(new Error('connected') as NodeJS.ErrnoException))
        .on('error', (e) => resolve(e));
    });
    expect(err.code).toBe('EBLOCKED');
  });
});
