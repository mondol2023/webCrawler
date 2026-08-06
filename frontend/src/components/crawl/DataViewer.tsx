import { Modal } from '@/components/ui/Modal';
import { PageLoader, ErrorState } from '@/components/ui/Misc';
import { CacheView } from '@/components/crawl/CacheView';
import { useGetResultDetailQuery } from '@/features/crawl/crawlApi';
import { getApiErrorMessage } from '@/lib/apiError';

/**
 * Owner-facing modal that loads a result's full cached snapshot on demand
 * (the list endpoint omits `cache` to stay lean) and renders it.
 */
export function DataViewer({
  jobId,
  resultId,
  title,
  open,
  onClose,
}: {
  jobId: string;
  resultId: string;
  title?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useGetResultDetailQuery(
    { jobId, resultId },
    { skip: !open }
  );

  const result = data?.data.result;

  return (
    <Modal open={open} onClose={onClose} title={title || 'Cached data'} description={result?.url}>
      {isLoading ? (
        <PageLoader label="Loading cached data…" />
      ) : isError ? (
        <ErrorState message={getApiErrorMessage(error)} />
      ) : result?.cache ? (
        <CacheView cache={result.cache} />
      ) : (
        <p className="text-sm text-slate-500">
          No cached snapshot is available for this result.
        </p>
      )}
    </Modal>
  );
}
