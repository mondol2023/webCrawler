/**
 * Thin wrapper around the `yt-dlp` binary.
 *
 * yt-dlp is an optional dependency: it is what makes YouTube, Vimeo, and the
 * ~1800 other extractor-backed sites work, but the app degrades to the generic
 * page scanner without it. Everything here therefore reports availability
 * rather than assuming it, and `isAvailable()` is cached for the process.
 *
 * All spawns use argument arrays — never a shell string — so a hostile URL
 * cannot inject flags or shell metacharacters.
 */
import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import type { MediaCandidate, ProxyConfig, Restriction } from './types';
import { detectFromText } from './RestrictionDetector';
import { NO_RESTRICTION } from './types';

const BIN = env.YTDLP_PATH || 'yt-dlp';

/**
 * A desktop browser UA. Several sites (Instagram among them) serve a stripped
 * "install the app" page to yt-dlp's default UA and no media at all.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Cookie flags, when the operator configured a session for the server to use.
 * Empty by default — the tool authenticates as nobody unless told otherwise.
 */
function authArgs(): string[] {
  if (env.YTDLP_COOKIES_FILE) return ['--cookies', env.YTDLP_COOKIES_FILE];
  if (env.YTDLP_COOKIES_FROM_BROWSER) {
    return ['--cookies-from-browser', env.YTDLP_COOKIES_FROM_BROWSER];
  }
  return [];
}

/** True when this install can present a session to sites that demand one. */
export function hasCookies(): boolean {
  return Boolean(env.YTDLP_COOKIES_FILE || env.YTDLP_COOKIES_FROM_BROWSER);
}

/** yt-dlp's `--dump-single-json` output, narrowed to the fields we consume. */
interface YtDlpFormat {
  format_id?: string;
  format_note?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  abr?: number;
  tbr?: number;
  filesize?: number;
  filesize_approx?: number;
  protocol?: string;
  url?: string;
}

interface YtDlpInfo {
  id?: string;
  title?: string;
  extractor?: string;
  extractor_key?: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
  is_live?: boolean;
  formats?: YtDlpFormat[];
  _type?: string;
  entries?: YtDlpInfo[];
}

export interface YtDlpProbe {
  ok: boolean;
  title?: string;
  durationSeconds?: number;
  posterUrl?: string;
  candidates: MediaCandidate[];
  restriction: Restriction;
  /** Populated when `ok` is false and no restriction was recognised. */
  errorMessage?: string;
}

export interface YtDlpDownloadOptions {
  url: string;
  /** yt-dlp format selector; defaults to best muxed video+audio. */
  formatId?: string;
  audioOnly: boolean;
  /**
   * Whether `formatId` names a *video* rendition that may need an audio track
   * merged in. False for audio format ids — pairing one with `+bestaudio` would
   * ask yt-dlp to mux audio onto audio and fail.
   */
  mergeAudio?: boolean;
  /** Absolute output path template, without extension. */
  outputTemplate: string;
  proxy: ProxyConfig | null;
  maxBytes: number;
  onProgress?: (percent: number, downloadedBytes: number, totalBytes: number) => void;
}

export interface YtDlpDownloadResult {
  ok: boolean;
  restriction: Restriction;
  errorMessage?: string;
  /** Absolute path yt-dlp actually wrote (extension resolved at runtime). */
  filePath?: string;
  sizeBytes?: number;
}

let availabilityCache: { checked: boolean; available: boolean; version?: string } = {
  checked: false,
  available: false,
};

/** Runs a yt-dlp subprocess and collects its output. Never uses a shell. */
function run(
  args: string[],
  opts: { timeoutMs: number; onStdoutLine?: (line: string) => void }
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(BIN, args, { windowsHide: true });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err), timedOut: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (opts.onStdoutLine) {
        stdoutBuffer += text;
        const lines = stdoutBuffer.split(/\r?\n|\r/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) opts.onStdoutLine(line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts.onStdoutLine && stdoutBuffer) opts.onStdoutLine(stdoutBuffer);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.on('error', (err) => {
      stderr += `\n${err.message}`;
      settle(-1);
    });
    child.on('close', (code) => settle(code ?? -1));
  });
}

/** Whether the yt-dlp binary can be executed. Cached after the first check. */
export async function isAvailable(): Promise<{ available: boolean; version?: string }> {
  if (availabilityCache.checked) {
    return { available: availabilityCache.available, version: availabilityCache.version };
  }

  const { code, stdout } = await run(['--version'], { timeoutMs: 10_000 });
  const available = code === 0;
  const version = available ? stdout.trim() : undefined;
  availabilityCache = { checked: true, available, version };

  if (available) {
    logger.info(`yt-dlp available (version ${version})`);
  } else {
    logger.warn(
      'yt-dlp not found — site-specific extraction is disabled. Install it and/or set YTDLP_PATH.'
    );
  }
  return { available, version };
}

function describeFormat(f: YtDlpFormat): { label: string; quality?: string } {
  const hasVideo = f.vcodec && f.vcodec !== 'none';
  const hasAudio = f.acodec && f.acodec !== 'none';

  if (hasVideo) {
    const res = f.height ? `${f.height}p` : f.format_note || 'video';
    const fps = f.fps && f.fps > 30 ? `${Math.round(f.fps)}fps` : '';
    const kind = hasAudio ? '' : ' (video only)';
    return {
      label: `${res}${fps ? ` ${fps}` : ''}${kind}`,
      quality: f.width && f.height ? `${f.width}x${f.height}` : res,
    };
  }
  if (hasAudio) {
    const rate = f.abr ? `${Math.round(f.abr)}kbps` : f.format_note || 'audio';
    return { label: `Audio — ${rate}`, quality: rate };
  }
  return { label: f.format_note || f.format_id || 'stream' };
}

function toCandidates(info: YtDlpInfo, pageUrl: string): MediaCandidate[] {
  const formats = info.formats ?? [];
  const candidates: MediaCandidate[] = [];

  for (const f of formats) {
    if (!f.format_id) continue;
    const hasVideo = f.vcodec && f.vcodec !== 'none';
    const hasAudio = f.acodec && f.acodec !== 'none';
    if (!hasVideo && !hasAudio) continue; // storyboards, manifests

    const { label, quality } = describeFormat(f);
    const size = f.filesize ?? f.filesize_approx;

    candidates.push({
      id: `ytdlp:${f.format_id}`,
      kind: hasVideo ? 'video' : 'audio',
      source: 'ytdlp',
      // The page URL, not f.url — signed CDN URLs expire, so yt-dlp re-resolves
      // the format at download time using the format id.
      url: info.webpage_url ?? pageUrl,
      pageUrl,
      label,
      quality,
      container: f.ext,
      width: f.width,
      height: f.height,
      durationSeconds: info.duration,
      sizeBytes: size,
      approximateSize: f.filesize == null && f.filesize_approx != null,
      posterUrl: info.thumbnail,
      formatId: f.format_id,
      needsMuxing: !hasAudio || !hasVideo || /m3u8|dash/i.test(f.protocol ?? ''),
    });
  }

  // Best-quality first, audio after video.
  candidates.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'video' ? -1 : 1;
    return (b.height ?? b.sizeBytes ?? 0) - (a.height ?? a.sizeBytes ?? 0);
  });

  // One entry per distinct rendition. Sites commonly list the same resolution
  // several times (different codecs, different CDN hosts); the sort above has
  // already put the biggest first, so the first of each key is the one to keep.
  const seen = new Set<string>();
  const distinct = candidates.filter((c) => {
    const key = `${c.kind}|${c.label}|${c.container ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...autoCandidates(info, pageUrl, distinct), ...distinct];
}

/**
 * The two options every extractor-backed page should offer regardless of how
 * its format list looks: "just get me the best file" and "just get me the
 * audio". Both carry no format id, so yt-dlp resolves them at download time —
 * which is also the reliable path on sites whose individual formats are
 * unlabelled or expire, Instagram being the usual example.
 */
function autoCandidates(
  info: YtDlpInfo,
  pageUrl: string,
  found: MediaCandidate[]
): MediaCandidate[] {
  if (found.length === 0) return [];

  const url = info.webpage_url ?? pageUrl;
  const base = {
    source: 'ytdlp' as const,
    url,
    pageUrl,
    durationSeconds: info.duration,
    posterUrl: info.thumbnail,
    approximateSize: false,
    // Both selectors can pick separate video/audio streams that need merging.
    needsMuxing: true,
  };

  const out: MediaCandidate[] = [];
  if (found.some((c) => c.kind === 'video')) {
    out.push({
      ...base,
      id: 'ytdlp:best',
      kind: 'video',
      label: 'Best available (auto)',
      quality: 'auto',
    });
  }
  out.push({
    ...base,
    id: 'ytdlp:bestaudio',
    kind: 'audio',
    label: 'Audio only (MP3)',
    quality: 'auto',
    container: 'mp3',
  });
  return out;
}

/**
 * Asks yt-dlp what is downloadable at `url` without fetching any media.
 * Playlists are collapsed to their first entry — this feature targets a single
 * page's media, not bulk archiving.
 */
export async function probe(url: string, proxy: ProxyConfig | null): Promise<YtDlpProbe> {
  const { available } = await isAvailable();
  if (!available) {
    return {
      ok: false,
      candidates: [],
      restriction: NO_RESTRICTION,
      errorMessage: 'yt-dlp is not installed on the server.',
    };
  }

  const args = [
    '--dump-single-json',
    '--no-warnings',
    '--no-playlist',
    '--no-call-home',
    '--socket-timeout', '20',
    '--retries', '2',
    '--user-agent', BROWSER_UA,
    ...authArgs(),
  ];
  if (proxy) args.push('--proxy', proxy.url);
  args.push('--', url);

  const { code, stdout, stderr, timedOut } = await run(args, { timeoutMs: 60_000 });

  if (timedOut) {
    return {
      ok: false,
      candidates: [],
      restriction: NO_RESTRICTION,
      errorMessage: 'Timed out while inspecting this URL (60s).',
    };
  }

  if (code !== 0) {
    const restriction = detectFromText(stderr);
    logger.debug(`yt-dlp probe failed (${code}): ${stderr.slice(0, 400)}`);
    return {
      ok: false,
      candidates: [],
      restriction,
      errorMessage:
        restriction.kind === 'none'
          ? firstMeaningfulLine(stderr) ?? 'yt-dlp could not extract media from this URL.'
          : undefined,
    };
  }

  let info: YtDlpInfo;
  try {
    info = JSON.parse(stdout) as YtDlpInfo;
  } catch {
    return {
      ok: false,
      candidates: [],
      restriction: NO_RESTRICTION,
      errorMessage: 'yt-dlp returned output this server could not parse.',
    };
  }

  // A playlist slipped through despite --no-playlist; take the first entry.
  if (info._type === 'playlist' && info.entries?.length) {
    info = info.entries[0];
  }

  if (info.is_live) {
    return {
      ok: false,
      candidates: [],
      restriction: {
        kind: 'unavailable',
        message: 'This is a live stream. Live content is not supported.',
        proxyMayHelp: false,
      },
    };
  }

  return {
    ok: true,
    title: info.title,
    durationSeconds: info.duration,
    posterUrl: info.thumbnail,
    candidates: toCandidates(info, url),
    restriction: NO_RESTRICTION,
  };
}

/** `[download]  42.7% of ~12.34MiB at ...` → percent. */
const PROGRESS_RE = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(\w+)/i;
const DESTINATION_RE = /\[(?:download|Merger|ExtractAudio)\]\s+(?:Destination:|Merging formats into "|Destination: )(.+?)"?\s*$/i;

const UNIT_BYTES: Record<string, number> = {
  b: 1,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  kb: 1000,
  mb: 1000 ** 2,
  gb: 1000 ** 3,
};

export async function download(opts: YtDlpDownloadOptions): Promise<YtDlpDownloadResult> {
  const { available } = await isAvailable();
  if (!available) {
    return {
      ok: false,
      restriction: NO_RESTRICTION,
      errorMessage: 'yt-dlp is not installed on the server.',
    };
  }

  const format = opts.audioOnly
    ? 'bestaudio/best'
    : opts.formatId
      ? opts.mergeAudio
        // Pair a video-only rendition with the best audio; yt-dlp falls back to
        // the bare format if muxing is not possible.
        ? `${opts.formatId}+bestaudio/${opts.formatId}`
        : opts.formatId
      : 'bestvideo*+bestaudio/best';

  const args = [
    '-f', format,
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '--no-call-home',
    '--socket-timeout', '30',
    '--retries', '3',
    // Refuse oversized media before writing anything to disk.
    '--max-filesize', String(opts.maxBytes),
    '--user-agent', BROWSER_UA,
    ...authArgs(),
    '-o', `${opts.outputTemplate}.%(ext)s`,
  ];
  if (opts.audioOnly) args.push('-x', '--audio-format', 'mp3');
  if (opts.proxy) args.push('--proxy', opts.proxy.url);
  args.push('--', opts.url);

  let filePath: string | undefined;

  const { code, stderr, timedOut } = await run(args, {
    timeoutMs: 30 * 60_000,
    onStdoutLine: (line) => {
      const dest = DESTINATION_RE.exec(line);
      if (dest) filePath = dest[1].trim();

      const m = PROGRESS_RE.exec(line);
      if (m && opts.onProgress) {
        const percent = parseFloat(m[1]);
        const total = parseFloat(m[2]) * (UNIT_BYTES[m[3].toLowerCase()] ?? 1);
        opts.onProgress(percent, Math.round((percent / 100) * total), Math.round(total));
      }
    },
  });

  if (timedOut) {
    return { ok: false, restriction: NO_RESTRICTION, errorMessage: 'Download timed out (30 min).' };
  }

  if (code !== 0) {
    const restriction = detectFromText(stderr);
    return {
      ok: false,
      restriction,
      errorMessage:
        restriction.kind === 'none'
          ? firstMeaningfulLine(stderr) ?? 'yt-dlp failed to download this media.'
          : undefined,
    };
  }

  return { ok: true, restriction: NO_RESTRICTION, filePath };
}

/** Pulls the most useful line out of yt-dlp's stderr for display. */
function firstMeaningfulLine(stderr: string): string | undefined {
  const line = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => /^error/i.test(l));
  return line?.replace(/^ERROR:\s*/i, '').slice(0, 300);
}
