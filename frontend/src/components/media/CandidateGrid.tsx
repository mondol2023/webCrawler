import { useMemo, useState } from 'react';
import { Download, Film, Music, Image as ImageIcon, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Misc';
import { Reveal } from '@/components/ui/Reveal';
import { MediaCandidateCard } from './MediaCandidateCard';
import { cn, formatBytes } from '@/lib/utils';
import type { MediaCandidate, MediaKind } from '@/lib/types';

type Filter = 'all' | MediaKind;

const FILTERS: { value: Filter; label: string; icon: typeof LayoutGrid }[] = [
  { value: 'all', label: 'All', icon: LayoutGrid },
  { value: 'video', label: 'Video', icon: Film },
  { value: 'audio', label: 'Audio', icon: Music },
  { value: 'image', label: 'Images', icon: ImageIcon },
];

interface Props {
  candidates: MediaCandidate[];
  selected: Set<string>;
  audioOnly: Set<string>;
  onToggle: (id: string) => void;
  onToggleAudioOnly: (id: string) => void;
  onReplaceSelection: (ids: string[]) => void;
  onDownload: () => void;
  downloading: boolean;
}

/**
 * Everything found on the page, filterable by kind and multi-selectable.
 *
 * Selection lives in the parent so it survives filtering — hiding a card must
 * never silently drop it from the download batch.
 */
export function CandidateGrid({
  candidates,
  selected,
  audioOnly,
  onToggle,
  onToggleAudioOnly,
  onReplaceSelection,
  onDownload,
  downloading,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    const base: Record<Filter, number> = { all: candidates.length, video: 0, audio: 0, image: 0 };
    for (const c of candidates) base[c.kind] += 1;
    return base;
  }, [candidates]);

  const visible = useMemo(
    () => (filter === 'all' ? candidates : candidates.filter((c) => c.kind === filter)),
    [candidates, filter]
  );

  const selectable = useMemo(
    () => visible.filter((c) => !c.restriction || c.restriction.kind === 'none'),
    [visible]
  );

  const allVisibleSelected =
    selectable.length > 0 && selectable.every((c) => selected.has(c.id));

  const selectedSize = useMemo(
    () =>
      candidates
        .filter((c) => selected.has(c.id))
        .reduce((sum, c) => sum + (c.sizeBytes ?? 0), 0),
    [candidates, selected]
  );

  const toggleAllVisible = () => {
    const ids = selectable.map((c) => c.id);
    if (allVisibleSelected) {
      onReplaceSelection([...selected].filter((id) => !ids.includes(id)));
    } else {
      onReplaceSelection([...new Set([...selected, ...ids])]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              disabled={counts[value] === 0}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 disabled:opacity-40',
                filter === value
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className="opacity-70">{counts[value]}</span>
            </button>
          ))}
        </div>

        {selectable.length > 0 && (
          <button
            onClick={toggleAllVisible}
            className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {allVisibleSelected ? 'Clear selection' : `Select all ${filter === 'all' ? '' : filter}`.trim()}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-8 w-8" />}
          title="Nothing of this kind on the page"
          description="Try another filter, or scan a different URL."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((candidate, i) => (
            <Reveal key={candidate.id} index={i} step={45} direction="scale">
              <MediaCandidateCard
                candidate={candidate}
                selected={selected.has(candidate.id)}
                onToggle={() => onToggle(candidate.id)}
                audioOnly={audioOnly.has(candidate.id)}
                onToggleAudioOnly={() => onToggleAudioOnly(candidate.id)}
              />
            </Reveal>
          ))}
        </div>
      )}

      {/* Action bar — sticks to the bottom while the user works through the grid. */}
      {selected.size > 0 && (
        <div className="animate-pop-in sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{selected.size}</span>{' '}
            selected
            {selectedSize > 0 && (
              <span className="text-slate-400"> · ≈ {formatBytes(selectedSize)}</span>
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onReplaceSelection([])}>
              Clear
            </Button>
            <Button size="sm" loading={downloading} onClick={onDownload}>
              {!downloading && <Download className="h-4 w-4" />}
              Download {selected.size}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
