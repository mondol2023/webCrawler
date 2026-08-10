import { Globe2, Lock, CreditCard, ShieldAlert, Clock, Ban, FileWarning, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { Restriction, RestrictionKind } from '@/lib/types';

const ICONS: Record<RestrictionKind, typeof Globe2> = {
  none: Globe2,
  geo: Globe2,
  login: Lock,
  paywall: CreditCard,
  drm: ShieldAlert,
  robots: FileWarning,
  forbidden: Ban,
  rate_limited: Clock,
  unavailable: FileWarning,
};

const TITLES: Record<RestrictionKind, string> = {
  none: '',
  geo: 'Restricted in this region',
  login: 'Sign-in required',
  paywall: 'Paid content',
  drm: 'Copy-protected content',
  robots: 'The site asked crawlers not to fetch this',
  forbidden: 'The site refused the request',
  rate_limited: 'Too many requests',
  unavailable: 'Content unavailable',
};

/**
 * Explains why a page or asset could not be fetched.
 *
 * Two of these come with an action:
 *   - `geo`, because that block is purely a function of *where* the request
 *     comes from — routing through a proxy the user controls answers it.
 *   - `robots`, because robots.txt is a crawling convention rather than an
 *     access control, and the scanner already exposes a switch for it. The
 *     retry re-runs the same scan with that switch off.
 *
 * Sign-in walls, paywalls and DRM get no action: those are access-control
 * decisions by the publisher, so they are stated, not bypassed.
 */
export function RestrictionNotice({
  restriction,
  onUseProxy,
  onIgnoreRobots,
  proxyActive,
}: {
  restriction: Restriction;
  onUseProxy?: () => void;
  onIgnoreRobots?: () => void;
  proxyActive?: boolean;
}) {
  if (restriction.kind === 'none') return null;

  const Icon = ICONS[restriction.kind] ?? FileWarning;
  const canRetryViaProxy = restriction.proxyMayHelp && !proxyActive && onUseProxy;
  const canRetryIgnoringRobots = restriction.kind === 'robots' && onIgnoreRobots;

  return (
    <div className="animate-pop-in rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {TITLES[restriction.kind]}
          </h4>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300/90">{restriction.message}</p>

          {canRetryViaProxy && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={onUseProxy}>
                <Globe2 className="h-4 w-4" />
                Set up a proxy and retry
              </Button>
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400/80">
                This block depends on the country the request comes from. Point the scanner at a
                proxy or VPN endpoint you control and try again.
              </p>
            </div>
          )}

          {canRetryIgnoringRobots && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={onIgnoreRobots}>
                <ScanSearch className="h-4 w-4" />
                Scan anyway
              </Button>
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400/80">
                Only do this for content you are entitled to download. The site’s terms still
                apply — robots.txt is guidance for crawlers, not permission.
              </p>
            </div>
          )}

          {!restriction.proxyMayHelp && restriction.kind !== 'robots' && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400/80">
              This is an access decision by the site itself — a proxy will not change it. If you
              have an account or a licence for this content, download it through the site.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
