import { useParams, Link } from 'react-router-dom';
import { ExternalLink, Globe } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageLoader, ErrorState, EmptyState } from '@/components/ui/Misc';
import { CacheView } from '@/components/crawl/CacheView';
import { useGetPublicResultQuery } from '@/features/crawl/crawlApi';

/**
 * Unauthenticated share page for a publicly-visible result. The backend
 * returns 404 for missing OR private results (and strips userId), so a
 * failed query is presented as an ordinary "not available" state.
 */
export default function PublicResult() {
  const { resultId } = useParams<{ resultId: string }>();
  const { data, isLoading, isError } = useGetPublicResultQuery(resultId!, {
    skip: !resultId,
  });

  const result = data?.data.result;

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-10 sm:px-6">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400"
      >
        <Globe className="h-4 w-4" /> WebCrawler
      </Link>

      {isLoading ? (
        <PageLoader label="Loading shared result…" />
      ) : isError || !result ? (
        <EmptyState
          title="This result isn't available"
          description="The shared page may have been made private or no longer exists."
        />
      ) : (
        <Card>
          <CardBody className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">
                <Globe className="h-3 w-3" /> Public
              </Badge>
              <Badge tone="indigo">Score {result.relevanceScore}</Badge>
            </div>

            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                {result.title || 'Untitled page'}
              </h1>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-flex items-center gap-1 truncate text-sm text-brand-600 hover:underline dark:text-brand-400"
              >
                <span className="truncate">{result.url}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </div>

            {result.cache ? (
              <CacheView cache={result.cache} />
            ) : (
              <ErrorState message="No cached snapshot is available for this result." />
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
