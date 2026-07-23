import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { CrawlForm } from '@/components/crawl/CrawlForm';
import { useSubmitCrawlMutation, type SubmitCrawlRequest } from '@/features/crawl/crawlApi';
import { getApiErrorMessage } from '@/lib/apiError';

export default function CrawlSubmit() {
  const [submitCrawl, { isLoading, error }] = useSubmitCrawlMutation();
  const navigate = useNavigate();

  const handleSubmit = async (payload: SubmitCrawlRequest) => {
    try {
      const res = await submitCrawl(payload).unwrap();
      navigate(`/jobs/${res.data.job._id}`);
    } catch {
      /* surfaced via `error` */
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <Card>
        <CardHeader
          title="New crawl"
          description="Configure a target and the keywords you want to track."
        />
        <CardBody>
          <CrawlForm
            onSubmit={handleSubmit}
            loading={isLoading}
            error={error ? getApiErrorMessage(error) : undefined}
          />
        </CardBody>
      </Card>
    </div>
  );
}
