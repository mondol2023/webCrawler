import { Download, Trash2, Film, Music, Image as ImageIcon, Globe2, Inbox } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ProgressBar, EmptyState } from '@/components/ui/Misc';
import { Reveal } from '@/components/ui/Reveal';
import { mediaFileUrl } from '@/features/media/mediaApi';
import { cn, formatBytes, formatRelative, truncate } from '@/lib/utils';
import type { MediaDownload, MediaDownloadStatus, MediaKind } from '@/lib/types';

const KIND_ICON: Record<MediaKind, typeof Film> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
};

const STATUS_TONE: Record<MediaDownloadStatus, 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'indigo'> = {
  pending: 'gray',
  queued: 'amber',
  downloading: 'blue',
  completed: 'green',
  failed: 'red',
  blocked: 'amber',
  cancelled: 'gray',
};

const ACTIVE: MediaDownloadStatus[] = ['pending', 'queued', 'downloading'];

interface Props {
  downloads: MediaDownload[];
  /** Live socket state, keyed by id — overrides the fetched record when present. */
  live: Record<string, MediaDownload>;
  onDelete: (id: string) => void;
  deletingId?: string;
}

export function DownloadQueue({ downloads, live, onDelete, deletingId }: Props) {
  if (downloads.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-8 w-8" />}
        title="No downloads yet"
        description="Scan a page above and pick what you want to keep."
      />
    );
  }

  return (
    <div className="space-y-3">
      {downloads.map((record, i) => {
        const item = live[record._id] ?? record;
        return (
          <Reveal key={item._id} index={i} step={50} direction="left">
            <DownloadRow
              item={item}
              onDelete={() => onDelete(item._id)}
              deleting={deletingId === item._id}
            />
          </Reveal>
        );
      })}
    </div>
  );
}

function DownloadRow({
  item,
  onDelete,
  deleting,
}: {
  item: MediaDownload;
  onDelete: () => void;
  deleting: boolean;
}) {
  const Icon = KIND_ICON[item.kind];
  const active = ACTIVE.includes(item.status);
  const done = item.status === 'completed';

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm dark:border-slate-800 dark:bg-slate-900',
        item.status === 'downloading' && 'shimmer-track'
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          done
            ? 'bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-400'
            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
        )}
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={item.label}>
            {truncate(item.label, 70)}
          </p>
          <Badge tone={STATUS_TONE[item.status]} className="capitalize">
            {item.status === 'downloading' && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            )}
            {item.status}
          </Badge>
          {item.quality && <Badge tone="gray">{item.quality}</Badge>}
          {item.usedProxy && (
            <Badge tone="indigo" title={item.proxyLabel}>
              <Globe2 className="h-3 w-3" />
              proxy
            </Badge>
          )}
        </div>

        {active && (
          <div className="mt-2 space-y-1">
            <ProgressBar value={item.progress} />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {item.totalBytes > 0
                ? `${formatBytes(item.downloadedBytes)} of ${formatBytes(item.totalBytes)}`
                : formatBytes(item.downloadedBytes)}
              {' · '}
              {Math.round(item.progress)}%
            </p>
          </div>
        )}

        {!active && (
          <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
            {done && item.sizeBytes ? `${formatBytes(item.sizeBytes)} · ` : ''}
            {item.restrictionMessage || item.errorMessage || formatRelative(item.createdAt)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {done && (
          <a
            href={mediaFileUrl(item._id)}
            download
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            <Download className="h-4 w-4" />
            Save
          </a>
        )}
        <Button
          variant="ghost"
          size="sm"
          loading={deleting}
          onClick={onDelete}
          aria-label="Remove download"
          className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
        >
          {!deleting && <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
