import mongoose, { Document, Model, Schema } from 'mongoose';

/** A playable media reference. Videos are never downloaded — we keep the link
 *  and let the UI render a player (native <video> for files, <iframe> for embeds). */
export interface IVideoItem {
  url: string;
  type: 'file' | 'embed'; // 'file' → direct .mp4/.webm; 'embed' → YouTube/Vimeo/etc.
  poster?: string;
}

export interface IExtractedData {
  headings: string[];
  paragraphs: string[];
  links: string[];
  images: string[];
  videos: IVideoItem[];
  metaTitle?: string;
  metaDescription?: string;
  structuredData: Record<string, unknown>[];  // JSON-LD, OpenGraph, etc.
}

/** A size-bounded, self-contained snapshot of the most relevant page, served
 *  back from our own database so users can read it without re-visiting the site.
 *  Text and image/video links are cached; the total is capped (see CACHE_LIMIT_BYTES). */
export interface ICachedContent {
  text: string;
  images: string[];
  videos: IVideoItem[];
  sizeBytes: number;   // measured size of the cached text + link payload
  truncated: boolean;  // true when content was cut to stay under the cap
  cachedAt: Date;
}

export interface ICrawlResult extends Document {
  _id: mongoose.Types.ObjectId;
  jobId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  url: string;
  title: string;
  statusCode: number;
  contentLength: number;
  crawledAt: Date;
  relevanceScore: number;       // 0–100, how well it matches keywords
  matchedKeywords: string[];
  matchedPhrases: string[];
  extracted: IExtractedData;
  rawTextSnippet: string;       // first 500 chars for preview
  depth: number;                // how deep in the site hierarchy
  isPrimary: boolean;           // the single most-weighted result of the job
  isPublic: boolean;            // when true, viewable via the public share link
  cache?: ICachedContent;       // populated for the primary result only
  createdAt: Date;
}

const crawlResultSchema = new Schema<ICrawlResult>(
  {
    jobId: {
      type: Schema.Types.ObjectId,
      ref: 'CrawlJob',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    url: { type: String, required: true },
    title: { type: String, default: '' },
    statusCode: { type: Number, default: 200 },
    contentLength: { type: Number, default: 0 },
    crawledAt: { type: Date, default: Date.now },
    relevanceScore: { type: Number, default: 0, min: 0, max: 100 },
    matchedKeywords: { type: [String], default: [] },
    matchedPhrases: { type: [String], default: [] },
    extracted: {
      headings: { type: [String], default: [] },
      paragraphs: { type: [String], default: [] },
      links: { type: [String], default: [] },
      images: { type: [String], default: [] },
      videos: {
        type: [
          {
            _id: false,
            url: { type: String, required: true },
            type: { type: String, enum: ['file', 'embed'], required: true },
            poster: { type: String },
          },
        ],
        default: [],
      },
      metaTitle: { type: String },
      metaDescription: { type: String },
      structuredData: { type: [Schema.Types.Mixed], default: [] },
    },
    rawTextSnippet: { type: String, default: '' },
    depth: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: false, index: true },
    isPublic: { type: Boolean, default: false, index: true },
    cache: {
      type: {
        _id: false,
        text: { type: String, default: '' },
        images: { type: [String], default: [] },
        videos: {
          type: [
            {
              _id: false,
              url: { type: String, required: true },
              type: { type: String, enum: ['file', 'embed'], required: true },
              poster: { type: String },
            },
          ],
          default: [],
        },
        sizeBytes: { type: Number, default: 0 },
        truncated: { type: Boolean, default: false },
        cachedAt: { type: Date, default: Date.now },
      },
      default: undefined,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

crawlResultSchema.index({ jobId: 1, relevanceScore: -1 });
crawlResultSchema.index({ jobId: 1, url: 1 }, { unique: true });

export const CrawlResult: Model<ICrawlResult> = mongoose.model<ICrawlResult>(
  'CrawlResult',
  crawlResultSchema
);