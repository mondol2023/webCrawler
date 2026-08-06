import { Award, ExternalLink, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Misc';
import { cn, truncate } from '@/lib/utils';
import type { CrawlResult } from '@/lib/types';

function scoreTone(score: number): 'green' | 'amber' | 'gray' {
  if (score >= 60) return 'green';
  if (score >= 25) return 'amber';
  return 'gray';
}

export function ResultsTable({
  results,
  selectedId,
  onSelect,
}: {
  results: CrawlResult[];
  selectedId?: string;
  onSelect?: (result: CrawlResult) => void;
}) {
  if (results.length === 0) {
    return <EmptyState title="No results yet" description="Matched pages will appear here as the crawl runs." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
            <th className="px-4 py-3 font-semibold">Page</th>
            <th className="px-4 py-3 font-semibold">Score</th>
            <th className="px-4 py-3 font-semibold">Matches</th>
            <th className="px-4 py-3 font-semibold">Depth</th>
            <th className="px-4 py-3 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const selected = r._id === selectedId;
            return (
              <tr
                key={r._id}
                onClick={() => onSelect?.(r)}
                className={cn(
                  'border-b border-slate-100 last:border-0 dark:border-slate-800',
                  onSelect && 'cursor-pointer',
                  selected
                    ? 'bg-brand-50 dark:bg-brand-500/10'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
                )}
              >
                <td className="max-w-sm px-4 py-3">
                  <p className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100">
                    {r.isPrimary && (
                      <Award className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-label="Most weighted" />
                    )}
                    {truncate(r.title || 'Untitled', 60)}
                  </p>
                  <p className="truncate text-xs text-slate-500">{r.url}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={scoreTone(r.relevanceScore)}>{r.relevanceScore}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {[...r.matchedKeywords, ...r.matchedPhrases].slice(0, 3).map((m) => (
                      <span
                        key={m}
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      >
                        {m}
                      </span>
                    ))}
                    {r.matchedKeywords.length + r.matchedPhrases.length === 0 && (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">{r.depth}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {r.isPublic && (
                      <span className="text-green-600 dark:text-green-400" aria-label="Public">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {!r.isPublic && (
                      <span className="text-slate-300 dark:text-slate-600" aria-label="Private">
                        <Lock className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Open <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
