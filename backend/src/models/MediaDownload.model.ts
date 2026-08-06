import mongoose, { Schema, Document, Types } from 'mongoose';
import type { MediaKind, MediaSource, RestrictionKind } from '../services/media/types';

export type MediaDownloadStatus =
  | 'pending'
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'blocked' // a restriction stopped it — see restrictionKind
  | 'cancelled';

export interface IMediaDownload extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;

  /** Page the media was discovered on. */
  pageUrl: string;
  /** Direct media URL, or the page URL when yt-dlp resolves it at download time. */
  sourceUrl: string;
  kind: MediaKind;
  source: MediaSource;
  label: string;
  quality?: string;
  /** yt-dlp format id, when the user picked a specific rendition. */
  formatId?: string;
  /** Extract audio only (yt-dlp `-x`). */
  audioOnly: boolean;

  status: MediaDownloadStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;

  /** Absolute path on disk. Absent until the download completes. */
  filePath?: string;
  /** Name offered to the browser on download. */
  fileName?: string;
  sizeBytes?: number;
  mimeType?: string;

  restrictionKind?: RestrictionKind;
  restrictionMessage?: string;
  errorMessage?: string;

  /** True when the transfer was routed through a user-supplied proxy. */
  usedProxy: boolean;
  /** Proxy host with credentials masked — never the raw URL. */
  proxyLabel?: string;

  bullJobId?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const mediaDownloadSchema = new Schema<IMediaDownload>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    pageUrl: { type: String, required: true },
    sourceUrl: { type: String, required: true },
    kind: { type: String, enum: ['video', 'audio', 'image'], required: true },
    source: { type: String, enum: ['ytdlp', 'dom', 'network', 'meta'], required: true },
    label: { type: String, required: true, maxlength: 300 },
    quality: String,
    formatId: String,
    audioOnly: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['pending', 'queued', 'downloading', 'completed', 'failed', 'blocked', 'cancelled'],
      default: 'pending',
      index: true,
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    downloadedBytes: { type: Number, default: 0 },
    totalBytes: { type: Number, default: 0 },

    filePath: String,
    fileName: String,
    sizeBytes: Number,
    mimeType: String,

    restrictionKind: String,
    restrictionMessage: String,
    errorMessage: String,

    usedProxy: { type: Boolean, default: false },
    proxyLabel: String,

    bullJobId: String,
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

// The dashboard lists a user's downloads newest-first; this covers that query.
mediaDownloadSchema.index({ userId: 1, createdAt: -1 });

/**
 * `filePath` is server-internal — leaking it would expose the host's directory
 * layout to anyone who can read their own download list.
 */
mediaDownloadSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete (ret as unknown as Record<string, unknown>).filePath;
    return ret;
  },
});

export const MediaDownload = mongoose.model<IMediaDownload>(
  'MediaDownload',
  mediaDownloadSchema
);
