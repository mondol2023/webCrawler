import { useCallback, useMemo, useState } from 'react';
import { Download, Sparkles, TerminalSquare, Clock3 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, Spinner } from '@/components/ui/Misc';
import { Reveal } from '@/components/ui/Reveal';
import { ProbeForm } from '@/components/media/ProbeForm';
import { CandidateGrid } from '@/components/media/CandidateGrid';
import { DownloadQueue } from '@/components/media/DownloadQueue';
import { RestrictionNotice } from '@/components/media/RestrictionNotice';
import {
  useDeleteMediaDownloadMutation,
  useGetMediaCapabilitiesQuery,
  useListMediaDownloadsQuery,
  useProbeMediaMutation,
  useStartMediaDownloadsMutation,
  type DownloadItem,
} from '@/features/media/mediaApi';
import { useMediaSocket } from '@/hooks/useMediaSocket';
import { getApiErrorMessage } from '@/lib/apiError';
import { formatBytes } from '@/lib/utils';
import type { ProbeOutcome } from '@/lib/types';

/**
 * Scan any page for video, audio and images, then pick what to download.
 *
 * State is deliberately local: a probe is a one-shot action rather than a
 * cached resource, and the selection only means anything alongside the
 * outcome it came from.
 */
export default function MediaDownloader() {
  const [outcome, setOutcome] = useState<ProbeOutcome | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [audioOnly, setAudioOnly] = useState<Set<string>>(new Set());
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyOpen, setProxyOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | undefined>();

  const { data: caps } = useGetMediaCapabilitiesQuery();
  const [probe, probeState] = useProbeMediaMutation();
  const [startDownloads, startState] = useStartMediaDownloadsMutation();
  const [deleteDownload] = useDeleteMediaDownloadMutation();

  const { data: listData, refetch } = useListMediaDownloadsQuery({ page: 1, limit: 20 });

  // A terminal socket event means the record on the server changed shape
  // (file name, size, error) — refetch once rather than trusting the overlay.
  const onSettled = useCallback(() => {
    refetch();
  }, [refetch]);
  const live = useMediaSocket(onSettled);

  // Memoised so the empty-list fallback isn't a fresh array on every render.
  const downloads = useMemo(() => listData?.data.downloads ?? [], [listData]);
  const capabilities = caps?.data;

  const handleProbe = async (params: {
    url: string;
    proxyUrl: string;
    respectRobotsTxt: boolean;
  }) => {
    setNotice(null);
    setProxyUrl(params.proxyUrl);
    setSelected(new Set());
    setAudioOnly(new Set());
    try {
      const res = await probe({
        url: params.url,
        proxyUrl: params.proxyUrl || undefined,
        respectRobotsTxt: params.respectRobotsTxt,
      }).unwrap();
      setOutcome(res.data);
    } catch {
      setOutcome(null);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAudioOnly = (id: string) =>
    setAudioOnly((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleDownload = async () => {
    if (!outcome) return;
    const items: DownloadItem[] = outcome.candidates
      .filter((c) => selected.has(c.id))
      .map((c) => ({
        pageUrl: c.pageUrl,
        url: c.url,
        kind: c.kind,
        source: c.source,
        label: c.label,
        quality: c.quality,
        formatId: c.formatId,
        audioOnly: audioOnly.has(c.id),
      }));
    if (items.length === 0) return;

    try {
      const res = await startDownloads({ items, proxyUrl: proxyUrl || undefined }).unwrap();
      setSelected(new Set());
      setNotice(
        res.data.skipped > 0
          ? `Queued ${res.data.downloads.length}. ${res.data.skipped} skipped — you have hit the limit of ${capabilities?.maxActiveDownloads ?? 5} active downloads.`
          : `Queued ${res.data.downloads.length} download${res.data.downloads.length === 1 ? '' : 's'}.`
      );
    } catch (err) {
      setNotice(getApiErrorMessage(err as never));
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteDownload(id).unwrap();
    } finally {
      setDeletingId(undefined);
    }
  };

  const activeCount = useMemo(
    () =>
      downloads.filter((d) => {
        const status = (live[d._id] ?? d).status;
        return status === 'pending' || status === 'queued' || status === 'downloading';
      }).length,
    [downloads, live]
  );

  return (
    <div className="space-y-8">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <Reveal as="section" className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-slate-900 px-6 py-10 text-white sm:px-10">
        <div className="animate-float-slow pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="animate-float-slow pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-brand-400/20 blur-3xl" />

        <div className="relative max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            Media downloader
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Grab video, audio and images from any page
          </h1>
          <p className="mt-2 text-sm text-white/80 sm:text-base">
            Paste a link and we will open the page, watch what it loads, and list every media file
            we can reach — then you pick what to keep.
          </p>
        </div>
      </Reveal>

      {/* ── Scan form ────────────────────────────────────────────────────── */}
      <Reveal index={1}>
        <Card>
          <CardBody className="py-5">
            <ProbeForm
              onSubmit={handleProbe}
              loading={probeState.isLoading}
              serverDefaultProxy={Boolean(capabilities?.proxyConfigured)}
              proxyOpen={proxyOpen}
              onProxyOpenChange={setProxyOpen}
            />

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <TerminalSquare className="h-3.5 w-3.5" />
                Extractor{' '}
                {capabilities?.ytdlp.available ? (
                  <span className="text-green-600 dark:text-green-400">
                    ready{capabilities.ytdlp.version ? ` (${capabilities.ytdlp.version})` : ''}
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">not installed</span>
                )}
              </span>
              {capabilities && (
                <span>Max {formatBytes(capabilities.maxDownloadBytes)} per file</span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" />
                {activeCount} active
              </span>
            </div>

            {capabilities && !capabilities.ytdlp.available && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                yt-dlp is not on the server's PATH, so sites like YouTube cannot be extracted.
                Direct files found in the page markup still work. Install yt-dlp and set{' '}
                <code className="font-mono">YTDLP_PATH</code> to enable the rest.
              </p>
            )}
          </CardBody>
        </Card>
      </Reveal>

      {probeState.isError && <ErrorState message={getApiErrorMessage(probeState.error)} />}

      {notice && (
        <div className="animate-pop-in rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
          {notice}
        </div>
      )}

      {probeState.isLoading && (
        <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-500">
          <Spinner />
          Opening the page and watching what it loads…
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {outcome && !probeState.isLoading && (
        <div className="space-y-4">
          <RestrictionNotice
            restriction={outcome.restriction}
            proxyActive={outcome.usedProxy}
            onUseProxy={() => setProxyOpen(true)}
          />

          {outcome.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
              {outcome.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          )}

          {outcome.candidates.length > 0 && (
            <Card>
              <CardHeader
                title={outcome.pageTitle || 'Media found'}
                description={`${outcome.candidates.length} item${outcome.candidates.length === 1 ? '' : 's'} · ${outcome.strategy} · ${(outcome.durationMs / 1000).toFixed(1)}s${outcome.usedProxy ? ' · via proxy' : ''}`}
              />
              <CardBody>
                <CandidateGrid
                  candidates={outcome.candidates}
                  selected={selected}
                  audioOnly={audioOnly}
                  onToggle={toggle}
                  onToggleAudioOnly={toggleAudioOnly}
                  onReplaceSelection={(ids) => setSelected(new Set(ids))}
                  onDownload={handleDownload}
                  downloading={startState.isLoading}
                />
              </CardBody>
            </Card>
          )}

          {outcome.candidates.length === 0 && outcome.restriction.kind === 'none' && (
            <ErrorState message="No downloadable media was found on that page." />
          )}
        </div>
      )}

      {/* ── Queue ────────────────────────────────────────────────────────── */}
      <Reveal index={2}>
        <Card>
          <CardHeader
            title="Your downloads"
            description="Files are kept on the server until you remove them."
            action={<Download className="h-5 w-5 text-slate-400" />}
          />
          <CardBody>
            <DownloadQueue
              downloads={downloads}
              live={live}
              onDelete={handleDelete}
              deletingId={deletingId}
            />
          </CardBody>
        </Card>
      </Reveal>
    </div>
  );
}
