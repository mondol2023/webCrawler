import { Check, Film, Music, Image as ImageIcon, Layers, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { cn, formatBytes, truncate } from '@/lib/utils';
import type { MediaCandidate, MediaKind } from '@/lib/types';

const KIND_ICON: Record<MediaKind, typeof Film> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
};

const SOURCE_LABEL: Record<MediaCandidate['source'], string> = {
  ytdlp: 'Extractor',
  dom: 'Page markup',
  network: 'Network',
  meta: 'Metadata',
};

/** `95` → `1:35`, `3725` → `1:02:05`. */
function formatDuration(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface Props {
  candidate: MediaCandidate;
  selected: boolean;
  onToggle: () => void;
  audioOnly: boolean;
  onToggleAudioOnly: () => void;
}

export function MediaCandidateCard({
  candidate,
  selected,
  onToggle,
  audioOnly,
  onToggleAudioOnly,
}: Props) {
  const Icon = KIND_ICON[candidate.kind];
  const duration = formatDuration(candidate.durationSeconds);
  const blocked = Boolean(candidate.restriction && candidate.restriction.kind !== 'none');
  // Only the extractor can demux an audio track out of a video stream; a raw
  // file grabbed from the page markup would need a transcode we do not run.
  const canExtractAudio = candidate.kind === 'video' && candidate.source === 'ytdlp';
  const thumb = candidate.posterUrl ?? (candidate.kind === 'image' ? candidate.url : undefined);

  return (
    <div
      role="checkbox"
      aria-checked={selected}
      tabIndex={blocked ? -1 : 0}
      onClick={blocked ? undefined : onToggle}
      onKeyDown={(e) => {
        if (blocked) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-white text-left transition-all duration-300 dark:bg-slate-900',
        'hover:-translate-y-0.5 hover:shadow-lg',
        selected
          ? 'border-brand-500 ring-2 ring-brand-500/25'
          : 'border-slate-200 dark:border-slate-800',
        blocked && 'cursor-not-allowed opacity-60 hover:translate-y-0 hover:shadow-none'
      )}
    >
      <div className="relative flex h-32 items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-800">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={(e) => {
              // Hot-linking is often blocked; fall back to the icon behind it.
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <Icon className="h-10 w-10 text-slate-300 dark:text-slate-600" />
        )}

        <span
          className={cn(
            'absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border-2 transition-all duration-200',
            selected
              ? 'scale-100 border-brand-600 bg-brand-600 text-white'
              : 'border-white/80 bg-black/25 text-transparent backdrop-blur'
          )}
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>

        {blocked && (
          <span className="absolute inset-0 flex items-center justify-center bg-slate-900/60">
            <Lock className="h-6 w-6 text-white" />
          </span>
        )}

        {duration && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {duration}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p
          className="text-sm font-medium leading-snug text-slate-900 dark:text-slate-100"
          title={candidate.label}
        >
          {truncate(candidate.label, 60)}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={candidate.kind === 'video' ? 'indigo' : candidate.kind === 'audio' ? 'blue' : 'gray'}>
            <Icon className="h-3 w-3" />
            {candidate.kind}
          </Badge>
          {candidate.quality && <Badge tone="gray">{candidate.quality}</Badge>}
          {candidate.needsMuxing && (
            <Badge tone="amber" title="Video and audio are separate streams and will be merged">
              <Layers className="h-3 w-3" />
              muxed
            </Badge>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{SOURCE_LABEL[candidate.source]}</span>
          {candidate.sizeBytes ? (
            <span>
              {candidate.approximateSize && '≈ '}
              {formatBytes(candidate.sizeBytes)}
            </span>
          ) : null}
        </div>

        {canExtractAudio && !blocked && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleAudioOnly();
            }}
            aria-pressed={audioOnly}
            className={cn(
              'inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              audioOnly
                ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300'
                : 'border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
            )}
          >
            <Music className="h-3 w-3" />
            Audio only
          </button>
        )}

        {blocked && candidate.restriction && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{candidate.restriction.message}</p>
        )}
      </div>
    </div>
  );
}
