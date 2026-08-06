import { useState } from 'react';
import {
  Award,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Globe,
  Lock,
  PanelBottomOpen,
} from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataViewer } from '@/components/crawl/DataViewer';
import { useSetResultVisibilityMutation } from '@/features/crawl/crawlApi';
import type { CrawlResult } from '@/lib/types';

function scoreTone(score: number): 'green' | 'amber' | 'gray' {
  if (score >= 60) return 'green';
  if (score >= 25) return 'amber';
  return 'gray';
}

/**
 * The highlighted card for the currently-selected result (defaults to the
 * most-weighted one). Offers the "Show data" cache viewer and the
 * public/private visibility control with a copyable share link.
 */
export function FeaturedResult({
  jobId,
  result,
}: {
  jobId: string;
  result: CrawlResult;
}) {
  const [showData, setShowData] = useState(false);
  const [copied, setCopied] = useState(false);
  const [setVisibility, { isLoading: saving }] = useSetResultVisibilityMutation();

  const matches = [...result.matchedKeywords, ...result.matchedPhrases];
  const shareUrl = `${window.location.origin}/share/results/${result._id}`;

  const toggleVisibility = async () => {
    try {
      await setVisibility({
        jobId,
        resultId: result._id,
        isPublic: !result.isPublic,
      }).unwrap();
    } catch {
      /* surfaced below via the mutation error is optional; keep UI simple */
    }
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; no-op */
    }
  };

  return (
    <Card className="border-brand-200 ring-1 ring-brand-100 dark:border-brand-500/30 dark:ring-brand-500/10">
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {result.isPrimary && (
            <Badge tone="indigo">
              <Award className="h-3 w-3" /> Most weighted
            </Badge>
          )}
          <Badge tone={scoreTone(result.relevanceScore)}>Score {result.relevanceScore}</Badge>
          <Badge tone={result.isPublic ? 'green' : 'gray'}>
            {result.isPublic ? (
              <>
                <Globe className="h-3 w-3" /> Public
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" /> Private
              </>
            )}
          </Badge>
        </div>

        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {result.title || 'Untitled page'}
          </h3>
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-0.5 inline-flex items-center gap-1 truncate text-sm text-brand-600 hover:underline dark:text-brand-400"
          >
            <span className="truncate">{result.url}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
        </div>

        {matches.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {matches.slice(0, 8).map((m) => (
              <span
                key={m}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {m}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {result.isPrimary && (
            <Button size="sm" onClick={() => setShowData(true)}>
              <PanelBottomOpen className="h-4 w-4" /> Show data
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            loading={saving}
            onClick={() => void toggleVisibility()}
          >
            {result.isPublic ? <Lock className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {result.isPublic ? 'Make private' : 'Make public'}
          </Button>
          {result.isPublic && (
            <Button size="sm" variant="ghost" onClick={() => void copyShareLink()}>
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy share link'}
            </Button>
          )}
        </div>
      </CardBody>

      {result.isPrimary && (
        <DataViewer
          jobId={jobId}
          resultId={result._id}
          title={result.title || 'Cached data'}
          open={showData}
          onClose={() => setShowData(false)}
        />
      )}
    </Card>
  );
}
