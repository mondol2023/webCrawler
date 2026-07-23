import { URL } from 'url';

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash, lowercase host
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '') || '/'}${parsed.search}`;
  } catch {
    return url;
  }
}

export function getBaseUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

export function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    const urlHost = new URL(url).hostname;
    const baseHost = new URL(baseUrl).hostname;
    return urlHost === baseHost || urlHost.endsWith(`.${baseHost}`);
  } catch {
    return false;
  }
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function resolveUrl(base: string, relative: string): string | null {
  try {
    return new URL(relative, base).toString();
  } catch {
    return null;
  }
}

export function shouldSkipUrl(url: string): boolean {
  const skipExtensions = [
    '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
    '.mp4', '.mp3', '.zip', '.exe', '.dmg', '.ico', '.css', '.js',
  ];
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return skipExtensions.some((ext) => pathname.endsWith(ext));
  } catch {
    return true;
  }
}