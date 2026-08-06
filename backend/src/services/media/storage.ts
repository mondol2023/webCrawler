/**
 * Filesystem layout for downloaded media.
 *
 * Files live under `<MEDIA_DOWNLOAD_DIR>/<userId>/<downloadId>.<ext>`. Keeping
 * one directory per user means a path built from a user's own id can never
 * reach another user's files, and `assertInsideRoot` catches any path that
 * escapes the root regardless of how it was constructed.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { env } from '../../config/env';

export const MEDIA_ROOT = path.resolve(env.MEDIA_DOWNLOAD_DIR);

/** Per-download hard cap, so one job cannot fill the disk. */
export const MAX_DOWNLOAD_BYTES = parseInt(env.MEDIA_MAX_BYTES, 10);

export class StorageError extends Error {}

/** Control characters (0x00–0x1F) are illegal in filenames on every platform. */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f]', 'g');
/** Reserved on Windows, plus the path separators. */
const RESERVED_CHARS = /[<>:"/\\|?*]+/g;

/** Creates (if needed) and returns the directory for one user's downloads. */
export async function userDir(userId: string): Promise<string> {
  // userId comes from a verified JWT and is a Mongo ObjectId, but normalising
  // defensively costs nothing and keeps the guarantee local to this function.
  const safeId = userId.replace(/[^a-zA-Z0-9]/g, '');
  if (!safeId) throw new StorageError('Invalid user id.');

  const dir = path.join(MEDIA_ROOT, safeId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Turns a page title or remote filename into something safe to write to disk on
 * both Windows and POSIX. Returns `fallback` when nothing usable survives.
 */
export function safeFilename(raw: string | undefined, fallback = 'media'): string {
  const base = (raw ?? '')
    .normalize('NFKD')
    .replace(CONTROL_CHARS, '')
    .replace(RESERVED_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Leading dots hide files; trailing dots are stripped by Windows anyway.
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, 120)
    .trim();

  return base || fallback;
}

/**
 * Verifies `candidate` really is inside MEDIA_ROOT before we read or delete it.
 * Guards the file-serving endpoint against a traversal in a stored path.
 */
export function assertInsideRoot(candidate: string): string {
  const resolved = path.resolve(candidate);
  const root = MEDIA_ROOT.endsWith(path.sep) ? MEDIA_ROOT : MEDIA_ROOT + path.sep;
  if (resolved !== MEDIA_ROOT && !resolved.startsWith(root)) {
    throw new StorageError('Refusing to touch a path outside the media directory.');
  }
  return resolved;
}

/** Deletes a downloaded file, ignoring "already gone". */
export async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(assertInsideRoot(filePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** Byte size of a file, or undefined when it no longer exists. */
export async function fileSize(filePath: string): Promise<number | undefined> {
  try {
    const stat = await fs.stat(assertInsideRoot(filePath));
    return stat.size;
  } catch {
    return undefined;
  }
}

/**
 * Finds the file yt-dlp actually wrote. It appends the real container
 * extension, which we don't know until the download finishes, so we match on
 * the stem we asked for.
 */
export async function findByStem(dir: string, stem: string): Promise<string | undefined> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const match = entries.find((name) => name.startsWith(`${stem}.`));
  return match ? path.join(dir, match) : undefined;
}
