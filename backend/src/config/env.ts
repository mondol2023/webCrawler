import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('8080'),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  BCRYPT_ROUNDS: z.string().default('12'),

  // ─── Media downloader ─────────────────────────────────────────────────────
  /**
   * Default proxy for media probes/downloads, e.g. `socks5://user:pass@host:1080`.
   * Optional — a request can supply its own instead. Only ever used to change
   * where a request originates from (the geo-restriction case).
   */
  MEDIA_PROXY_URL: z.string().optional(),
  /** Path to the yt-dlp binary. Falls back to `yt-dlp` on PATH. */
  YTDLP_PATH: z.string().optional(),
  /**
   * Netscape-format cookies.txt passed to yt-dlp (`--cookies`).
   *
   * Sites like Instagram refuse anonymous clients outright, so without a session
   * even a public reel comes back as "login required". This lets the operator
   * lend the server their *own* signed-in session; it does not reach anything
   * that account cannot already see.
   */
  YTDLP_COOKIES_FILE: z.string().optional(),
  /** Alternative to the above — a local browser profile, e.g. `chrome` or `firefox:default`. */
  YTDLP_COOKIES_FROM_BROWSER: z.string().optional(),
  /** Where downloaded files are written. */
  MEDIA_DOWNLOAD_DIR: z.string().default('./downloads'),
  /** Per-download size cap in bytes (default 2 GB). */
  MEDIA_MAX_BYTES: z.string().default('2147483648'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;