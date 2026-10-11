import { ExternalLink } from 'lucide-react';
import type { VideoItem } from '@/lib/types';

/**
 * Plays a discovered video "through the link" — nothing is downloaded.
 *  - 'file'  → native <video> pointed at the direct media URL.
 *  - 'embed' → sandboxed <iframe> for YouTube/Vimeo/etc. players.
 */
export function VideoPlayer({ video }: { video: VideoItem }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="aspect-video w-full bg-black">
        {video.type === 'file' ? (
          <video
            src={video.url}
            poster={video.poster}
            controls
            preload="metadata"
            className="h-full w-full"
          />
        ) : (
          <iframe
            src={video.url}
            title="Embedded video"
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-full w-full border-0"
          />
        )}
      </div>
      <a
        href={video.url}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-1 truncate px-3 py-2 text-xs text-slate-500 hover:text-brand-600 dark:hover:text-brand-400"
      >
        <ExternalLink className="h-3 w-3 shrink-0" />
        <span className="truncate">{video.url}</span>
      </a>
    </div>
  );
}
