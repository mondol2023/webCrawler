import { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Ban, Globe, Layers, FileStack, Bot } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { ProgressBar, PageLoader, ErrorState } from '@/components/ui/Misc';
import { ResultsTable } from '@/components/crawl/ResultsTable';
import { FeaturedResult } from '@/components/crawl/FeaturedResult';
import {
  useGetJobQuery,
  useGetJobResultsQuery,
  useCancelJobMutation,
} from '@/features/crawl/crawlApi';
import { useJobSocket } from '@/hooks/useSocket';
import { useAppSelector } from '@/app/hooks';
import { getApiErrorMessage } from '@/lib/apiError';
import { formatDateTime } from '@/lib/utils';
import type { CrawlJobStatus } from '@/lib/types';

const ACTIVE: CrawlJobStatus[] = ['pending', 'queued', 'running'];

export default function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [minScore, setMinScore] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();

  const jobQuery = useGetJobQuery(jobId!, {
    skip: !jobId,
    pollingInterval: 8000,
  });
  const resultsQuery = useGetJobResultsQuery(
    { jobId: jobId!, page, minScore },
    { skip: !jobId }
  );
  const [cancelJob, { isLoading: cancelling }] = useCancelJobMutation();

  const live = useAppSelector((s) => (jobId ? s.crawl.live[jobId] : undefined));

  // When the socket reports the job settled, pull fresh job + results.
  const onSettled = useCallback(() => {
    jobQuery.refetch();
    resultsQuery.refetch();
  }, [jobQuery, resultsQuery]);
  useJobSocket(jobId, onSettled);

  if (jobQuery.isLoading) return <PageLoader label="Loading job…" />;
  if (jobQuery.isError || !jobQuery.data) {
    return <ErrorState message={getApiErrorMessage(jobQuery.error)} />;
  }

  const job = jobQuery.data.data.job;
  const status = live?.status ?? job.status;
  const progress = live?.progress ?? job.progress;
  const pagesCrawled = live?.pagesCrawled ?? job.pagesCrawled;
  const pagesMatched = live?.pagesMatched ?? job.pagesMatched;
  const pagesDiscovered = live?.pagesDiscovered ?? job.pagesDiscovered;
  const isActive = ACTIVE.includes(status);
  const canCancel = status === 'pending' || status === 'queued';

  const results = resultsQuery.data?.data.results ?? [];
  const resultsPagination = resultsQuery.data?.data.pagination;
  // Default selection is the most-weighted result (results come primary-first).
  const selected = results.find((r) => r._id === selectedId) ?? results[0];

  const stats = [
    { label: 'Discovered', value: pagesDiscovered, icon: Globe },
    { label: 'Crawled', value: pagesCrawled, icon: FileStack },
    { label: 'Matched', value: pagesMatched, icon: Layers },
    { label: 'Max depth', value: job.maxDepth, icon: Bot },
  ];

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </button>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Globe className="h-4 w-4 shrink-0 text-slate-400" />
              <a href={job.url} target="_blank" rel="noreferrer noopener" className="truncate hover:underline">
                {job.url}
              </a>
            </span>
          }
          description={`Created ${formatDateTime(job.createdAt)}`}
          action={
            <div className="flex items-center gap-3">
              <StatusBadge status={status} />
              {canCancel && (
                <Button
                  variant="danger"
                  size="sm"
                  loading={cancelling}
                  onClick={() => cancelJob(job._id)}
                >
                  <Ban className="h-4 w-4" /> Cancel
                </Button>
              )}
            </div>
          }
        />
        <CardBody className="space-y-5">
          {isActive && (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-300">Progress</span>
                <span className="text-slate-500">{progress}%</span>
              </div>
              <ProgressBar value={progress} />
            </div>
          )}

          {status === 'failed' && job.errorMessage && (
            <ErrorState message={job.errorMessage} />
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Icon className="h-3.5 w-3.5" /> {label}
                </div>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{value}</p>
              </div>
            ))}
          </div>

          {(job.keywords.length > 0 || job.phrases.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {[...job.keywords, ...job.phrases].map((term) => (
                <span
                  key={term}
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  {term}
                </span>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Results {resultsPagination ? `(${resultsPagination.total})` : ''}
          </h2>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            Min score
            <select
              value={minScore}
              onChange={(e) => {
                setMinScore(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              {[0, 25, 50, 75].map((v) => (
                <option key={v} value={v}>
                  {v}+
                </option>
              ))}
            </select>
          </label>
        </div>

        {resultsQuery.isLoading ? (
          <PageLoader label="Loading results…" />
        ) : (
          <div className="space-y-5">
            {selected && (
              <FeaturedResult key={selected._id} jobId={job._id} result={selected} />
            )}
            <ResultsTable
              results={results}
              selectedId={selected?._id}
              onSelect={(r) => setSelectedId(r._id)}
            />
          </div>
        )}

        {resultsPagination && resultsPagination.pages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <span className="text-sm text-slate-500">
              Page {resultsPagination.page} of {resultsPagination.pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= resultsPagination.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
