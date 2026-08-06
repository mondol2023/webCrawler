import { AlertTriangle, FileText, ImageIcon, Video } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { VideoPlayer } from '@/components/crawl/VideoPlayer';
import { formatBytes } from '@/lib/utils';
import type { CachedContent } from '@/lib/types';

function SectionTitle({ icon: Icon, label, count }: { icon: typeof FileText; label: string; count?: number }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
      <Icon className="h-4 w-4 text-slate-400" />
      {label}
      {count !== undefined && <span className="text-xs font-normal text-slate-400">({count})</span>}
    </div>
  );
}

/**
 * Renders the cached snapshot of the most-weighted page: readable text,
 * images, and in-site video players. Used in both the owner modal and the
 * public share page.
 */
export function CacheView({ cache }: { cache: CachedContent }) {
  const hasText = cache.text.trim().length > 0;
  const hasImages = cache.images.length > 0;
  const hasVideos = cache.videos.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge tone="indigo">{formatBytes(cache.sizeBytes)} cached</Badge>
        {cache.truncated && (
          <Badge tone="amber">
            <AlertTriangle className="h-3 w-3" /> Truncated at 5 MB limit
          </Badge>
        )}
      </div>

      {!hasText && !hasImages && !hasVideos && (
        <p className="text-sm text-slate-500">No cached content was captured for this page.</p>
      )}

      {hasText && (
        <section>
          <SectionTitle icon={FileText} label="Text" />
          <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
            {cache.text}
          </div>
        </section>
      )}

      {hasVideos && (
        <section>
          <SectionTitle icon={Video} label="Videos" count={cache.videos.length} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {cache.videos.map((v) => (
              <VideoPlayer key={v.url} video={v} />
            ))}
          </div>
        </section>
      )}

      {hasImages && (
        <section>
          <SectionTitle icon={ImageIcon} label="Images" count={cache.images.length} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {cache.images.map((src) => (
              <a
                key={src}
                href={src}
                target="_blank"
                rel="noreferrer noopener"
                className="group overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
              >
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-full bg-slate-100 object-cover transition-transform group-hover:scale-105 dark:bg-slate-800"
                />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
