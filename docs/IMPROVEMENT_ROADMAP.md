# WebCrawler — Improvement Roadmap

> **Date:** 2026-10-11 · **Baseline:** branch `fix/review-fixes` @ `08a861f`
> **Scope:** backend (Express/BullMQ/Mongo/Playwright), frontend (React 19/RTK Query), `scrap/` prototype.
> **How to use this file:** Read sections 1–3 for the *why*. Work the phases in section 4 in order. Section 6 has a ready-made prompt for each workstream, so you can hand it to an AI coding agent (Claude Code, etc.) and get a reviewable PR back.

---

## 1. Where the project stands

The 2026-10-11 review-fixes plan closed the serious defects: SSRF guards, socket auth, atomic job claim, asyncHandler, and the shutdown path. The codebase is clean, typed, and has a unit-test suite. **The next limits are architecture and crawl-engine design, not bugs.**

| Area | Current state | Ceiling it hits |
|---|---|---|
| Process model | API, Socket.io, crawl worker, media worker and Chromium all run in **one Node process** (`app.ts`) | A heavy crawl or a Chromium memory spike slows or kills the API. You can't scale workers on their own. |
| Crawl loop | `CrawlOrchestrator.run` fetches **one page at a time**, with a 500 ms–10 s sleep after each page | A 1000-page job takes 10+ minutes even on a fast site |
| Frontier | In-memory array. `queue.shift()` is O(n). Dedup happens only on dequeue, so the same URL is queued many times. | Memory grows on link-heavy sites, and a BullMQ retry **restarts the crawl from zero** |
| Cancellation | `cancelCrawlJob` only cancels `pending`/`queued` jobs | A `running` crawl **cannot be stopped**. It uses its whole page budget. |
| Politeness | robots.txt is cached **per job**. Delay is per job. | Two jobs on the same host hit it in parallel. No global per-host rate limit. |
| JS rendering | Cheerio first, then Playwright on failure or thin content | A SPA site gets **every page fetched twice** |
| URL identity | `normalizeUrl` only strips the trailing slash | `?utm_*`, `?ref=`, param order, `www.`, and `rel=canonical` all produce duplicates |
| Encoding | axios `responseType: 'text'` reads every page as UTF-8 | Pages in Shift-JIS, Windows-1251 or Latin-1 come out as garbled text, which breaks scoring |
| Relevance | Log-scaled keyword frequency plus exact phrase match | No field weighting (title/h1), no stemming, no corpus-relative (BM25) scoring |
| Storage | `CrawlResult` embeds paragraphs, links, images and structured data, and nothing expires | Mongo documents and collections grow without bound. No retention policy. |
| Observability | Winston logs only. `/api/health` always returns `ok`. | You can't see queue depth, pages/sec, fallback rate, or whether Mongo/Redis are down |
| Infra | No Dockerfile, no compose file, no CI | "Works on my machine". Regressions aren't caught before merge. |
| Dependencies | Uncommitted `mongodb@7.7.0` and `mongoClient.ts` sit next to Mongoose's own `mongodb@6.20.0`. Nothing imports `mongoClient.ts`. | Two driver versions and two connection pools. BSON types can't be swapped between them. |
| Frontend | Polling and socket events run side by side. No tests. No route code-splitting. | Stale caches, a large bundle, UI regressions nobody catches |
| `scrap/` | A separate JS prototype (SerpAPI + yt-dlp) that duplicates the backend media service | Two code paths for the same feature |

---

## 2. Target architecture

```
                         ┌──────────────┐
  Browser (React SPA) ──▶│  API (Express│──── Mongo (metadata, results)
        ▲    WebSocket   │  + Socket.io │──── Redis (queues, rate limits,
        └────────────────│  redis-adapter)        sessions, frontier, pub/sub)
                         └──────┬───────┘
                                │ BullMQ
          ┌─────────────────────┼──────────────────────┐
          ▼                     ▼                      ▼
  ┌───────────────┐    ┌────────────────┐     ┌────────────────┐
  │ crawl-worker  │    │ render-worker  │     │ media-worker   │
  │ HTTP+Cheerio, │───▶│ Playwright pool│     │ yt-dlp, direct │
  │ frontier,     │    │ (own container,│     │ streams, disk  │
  │ scoring       │    │  mem-capped)   │     │ quotas         │
  └──────┬────────┘    └────────────────┘     └───────┬────────┘
         │  socket events via @socket.io/redis-emitter │
         └──────────────────────┬──────────────────────┘
                                ▼
                 Object storage (S3/MinIO/GridFS): raw HTML,
                 snapshots, downloaded media
```

**Principles**
1. **One codebase, several entry points.** `src/server.ts` (API), `src/workers/crawl.ts`, `src/workers/render.ts`, `src/workers/media.ts`. Each is its own process and container.
2. **Workers never import Express.** They publish progress through `@socket.io/redis-emitter`. The API fans it out with `@socket.io/redis-adapter`.
3. **Redis holds shared, short-lived state:** the frontier, per-host token buckets, cancel flags, and rate-limit counters. **Mongo holds durable records.** Object storage holds blobs.
4. **Every crawl can be resumed:** the frontier and visited set live in Redis, keyed by `jobId`. A retry continues where it stopped.
5. **Politeness is global:** a Redis token bucket per host, shared by all jobs and workers.

---

## 3. Prioritization

| # | Workstream | Impact | Effort | Phase |
|---|---|---|---|---|
| W0 | Repo hygiene, Docker, CI, real health checks | High | S | 0 |
| W1 | Cancel running crawls + frontier fixes | High | S | 1 |
| W2 | URL canonicalization + content dedup + charset | High | M | 1 |
| W3 | Smart render routing (stop double-fetching) | High | M | 1 |
| W4 | Split processes + Socket.io Redis adapter | High | M | 2 |
| W5 | Resumable Redis frontier + parallel fetch + global per-host politeness | Very high | L | 2 |
| W6 | Storage tiering + retention + indexes | Medium | M | 2 |
| W7 | Observability (metrics, tracing, Bull Board) | High | M | 3 |
| W8 | Security hardening round 2 | Medium | S–M | 3 |
| W9 | Relevance engine v2 | Medium | M | 4 |
| W10 | Product features (export, schedules, change detection, API keys) | High | L | 4 |
| W11 | Frontend performance and real-time cache | Medium | M | 5 |
| W12 | Test pyramid: integration + e2e + fixture site | High | M | runs alongside every phase |

**Suggested order:** W0 → W1 → W12 (fixture site) → W2 → W3 → W4 → W5 → W7 → W6 → W8 → W11 → W9 → W10.
Reason: W12's fixture site makes W2, W3 and W5 testable, and W4 has to land before W5 can spread work across processes.

---

## 4. Phased plan

### Phase 0 — Foundations (1–2 days)

**W0. Hygiene, containers, CI**
- [x] **Remove `backend/src/config/mongoClient.ts` and the direct `mongodb` dependency.** Mongoose already bundles `mongodb@6.20.0`. If you need the raw driver, use `mongoose.connection.getClient()`.
- [x] Lower `express.json({ limit: '10mb' })` to `100kb`. No endpoint accepts large bodies. *(Also: the central error handler now returns body-parser's 413/400 instead of 500.)*
- [x] Replace `/api/health` with `/api/health/live` (process is up) and `/api/health/ready` (Mongo ping, Redis round-trip through the queue connection, 2 s timeout per probe). Return 503 when not ready. Mounted before the rate limiter.
- [ ] *(Deferred: Docker isn't installed on the dev machine yet.)* Add `docker-compose.yml`: mongo, redis, api, worker, frontend (Vite) and, later, minio. Use a multi-stage `Dockerfile` based on the official Playwright image for workers and slim Node for the API.
- [x] Add `.nvmrc` (22).
- [ ] *(Moved to W11.)* Root `package.json` with npm workspaces. Only needed once `packages/shared` exists.
- [x] GitHub Actions (`.github/workflows/ci.yml`): backend typecheck, tests and build; frontend lint and build (`tsc -b` + `vite build`). npm cache on; Chromium download skipped because the tests stub the browser.
- [ ] Decide on `scrap/`: **merge** the SerpAPI search into the backend as a `SearchProvider` behind the media feature, or **delete** it. Don't keep two copies.

**Done when:** `docker compose up` gives a working app from a fresh clone, and CI is green on every PR.

---

### Phase 1 — Crawl-engine correctness (3–5 days)

**W1. Cancellation and frontier**
- [ ] Let `cancelCrawlJob` move `running` jobs to `cancelling`. Set a Redis key `crawl:cancel:{jobId}`.
- [ ] Have `CrawlOrchestrator` take an `AbortSignal`. Check it before each fetch and pass it to axios (`signal`) and Playwright (close the page). The worker builds the signal by polling the cancel key every 1 s, or by Redis pub/sub.
- [ ] Final state is `cancelled`, keeping the partial results. Emit `job:cancelled`.
- [ ] Frontier: keep an `enqueued` Set. Check `visited ∪ enqueued` **before** pushing. Drop links deeper than `maxDepth` at enqueue time. Use a head index or a deque instead of `shift()`.
- [ ] Throttle progress by time (≤ 1 event/sec) instead of "every 5 pages". Report `pagesDiscovered` as the true frontier size.

**W2. URL identity, dedup, encoding**
- [ ] `canonicalizeUrl()`: lowercase scheme and host, drop default ports and fragments, strip tracking params (`utm_*`, `gclid`, `fbclid`, `mc_*`, `ref`), sort the remaining query params, and collapse `index.html`.
- [ ] Respect `<link rel="canonical">` when it points to the same site. Store `canonicalUrl` and skip pages already seen under that canonical URL.
- [ ] Content fingerprint: SHA-1 of the normalized text, plus an optional SimHash for near-duplicates. Skip saving duplicates and count them in `pagesDuplicate`.
- [ ] Charset: fetch as `arraybuffer`. Detect the charset from the `Content-Type` header, then `<meta charset>`, then a BOM. Decode with `iconv-lite`.
- [ ] Honour `<meta name="robots" content="noindex,nofollow">` and the `X-Robots-Tag` header.
- [ ] Add a scope option: `sameHost` | `sameRegistrableDomain` (use `tldts`) | `custom include/exclude globs`. Today `isSameDomain` allows *any* subdomain without saying so.

**W3. Smart render routing**
- [ ] Per-host `renderMode` learned during the crawl: after K (say 3) pages on a host need Playwright, go straight to Playwright for that host.
- [ ] Cheaper SPA detection before falling back: empty `#root`/`#app`/`#__next`, `<noscript>` with "enable JavaScript", or a text-to-script ratio below a threshold.
- [ ] Let the user override this per job: `render: 'auto' | 'never' | 'always'`.

**Done when:** a cancelled running job stops within 2 s. On the fixture site (W12), duplicate pages drop to 0. SPA hosts get one fetch per page.

---

### Phase 2 — Architecture and scale (1–2 weeks)

**W4. Process split**
- [ ] Entry points: `server.ts` (HTTP + Socket.io only), `workers/crawl.ts`, `workers/media.ts`. Remove worker startup from `app.ts`.
- [ ] `@socket.io/redis-adapter` on the API. `@socket.io/redis-emitter` in workers. `socketService.emitToJob` becomes a thin wrapper around the emitter.
- [ ] Each process handles its own graceful shutdown. Workers stop taking new jobs and checkpoint the frontier (W5), so long crawls don't block deploys.
- [ ] `express-rate-limit` store → `rate-limit-redis`, so limits hold across API replicas.

**W5. Resumable, parallel, polite crawling**
- [ ] Frontier in Redis: `ZSET crawl:{jobId}:frontier` (score = depth, then priority), `SET crawl:{jobId}:seen`. Lua script for an atomic "pop next allowed URL".
- [ ] Parallel fetch inside a job: `p-limit` with concurrency N (default 4). Each fetch first takes a token from the **global per-host bucket** `host:{hostname}:bucket`. The refill rate comes from robots crawl-delay, with a sensible default.
- [ ] Cache robots.txt in Redis per host, with a TTL of 1–24 h, so all jobs and workers share it.
- [ ] Retry = resume: on a BullMQ retry, the orchestrator reloads the frontier and seen set from Redis instead of starting from the seed again.
- [ ] Optional later step: a separate `render` queue/worker with a Chromium pool capped by page count and memory, recycled every N pages.

**W6. Storage and data lifecycle**
- [ ] Move raw HTML and big extracted arrays (links, paragraphs) out of `CrawlResult` into object storage (MinIO locally, S3 in prod) or GridFS. Keep summaries and scores in Mongo.
- [ ] Retention: `expiresAt` + TTL index on results and jobs (for example 30 days by default, set per user or plan). A cleanup job for downloaded media files.
- [ ] Indexes: `{ userId: 1, createdAt: -1 }` on jobs. A text index on `title`, `rawTextSnippet` and `extracted.headings` for search. Check the plans with `explain()`.
- [ ] Bulk writes: buffer results and `bulkWrite` every ~20 pages or 2 s instead of one `findOneAndUpdate` per page.

**Done when:** API and workers scale on their own in compose (`--scale worker=3`). A 1000-page crawl of the fixture site finishes ≥ 4× faster than the baseline. Killing a worker mid-crawl and retrying loses no progress.

---

### Phase 3 — Operability and security (≈1 week)

**W7. Observability**
- [ ] `prom-client` `/metrics`: `crawl_pages_total{status}`, `crawl_fetch_seconds` histogram, `crawl_render_fallback_total`, `crawl_duplicates_total`, `bullmq_queue_depth{queue,state}`, `media_bytes_total`.
- [ ] Structured JSON logs with `requestId` and `jobId` correlation, using AsyncLocalStorage.
- [ ] OpenTelemetry tracing (HTTP → queue → worker → fetch). Export to Jaeger or Tempo in compose.
- [ ] Bull Board mounted under `/api/admin/queues`, behind `authorize('admin')`.
- [ ] Alerts (later): queue depth growing for more than 10 min, worker restarts, error rate.

**W8. Security, round 2**
- [ ] Refresh-token **reuse detection**: store each token family's current `jti` hash. If an old token is reused, revoke the whole family.
- [ ] CSRF: cookies are `sameSite: 'strict'`, which is good. Also add an `Origin`/`Referer` check on state-changing routes as a second layer.
- [ ] Per-user quotas: pages crawled per day, media bytes per day, concurrent downloads. Enforce them in the controllers and show them in the admin UI.
- [ ] Media downloader governance: a ToS/"you have rights to this content" acknowledgement, an audit log (`who`, `url`, `when`, `bytes`), an admin kill switch, and a disk quota. Treat `YTDLP_COOKIES_*` as a sensitive operator secret and never expose it to users.
- [ ] Run `npm audit` and Dependabot or Renovate in CI. Pin the Playwright image digest.
- [ ] A CSP for the frontend that allows only the iframe/embed hosts you already allowlist.

---

### Phase 4 — Product value (2–3 weeks, can ship piece by piece)

**W9. Relevance engine v2**
- [ ] Field-weighted scoring: title ×3, h1/h2 ×2, meta description ×1.5, body ×1.
- [ ] Stemming and stopwords (`wink-nlp` or `natural`), so "crawling" matches "crawl".
- [ ] BM25 across the job's corpus. Normalize to 0–100 after the crawl ends, so scores are comparable within a job.
- [ ] Optional, behind a flag: semantic scoring with embeddings of the query vs page chunks (e.g. a local model or an API). Store the vectors in Mongo Atlas Vector Search or skip storing them.
- [ ] Golden-set tests: about 20 fixture pages with hand-ranked expected order.

**W10. Features**
- [ ] **Export**: streaming CSV / JSON / NDJSON from `/api/crawl/:jobId/export?format=`.
- [ ] **Scheduled crawls**: cron expression per job template, using BullMQ repeatable jobs.
- [ ] **Change detection**: diff each scheduled run against the previous one (new, removed or changed pages by content hash). Send a notification by email or webhook.
- [ ] **Custom extraction rules**: user-defined CSS selectors or a JSON schema per job (e.g. `price: '.product-price'`). Results go into `extracted.custom`.
- [ ] **Public API**: per-user API keys (hashed), an OpenAPI 3 spec generated from the Zod schemas (`zod-to-openapi`), and Swagger UI.
- [ ] **Webhooks**: `job.completed`, `job.failed`, `change.detected`, signed with HMAC.
- [ ] **Search** across all of a user's results (text index from W6).

---

### Phase 5 — Frontend (≈1 week)

**W11.**
- [ ] Shared types and Zod schemas in `packages/shared`, used by both apps. Stops the drift between `frontend/src/lib/types.ts` and the backend models.
- [ ] Socket events update the RTK Query cache with `api.util.updateQueryData` / `invalidateTags`. Fall back to polling only while the socket is disconnected.
- [ ] Route-level code-splitting (`React.lazy`) for Admin, MediaDownloader and JobDetail.
- [ ] Virtualize `ResultsTable` (`@tanstack/react-virtual`). Paginate on the server with a cursor instead of an offset.
- [ ] Error boundaries per route, plus skeleton and empty states.
- [ ] Job detail: a live crawl graph or timeline, a fallback-rate badge, a cancel button that works on `running` jobs (W1), and export buttons (W10).
- [ ] Accessibility pass: focus traps in `Modal`, labelled inputs, keyboard support in `TagInput`.

---

### Cross-cutting — W12. Test pyramid
- [ ] **Fixture site** (`backend/test/fixtures/site/`), served by a local HTTP server in the tests. Include: robots.txt with disallow and crawl-delay, sitemap index → child sitemaps, a SPA page with an empty `#root`, a redirect chain, a redirect to `127.0.0.1` (must be blocked), a Shift-JIS page, duplicate content under `?utm_source=`, canonical tags, a `noindex` page, and a 10k-link page.
- [ ] **Integration tests** with `mongodb-memory-server` and a real Redis from Testcontainers or compose: submit → worker → results → cancel → resume.
- [ ] **E2E** with Playwright against `docker compose`: register → submit crawl → watch progress → open result → export.
- [ ] **Load test** with k6 or autocannon on the API. A crawl benchmark script that reports pages/sec against the fixture site.
- [ ] Coverage gate in CI (start at the current level and only allow it to rise).

---

## 5. Success metrics

| Metric | Baseline (measure first) | Target |
|---|---|---|
| Pages/sec, 1000-page fixture crawl | measure | ≥ 4× baseline |
| Duplicate pages saved (fixture) | measure | 0 |
| Playwright fetches per SPA page | 2 | 1 |
| Time from cancel to stop (running job) | ∞ | ≤ 2 s |
| Progress lost on worker crash | 100% | 0% |
| API p95 latency while 3 crawls run | measure | < 150 ms |
| Mean time to detect an outage | none | < 2 min (alerts) |
| CI on every PR | none | typecheck + lint + unit + integration |

---

## 6. Prompts for each workstream

Each prompt is self-contained. Paste one into a fresh Claude Code session at the repo root. They all follow the same structure: **role → context → task → constraints → acceptance criteria → deliverable**, so the agent doesn't have to guess.

### 6.0 Shared preamble (put this at the top of every prompt)

```text
You are a senior MERN engineer and distributed-systems designer working in the
repo at the current directory (TypeScript backend in /backend: Express 4, Mongoose 8,
BullMQ 5, Socket.io 4, Playwright, axios+cheerio; React 19 + RTK Query + Vite in
/frontend). Read docs/IMPROVEMENT_ROADMAP.md first; your task is one workstream from it.

Ground rules:
- Explore the relevant code before changing it; match existing style, naming and comment density.
- Keep `npx tsc --noEmit -p backend`, `npm test` in backend, and `npx tsc -b && npx eslint .`
  in frontend passing. Run them before you say you're done and show the output.
- Write tests first for new behavior (vitest). Don't weaken or delete existing tests.
- Don't change public response shapes ({ success, data, message }) or route paths unless the task says so.
- All outbound HTTP must keep using netGuard's publicAgents()/guards. Never log secrets or raw proxy URLs.
- Make small, reviewable commits on a new branch named after the workstream (e.g. feat/w1-cancel-running).
- If a requirement is ambiguous or conflicts with the code, stop and ask instead of guessing.
- Finish with: a summary of changes, files touched, test evidence, and follow-ups you deferred.
```

### 6.1 W0 — Foundations

```text
[preamble]
Task: Workstream W0 (Phase 0) from the roadmap.
1. Delete backend/src/config/mongoClient.ts and the direct "mongodb" dependency (Mongoose
   bundles its own driver; confirm nothing imports it). Revert the lockfile drift.
2. Lower the express.json body limit to 100kb.
3. Replace /api/health with /api/health/live and /api/health/ready (Mongo ping, Redis PING;
   503 when not ready). Keep /api/health as an alias to /live for compatibility.
4. Add docker-compose.yml (mongo:7, redis:7, api, worker, frontend) and multi-stage Dockerfiles
   (Playwright base image for the worker). Add .nvmrc and root npm workspaces.
5. Add .github/workflows/ci.yml: install, typecheck both apps, lint frontend, backend tests.
Acceptance: `docker compose up` from a clean clone serves the app on :5173 with API on :8080;
/api/health/ready returns 503 when Redis is stopped; CI YAML passes `act` or a dry review.
```

### 6.2 W1 — Cancel running crawls and fix the frontier

```text
[preamble]
Task: Workstream W1. Today cancelCrawlJob (backend/src/controllers/crawl.controller.ts) only
cancels pending/queued jobs, and CrawlOrchestrator.run (backend/src/services/crawler/
CrawlOrchestrator.ts) cannot be interrupted. Its frontier uses queue.shift() and dedups only on dequeue.
Implement:
- 'running' jobs move to a cancelling state and a Redis flag crawl:cancel:{jobId} is set.
- CrawlOrchestrator.run accepts an AbortSignal, checks it before every fetch, passes it to axios
  and closes the in-flight Playwright page on abort. The worker wires the signal from the Redis flag.
- The final status is 'cancelled' with partial results kept; emit 'job:cancelled'. Update the frontend
  cancel button and status badge to allow cancelling running jobs.
- Frontier: dedup at enqueue (visited ∪ enqueued), drop links past maxDepth at enqueue, O(1) dequeue.
- Progress events are time-throttled (≤1/s) instead of every 5 pages.
Acceptance tests: (a) cancelling a running crawl stops further fetches within 2s (fake timers +
stubbed crawlers); (b) a page linked 50 times is fetched once and queued once; (c) existing
crawlCancel/orchestratorClose tests still pass.
```

### 6.3 W2 + W3 — URL identity, dedup, encoding, render routing

```text
[preamble]
Task: Workstreams W2 and W3. First build the fixture site from W12 (backend/test/fixtures/site
served by a local http server in tests), because every check below is tested against it.
W2: canonicalizeUrl() in backend/src/utils/urlUtils.ts (lowercase host, strip default port/fragment/
tracking params utm_*,gclid,fbclid,mc_*,ref; sort query; collapse index.html); same-site rel=canonical;
SHA-1 content fingerprint to skip duplicates (count pagesDuplicate on CrawlJob); charset-aware
decoding via arraybuffer + iconv-lite (header → meta → BOM); honour meta robots / X-Robots-Tag;
scope option sameHost | sameRegistrableDomain (tldts) | include/exclude globs, added to the submit
Zod schema and the CrawlForm UI. Keep the default behaviour backward compatible.
W3: per-host learned render mode (go straight to Playwright after 3 pages on a host need JS), cheap SPA
heuristics before the fallback, and a per-job render: 'auto'|'never'|'always' option.
Acceptance: on the fixture site there are 0 duplicate results, the Shift-JIS page decodes correctly, SPA pages
are fetched once each after the learning threshold, and robots/noindex are respected.
```

### 6.4 W4 + W5 — Process split, resumable parallel crawling

```text
[preamble]
Task: Workstreams W4 and W5, as a design-first change.
Step 1 (design, no code): write docs/adr/0001-process-split-and-redis-frontier.md covering the entry points,
Socket.io redis-adapter/emitter, the Redis key schema (crawl:{jobId}:frontier ZSET, :seen SET,
host:{host}:bucket token bucket, robots:{host} cache), the Lua pop script, checkpoint/resume
semantics on BullMQ retry, shutdown behaviour and failure modes. Stop and ask me to approve it.
Step 2 (after approval): implement it. server.ts runs only HTTP+Socket.io; workers/crawl.ts and
workers/media.ts are separate entry points with their own npm scripts and compose services.
Parallel fetch inside a job uses p-limit (default 4), gated by the global per-host token bucket.
rate-limit-redis backs express-rate-limit. Batch result writes with bulkWrite.
Acceptance: `docker compose up --scale worker=3` works; killing a worker mid-crawl and letting
BullMQ retry resumes with no re-fetched pages; two jobs on the same host together respect the
crawl-delay; the benchmark script shows pages/sec before and after.
```

### 6.5 W6 — Storage and retention

```text
[preamble]
Task: Workstream W6. Measure first: write a script that reports the average and p95 CrawlResult document
size and the collection size. Then move raw HTML and large extracted arrays to object storage
(MinIO in compose, S3-compatible client, with a StorageProvider interface and a GridFS fallback). Add expiresAt
+ TTL indexes on jobs and results (default 30 days, per-user override for admins), a media cleanup
job, a { userId:1, createdAt:-1 } index and a text index for search. Write a one-off migration
script that is idempotent and resumable. Show `explain()` output for the main queries.
Acceptance: documents shrink by ≥70% on the fixture crawl; old data expires; the API responses are unchanged.
```

### 6.6 W7 + W8 — Observability and security

```text
[preamble]
Task: Workstreams W7 and W8.
W7: prom-client /metrics (crawl_pages_total{status}, crawl_fetch_seconds histogram,
crawl_render_fallback_total, crawl_duplicates_total, bullmq_queue_depth{queue,state},
media_bytes_total); JSON logs with requestId/jobId via AsyncLocalStorage; OpenTelemetry tracing
HTTP→queue→worker→fetch exported to Jaeger in compose; Bull Board at /api/admin/queues (admin only).
W8: refresh-token family reuse detection (revoke the whole family on reuse) with tests; Origin check on
state-changing routes; per-user daily quotas (pages, media bytes) enforced and shown in the admin UI;
a media audit log collection and an admin kill switch; Dependabot config.
Acceptance: Grafana/Jaeger show a crawl end to end in compose; replaying an old refresh token logs
the user out everywhere; exceeding a quota returns 429 with a clear message.
```

### 6.7 W9 — Relevance engine v2

```text
[preamble]
Task: Workstream W9. Before changing scoring, build a golden set: 20 fixture pages plus 5 queries with
hand-ranked expected orderings, and an NDCG@10 evaluation script. Record the baseline score for the current
ContentAnalyzer. Then implement field-weighted BM25 with stemming/stopwords, normalized 0–100 per
job after the crawl ends. Keep the old scorer behind a flag for comparison.
Acceptance: NDCG@10 improves over the baseline on the golden set, and no existing contentAnalyzer test
regresses (update expectations only where the new behaviour is intended, and explain each one).
```

### 6.8 W10 — Product features (one at a time)

```text
[preamble]
Task: Workstream W10, feature: <EXPORT | SCHEDULES | CHANGE DETECTION | EXTRACTION RULES | API KEYS | WEBHOOKS>.
Start with a short spec in docs/specs/<feature>.md: user story, API contract (method, path, Zod schema,
response), data model changes, permissions, limits/quotas, edge cases, and UI changes. Ask me to approve it.
Then implement backend + frontend + tests. Exports must stream (no full in-memory buffering).
Webhooks must be HMAC-signed and retried with backoff. API keys are shown once and stored hashed.
```

### 6.9 W11 — Frontend

```text
[preamble]
Task: Workstream W11. Create packages/shared (npm workspace) with the Zod schemas and DTO types now
duplicated between backend models and frontend/src/lib/types.ts; use it on both sides. Then:
socket events update the RTK Query cache (updateQueryData/invalidateTags), and polling runs only while
the socket is disconnected; React.lazy route splitting for admin/media/job detail; virtualized
ResultsTable with cursor pagination (add the backend cursor param in a backward-compatible way);
route error boundaries; accessibility fixes for Modal and TagInput. Add Vitest + Testing Library for
the frontend and one Playwright e2e for the submit → progress → result flow.
Acceptance: bundle size for the initial route drops (report before/after from `vite build`); no
polling requests while the socket is connected; tsc, eslint, unit and e2e tests all pass.
```

### 6.10 Review prompt (run after each workstream)

```text
Act as a staff engineer reviewing the diff of this branch against main for the workstream described in
docs/IMPROVEMENT_ROADMAP.md. Check: correctness under concurrency (two workers, retries, cancel races),
SSRF/netGuard coverage on every new outbound request, resource cleanup (browser pages, streams,
Redis keys with TTLs), backward compatibility of API shapes, missing tests for the stated acceptance
criteria, and observability (is the new path measurable?). Report findings ranked by severity with
file:line and a concrete failure scenario for each. Don't report style nits.
```

---

## 7. Risks and decisions to make early

| Decision | Options | Recommendation |
|---|---|---|
| Blob storage | GridFS · MinIO/S3 | MinIO locally, S3 in prod, behind a `StorageProvider` interface |
| Page-level fan-out | Parallelism inside the job (p-limit) · a separate per-page BullMQ queue | Start with parallelism inside the job (W5). Move to a per-page queue only if one job needs more than one worker. |
| Semantic relevance | none · local embeddings · hosted API | Ship BM25 first. Add embeddings behind a flag only if the golden set shows a gap. |
| Media downloader | keep · restrict · remove | Keep, with the ToS acknowledgement, quotas and audit log from W8. Get legal advice before any public launch. |
| `scrap/` prototype | merge · delete | Merge the SerpAPI search as a provider, then delete the folder |

**Main risks:** Chromium memory in containers (mitigate with a page cap, recycling, and a memory limit on the render worker); Redis becoming a single point of failure (use managed Redis with persistence, and make the frontier rebuildable from Mongo); scope creep in Phase 4 (ship one feature per PR).
