# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every defect found in the 2026-10-11 code review of the webCrawler project: the dev setup that fails to connect, the SSRF holes, unauthenticated sockets, the cancel that doesn't stop work, crash-on-rejection, resource leaks, the frontend bugs, and the broken `scrap/` prototype.

**Architecture:** Most network-safety fixes go through one module, `backend/src/services/media/netGuard.ts`. It gains a DNS `lookup` that refuses private addresses, plus ready-made http/https agents built on it. Every outbound axios call (crawler, robots, sitemap, direct media stream) uses those agents, so redirects and DNS rebinding are covered as well as the first URL. Playwright pages get a request-level route guard. The yt-dlp and user-proxy paths get explicit pre-flight checks. The other tasks are local fixes in the files that own the bug.

**Tech Stack:** Node 20, TypeScript 5 (CommonJS), Express 4, Mongoose 8, BullMQ 5, Socket.io 4, Playwright, axios; React 19 + RTK Query + Vite on the frontend. New dev dependency: `vitest`. New direct dependency: `cookie` (already in the tree transitively at 0.7.2).

**Spec:** The review findings in the conversation of 2026-10-11. Each task below cites the finding numbers it closes (#1–#14, plus "M:" for the medium/low list).

## Global Constraints

- The backend keeps compiling with `npx tsc --noEmit -p backend` (strict, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`).
- The frontend keeps passing `npx tsc -b` and `npx eslint .` in `frontend/` with zero errors.
- Don't change public API response shapes (`{ success, data, message }`) or route paths.
- Never log raw proxy URLs. Use `ProxyConfig.safeLabel` (existing rule in `proxyConfig.ts`).
- The operator-configured `MEDIA_PROXY_URL` is trusted and may point at a private/loopback host. Only a *user-supplied* `proxyUrl` is checked against private ranges.
- The dev port is `8080` everywhere (backend default, `.env.example`, Vite proxy).
- One commit per task. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Hex-form IPv4-mapped IPv6** (`[::ffff:a9fe:a9fe]`, `[::ffff:7f00:1]`) must be refused. Test in Task 2.
2. **A public URL that 302-redirects to `http://127.0.0.1/`** must fail at the redirect hop, not be fetched. Test in Task 2 (`guardedLookup` is what enforces it), wired in Tasks 3/4.
3. **A cancel arriving between "queued" and the worker pickup** must not run the crawl. Test in Task 6 (atomic claim).
4. **A socket connection with no or expired cookie** must not join any room. Test in Task 5.
5. **Admin search text `(`, `.*`, `a+$`** must be treated as literal text, never as a regex or a 500. Test in Task 9.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `backend/vitest.config.ts`, `backend/test/setup.ts` | Create | Test runner; sets the env vars `config/env.ts` requires |
| `backend/src/services/media/netGuard.ts` | Modify | Private-address logic, `guardedLookup`, `publicAgents()`, `assertPublicProxyUrl()` |
| `backend/src/services/crawler/{CheerioCrawler,SitemapParser,RobotsTxtParser,PlaywrightCrawler,CrawlOrchestrator}.ts` | Modify | Use guarded agents / route guard; same-domain sitemap; cancellation; leak fixes |
| `backend/src/services/media/{MediaDownloadService,PageMediaScanner,YtDlpAdapter}.ts` | Modify | Guarded transports, abort support, merge fix, throttled progress |
| `backend/src/services/media/activeDownloads.ts` | Create | In-process registry of `AbortController`s for running downloads |
| `backend/src/services/socketService.ts` | Modify | Handshake auth, owner-only rooms |
| `backend/src/utils/asyncHandler.ts` | Create | Forwards async controller rejections to Express `next` |
| `backend/src/utils/escapeRegex.ts` | Create | Literal-text regex escaping |
| `backend/src/controllers/*.ts`, `backend/src/routes/*.ts` | Modify | Validation, cancel, asyncHandler wiring |
| `backend/src/queue/{crawl,media}.worker.ts` | Modify | Atomic claim, final-attempt-only failure, guarded handlers |
| `frontend/vite.config.ts`, `frontend/src/...` | Modify | Port, socket deps, refresh failure, polling |
| `scrap/index.js`, `scrap/public/app.js` | Modify | Make the prototype run (Task 13) |

---

### Task 1: Repo and dev-config hygiene (#1, repo)

**Files:**
- Modify: `frontend/vite.config.ts:19-26`
- Modify: `backend/src/config/env.ts:8`
- Modify: git index (untrack `backend/node_modules`)

**Interfaces:**
- Produces: the backend listens on 8080 by default; the Vite proxy targets `http://localhost:8080`.

- [ ] **Step 1:** In `env.ts`, change `PORT: z.string().default('5000')` to `.default('8080')`. In `vite.config.ts`, change both proxy `target`s to `'http://localhost:8080'`.
- [ ] **Step 2:** Run `git rm -r --cached backend/node_modules -q`. Verify: `git ls-files | grep -c node_modules` prints `0`, and `ls backend/node_modules` still lists packages.
- [ ] **Step 3: Verify the dev loop.** Run `npm run dev` in `backend/` and in `frontend/`. Expected: `curl -s http://localhost:5173/api/health` returns `{"status":"ok",...}`.
- [ ] **Step 4: Commit** with message `chore: align dev port to 8080 and stop tracking node_modules`.

---

### Task 2: netGuard: hex IPv6, guarded DNS lookup, proxy check (#2, part of #3)

**Files:**
- Create: `backend/vitest.config.ts`, `backend/test/setup.ts`, `backend/test/netGuard.test.ts`
- Modify: `backend/package.json` (add `"test": "vitest run"`, devDep `vitest`)
- Modify: `backend/src/services/media/netGuard.ts`

**Interfaces:**
- Produces (all exported from `netGuard.ts`):
  - `isPrivateAddress(ip: string): boolean`: now exported.
  - `guardedLookup: (hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) => void`. Same contract as `dns.lookup`. It calls back with a `BlockedHostError` (with `code = 'EBLOCKED'`) when any resolved address is private.
  - `publicAgents(): { httpAgent: http.Agent; httpsAgent: https.Agent }`. A module-level singleton pair built with `{ lookup: guardedLookup, keepAlive: true }`.
  - `assertPublicProxyUrl(raw: string): Promise<void>`. Parses the URL, accepts any scheme, and applies the same hostname / literal-IP / DNS checks as `assertPublicUrl`. Throws `BlockedHostError`.
  - Internal refactor: `assertPublicHost(hostname: string): Promise<void>` holds the shared hostname logic. `assertPublicUrl` keeps its signature.

- [ ] **Step 1: Set up vitest.** `npm i -D vitest` in `backend/`. In `vitest.config.ts`, set `test.setupFiles: ['./test/setup.ts']` and `environment: 'node'`. In `setup.ts`, assign `process.env.MONGO_URI = 'mongodb://test'`, `JWT_SECRET` and `JWT_REFRESH_SECRET` to two different 32+ char strings, and `NODE_ENV = 'test'`.

- [ ] **Step 2: Write the failing tests.**

```ts
import { describe, it, expect } from 'vitest';
import { isPrivateAddress, assertPublicUrl, assertPublicProxyUrl, guardedLookup, BlockedHostError } from '../src/services/media/netGuard';

describe('isPrivateAddress', () => {
  it.each(['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:127.0.0.1', '64:ff9b::7f00:1', '::1', 'fd00::1', '127.0.0.1', '10.1.2.3', '169.254.169.254'])(
    'refuses %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(['8.8.8.8', '2606:4700:4700::1111', '::ffff:808:808'])(
    'allows %s', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

it('rejects bracketed hex-mapped metadata URL', async () => {
  await expect(assertPublicUrl('http://[::ffff:169.254.169.254]/')).rejects.toBeInstanceOf(BlockedHostError);
});

it('rejects a private proxy host but accepts socks scheme parsing', async () => {
  await expect(assertPublicProxyUrl('http://127.0.0.1:6379')).rejects.toBeInstanceOf(BlockedHostError);
  await expect(assertPublicProxyUrl('socks5://user:pw@localhost:1080')).rejects.toBeInstanceOf(BlockedHostError);
});

it('guardedLookup errors for localhost', async () => {
  const err = await new Promise((r) => guardedLookup('localhost', {}, (e) => r(e)));
  expect((err as NodeJS.ErrnoException).code).toBe('EBLOCKED');
});
```

- [ ] **Step 3: Run the tests to confirm they fail.** Run `npx vitest run test/netGuard.test.ts`. Expected: FAIL. `isPrivateAddress` and `guardedLookup` aren't exported, and the hex-mapped cases return `false`.

- [ ] **Step 4: Implement.** In `ipv6IsPrivate`, convert hex IPv4-mapped (`::ffff:XXXX:XXXX`) and NAT64 (`64:ff9b::XXXX:XXXX` and the dotted forms) to dotted IPv4 and delegate to `ipv4IsPrivate`:

```ts
const hexMapped = addr.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
if (hexMapped) {
  const hi = parseInt(hexMapped[1], 16), lo = parseInt(hexMapped[2], 16);
  return ipv4IsPrivate(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
}
```

  Also add `198.18.0.0/15` and `192.0.0.0/24` to `ipv4IsPrivate`. `guardedLookup` calls `dns.lookup(hostname, { ...options, all: true })` and checks every address. When the caller didn't ask for `all`, it calls back with the first address and family.

- [ ] **Step 5: Run the tests to confirm they pass.** Run `npx vitest run test/netGuard.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** with message `fix(security): close IPv4-mapped IPv6 SSRF bypass, add guarded lookup`.

---

### Task 3: SSRF guard for the crawler (#3 crawler + sitemap)

**Files:**
- Modify: `backend/src/controllers/crawl.controller.ts:34-37`
- Modify: `backend/src/services/crawler/{CheerioCrawler,SitemapParser,RobotsTxtParser,PlaywrightCrawler,CrawlOrchestrator}.ts`
- Create: `backend/src/services/crawler/playwrightGuard.ts`
- Test: `backend/test/sitemap.test.ts`

**Interfaces:**
- Consumes: `assertPublicUrl`, `publicAgents()`, `BlockedHostError` from Task 2.
- Produces:
  - `installRequestGuard(page: import('playwright').Page): Promise<void>` in `playwrightGuard.ts`. It calls `page.route('**/*', ...)`, which aborts (`'blockedbyclient'`) any request whose URL fails `assertPublicUrl`, and continues all others. Results are cached per hostname per page in a `Map<string, boolean>`.
  - `SitemapService.getUrls(startUrl, maxUrls)` now returns only URLs where `isSameDomain(u, startUrl)` is true.

- [ ] **Step 1: Write the failing test.** Stub `SitemapService.prototype['fetch']` with `vi.spyOn` so it returns a urlset containing `https://example.com/a`, `https://evil.com/b` and `http://127.0.0.1/c`. Assert that `await new SitemapService().getUrls('https://example.com/', 10)` equals `['https://example.com/a']`.
- [ ] **Step 2: Run it to confirm it fails.** Run `npx vitest run test/sitemap.test.ts`. Expected: FAIL; the result contains all three URLs.
- [ ] **Step 3: Implement.** Add a same-domain filter in `SitemapService.collect`, using `isSameDomain(loc, startUrl)` (thread `startUrl` through as a parameter). Spread `...publicAgents()` into the axios configs in `CheerioCrawler.fetchPage`, `SitemapService.fetch` and `RobotsTxtService.getRobot`. In `PlaywrightCrawler.fetchPage`, call `installRequestGuard(page)` **before** the existing resource-blocking route. Playwright matches routes in reverse registration order, so register the guard first; the type-blocker then aborts images first, and everything else falls through to the guard. In `submitCrawlJob`, `await assertPublicUrl(url)` after `isValidUrl`. On a `BlockedHostError`, respond `400 { success:false, message: err.message }`.
- [ ] **Step 4: Run the tests to confirm they pass.** Run `npx vitest run && npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Manual check.** Submit a crawl for `http://127.0.0.1:8080/api/health`. Expected: HTTP 400 with the netGuard message.
- [ ] **Step 6: Commit** with message `fix(security): SSRF guard for crawler fetches, redirects, and sitemap URLs`.

---

### Task 4: SSRF guard for media (#3 yt-dlp, proxy, redirects, scanner)

**Files:**
- Modify: `backend/src/controllers/media.controller.ts` (`probeUrl`, `startDownloads`)
- Modify: `backend/src/services/media/MediaDownloadService.ts:85-88, 183-196`
- Modify: `backend/src/services/media/PageMediaScanner.ts:104`

**Interfaces:**
- Consumes: `assertPublicUrl`, `assertPublicProxyUrl`, `publicAgents()` (Task 2); `installRequestGuard` (Task 3).

- [ ] **Step 1: Controllers.** In `probeUrl` and `startDownloads`, when `body.data.proxyUrl` is non-empty, `await assertPublicProxyUrl(body.data.proxyUrl)` before `resolveProxy`. On a `BlockedHostError`, return 400 with its message. In `startDownloads`, also `await assertPublicUrl(item.url)` and `assertPublicUrl(item.pageUrl)` for every accepted item; reject the whole request with 400 if any item fails.
- [ ] **Step 2: Service.** Move the `assertPublicUrl(record.sourceUrl)` check from `viaDirectStream` up into `run()`, before the transport choice, so the yt-dlp path is covered too. A `BlockedHostError` there marks the record failed (`fail(record, err.message)`). In `viaDirectStream`, when `proxy` is null, spread `...publicAgents()` into the axios config (proxied requests keep `proxyAgents(proxy)`).
- [ ] **Step 3: Scanner.** Call `await installRequestGuard(page)` right after `context.newPage()` in `PageMediaScanner.scan`. Skip it when `proxy` is set: requests then resolve at the proxy, and the proxy host was already checked.
- [ ] **Step 4: Verify.**
  - Run `npx tsc --noEmit && npx vitest run`. Expected: PASS.
  - Manual check: POST `/api/media/downloads` with `{items:[{pageUrl:'https://example.com',url:'http://169.254.169.254/',kind:'video',source:'ytdlp',label:'x'}]}`. Expected: 400.
  - Manual check: POST `/api/media/probe` with `proxyUrl:'http://127.0.0.1:6379'`. Expected: 400.
- [ ] **Step 5: Commit** with message `fix(security): SSRF guard for yt-dlp sources, user proxies, and media redirects`.

---

### Task 5: Authenticate sockets and restrict rooms (#4)

**Files:**
- Modify: `backend/src/services/socketService.ts`
- Modify: `backend/package.json` (add dependency `cookie@^0.7.2`, devDep `@types/cookie`)
- Modify: `frontend/src/hooks/useMediaSocket.ts:29-31,49`
- Test: `backend/test/socketAuth.test.ts`

**Interfaces:**
- Produces:
  - `authenticateHandshake(cookieHeader: string | undefined, authToken: unknown): JwtPayload | null`, exported from `socketService.ts`. It reads the `accessToken` cookie first, then `socket.handshake.auth.token` if that is a string. It returns `verifyAccessToken(token)`, or `null` on a missing or invalid token.
  - Server behaviour:
    - `io.use()` rejects unauthenticated sockets with `new Error('unauthorized')`.
    - On connect, the socket auto-joins `user:${payload.userId}`.
    - `join:user` and `leave:user` handlers are removed.
    - `join:job` joins only when `CrawlJob.exists({ _id: jobId, userId })` is truthy and `mongoose.isValidObjectId(jobId)`.
  - Event names emitted to clients are unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `authenticateHandshake(undefined, undefined)` returns `null`.
  - `authenticateHandshake('accessToken=garbage', undefined)` returns `null`.
  - With a token from `signAccessToken({ _id: new Types.ObjectId(), role: 'user', email: 'a@b.co' })`, `authenticateHandshake(\`accessToken=${t}\`, undefined)?.email` equals `'a@b.co'`.
  - `authenticateHandshake(undefined, t)?.role` equals `'user'`.
- [ ] **Step 2: Run them to confirm they fail.** Run `npx vitest run test/socketAuth.test.ts`. Expected: FAIL; the function doesn't exist.
- [ ] **Step 3: Implement** as described in Interfaces. Store the payload on `socket.data.user`.
- [ ] **Step 4: Frontend.** In `useMediaSocket`, delete the `join`, `connect` and `leave:user` emits. The server joins the user room on every (re)connect. Keep the event listeners.
- [ ] **Step 5: Verify.**
  - Run `npx vitest run` (backend) and `npx tsc -b && npx eslint .` (frontend). Expected: PASS.
  - Manual check: `node -e "require('socket.io-client').io('http://localhost:8080').on('connect_error',e=>{console.log(e.message);process.exit()})"` prints `unauthorized`.
- [ ] **Step 6: Commit** with message `fix(security): authenticate socket handshake, owner-only rooms`.

---

### Task 6: Crawl cancellation and worker failure semantics (#5, #8)

**Files:**
- Modify: `backend/src/controllers/crawl.controller.ts:305-330`
- Modify: `backend/src/queue/crawl.queue.ts` (add `removeCrawlJob`)
- Modify: `backend/src/queue/crawl.worker.ts`
- Modify: `backend/src/queue/media.worker.ts:38-54`
- Create: `backend/src/queue/attempts.ts`
- Test: `backend/test/attempts.test.ts`

**Interfaces:**
- Produces:
  - `removeCrawlJob(jobId: string): Promise<void>`, mirroring `removeMediaJob`.
  - `isFinalAttempt(job: { attemptsMade: number; opts: { attempts?: number } } | undefined): boolean`. It returns `true` when `!job || job.attemptsMade >= (job.opts.attempts ?? 1)`.

- [ ] **Step 1: Write the failing test.** Assert `isFinalAttempt({attemptsMade:1,opts:{attempts:2}}) === false`, `isFinalAttempt({attemptsMade:2,opts:{attempts:2}}) === true`, and `isFinalAttempt({attemptsMade:1,opts:{}}) === true`.
- [ ] **Step 2: Run it to confirm it fails.** Run `npx vitest run test/attempts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `isFinalAttempt`.**
- [ ] **Step 4: Atomic claim in the crawl worker.** Replace the "mark as running" `findByIdAndUpdate` with `CrawlJob.findOneAndUpdate({ _id: jobId, status: { $in: ['pending','queued'] } }, { status:'running', startedAt: new Date(), bullJobId: job.id }, { new: true })`. If it returns `null`, log `skipping cancelled/claimed job` and return without crawling. A BullMQ retry finds the job in `running`, so the claim filter must also accept `status: 'running'` when `job.attemptsMade > 0`.
- [ ] **Step 5: Final-attempt-only failure.** In both workers' `failed` handlers, return early unless `isFinalAttempt(job)`. Wrap the whole handler body in `try { … } catch (e) { logger.error(...) }`; this covers part of #6.
- [ ] **Step 6: Controller.** In `cancelCrawlJob`, validate `jobId` with `mongoose.isValidObjectId` (400 on fail), then call `await removeCrawlJob(jobId)` and use an atomic `findOneAndUpdate({ _id, userId, status: { $in: ['pending','queued'] } }, { status: 'cancelled', completedAt: new Date() })`. If that returns `null`, respond 400 `Cannot cancel a job with status '<current>'`.
- [ ] **Step 7: Verify.**
  - Run `npx vitest run && npx tsc --noEmit`. Expected: PASS.
  - Manual check: submit 6 crawls, so the 4th–6th queue behind concurrency 3, and cancel the 6th. Expected: its status stays `cancelled`, and the log shows `skipping cancelled/claimed job` or the job was removed.
- [ ] **Step 8: Commit** with message `fix: crawl cancel actually prevents the run; only mark failed on final attempt`.

---

### Task 7: Async error safety in Express and process (#6)

**Files:**
- Create: `backend/src/utils/asyncHandler.ts`
- Modify: `backend/src/routes/{media,crawl,auth,admin,public}.routes.ts`
- Modify: `backend/src/app.ts` (process handlers)
- Test: `backend/test/asyncHandler.test.ts`

**Interfaces:**
- Produces: `asyncHandler<T extends RequestHandler>(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler`. It calls `fn` and forwards any rejection to `next(err)`.

- [ ] **Step 1: Write the failing test.** Call `asyncHandler(async () => { throw new Error('boom') })` with stub `req`/`res` and a `vi.fn()` `next`. After `await new Promise(setImmediate)`, assert that `next` was called with an `Error` whose message is `'boom'`.
- [ ] **Step 2: Run it to confirm it fails.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Wrap every controller in every route file with `asyncHandler(...)`. The central error handler in `app.ts` already returns 500; give it a `if (res.headersSent) return next(err)` guard. In `bootstrap`, add `process.on('unhandledRejection', (r) => logger.error('Unhandled rejection:', r))`.
- [ ] **Step 4: Verify.**
  - Run `npx vitest run && npx tsc --noEmit`. Expected: PASS.
  - Manual check: stop Mongo, then GET `/api/media/downloads/<valid id>`. Expected: HTTP 500 JSON, and the process stays alive.
- [ ] **Step 5: Commit** with message `fix: route async controller errors to the error handler instead of crashing`.

---

### Task 8: Crawler resource leaks and in-flight media cancellation (#7, #9, #10)

**Files:**
- Modify: `backend/src/services/crawler/PlaywrightCrawler.ts:19-34`
- Modify: `backend/src/services/crawler/CrawlOrchestrator.ts:31-225`
- Create: `backend/src/services/media/activeDownloads.ts`
- Modify: `backend/src/services/media/{MediaDownloadService,YtDlpAdapter}.ts`
- Modify: `backend/src/controllers/media.controller.ts:265-286`
- Test: `backend/test/activeDownloads.test.ts`, `backend/test/getBrowser.test.ts`

**Interfaces:**
- Produces:
  - `activeDownloads.ts` exports:
    - `register(id: string): AbortSignal`, which throws if `id` is already registered.
    - `cancel(id: string): boolean`, which aborts and unregisters, and returns whether `id` was active.
    - `unregister(id: string): void`.
  - `YtDlpDownloadOptions.signal?: AbortSignal`. `run()` kills the child with `SIGKILL` on abort and resolves `{ code: -1, ..., aborted: true }`. `YtDlpDownloadResult` gains `aborted?: boolean`.
  - `getBrowser()` single-flights launches through a module-level `launching: Promise<Browser> | null`.

- [ ] **Step 1: Write the failing tests.**
  - `activeDownloads`: `const s = register('a'); expect(cancel('a')).toBe(true); expect(s.aborted).toBe(true); expect(cancel('a')).toBe(false)`.
  - `getBrowser`: use `vi.mock('playwright')` so `chromium.launch` resolves after a tick with `{ isConnected: () => true, close: vi.fn() }`. Then `await Promise.all([getBrowser(), getBrowser(), getBrowser()])` and expect `chromium.launch` to have been called exactly once.
- [ ] **Step 2: Run them to confirm they fail.** Expected: FAIL (no module; launch called 3×).
- [ ] **Step 3: Implement `activeDownloads` and the `getBrowser` single-flight.** Clear `launching` in a `finally`.
- [ ] **Step 4: Orchestrator.** Wrap the body of `run()` after option destructuring in `try { … } finally { await this.playwrightCrawler.close(); }`.
- [ ] **Step 5: Media cancel.**
  - In `MediaDownloadService.run`, call `register(downloadId)` before choosing the transport, and `unregister` in a `finally`.
  - Pass the signal to axios (`signal`) and to yt-dlp (`signal`).
  - On abort, from either transport: remove partial files with `findByStem(dir, stem)` followed by `removeFile` (loop until none), skip every `record.save()`, and return.
  - In `deleteDownload`, call `cancel(record._id.toString())` before `removeMediaJob`.
- [ ] **Step 6: Verify.**
  - Run `npx vitest run && npx tsc --noEmit`. Expected: PASS.
  - Manual check: start a large yt-dlp download and delete it at ~20%. Expected: the `yt-dlp` process exits, `downloads/<userId>/` holds no file with that id, and the log has no `DocumentNotFoundError`.
- [ ] **Step 7: Commit** with message `fix: single-flight browser launch, close contexts on error, abort deleted downloads`.

---

### Task 9: Input validation hardening (#13, #14, M: operator injection)

**Files:**
- Create: `backend/src/utils/escapeRegex.ts`
- Modify: `backend/src/controllers/admin.controller.ts:61-73, 138-153, 167-174`
- Modify: `backend/src/controllers/crawl.controller.ts:106-109`
- Test: `backend/test/escapeRegex.test.ts`

**Interfaces:**
- Produces: `escapeRegex(s: string): string`. It escapes `. * + ? ^ $ { } ( ) | [ ] \ /`.

- [ ] **Step 1: Write the failing test.** For each of `'('`, `'.*'`, `'a+$'` and `'[x]'`, assert that `new RegExp(escapeRegex(s)).test(s)` is `true` and `new RegExp(escapeRegex('.*')).test('abc')` is `false`.
- [ ] **Step 2: Run it to confirm it fails.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Use `escapeRegex(search)` in `listUsers`, and cap the search at 100 chars.
  - Add an `isValidObjectId(userId)` 400 guard to `updateUserCrawlLimit`.
  - In `listCrawlJobs` and `listAllJobs`, only set `filter.status` when `typeof req.query.status === 'string'` and it is one of the `CrawlJobStatus` values; otherwise ignore it.
- [ ] **Step 4: Verify.**
  - Run `npx vitest run`. Expected: PASS.
  - Manual check: `GET /api/admin/users?search=(` returns 200 with an empty list. `GET /api/crawl?status[$ne]=x` returns the unfiltered list, not an operator query.
- [ ] **Step 5: Commit** with message `fix: escape admin search regex, validate ids and status filters`.

---

### Task 10: Frontend correctness (#11, #12, M: dashboard polling)

**Files:**
- Modify: `frontend/src/pages/JobDetail.tsx:30-47`
- Modify: `frontend/src/features/api/baseApi.ts:32-53`
- Modify: `frontend/src/pages/Dashboard.tsx:26-37`

**Interfaces:**
- Consumes: `clearUser` from `features/auth/authSlice.ts`.

- [ ] **Step 1: JobDetail.** Destructure `const { refetch: refetchJob } = jobQuery` and `const { refetch: refetchResults } = resultsQuery`, and make `onSettled = useCallback(() => { refetchJob(); refetchResults(); }, [refetchJob, refetchResults])`. Leave the job's 8s polling as it is (not a finding).
- [ ] **Step 2: baseApi.**
  - Skip the refresh flow when the request URL starts with `/auth/` (login/register/refresh 401s are real answers).
  - When the refresh call has no `data`, `api.dispatch(clearUser())` so guards redirect to `/login`.
- [ ] **Step 3: Dashboard.** Wrap `jobs` in `useMemo(() => data?.data.jobs ?? [], [data])`. Use `pollingInterval: hasActive ? 6000 : 0`; `hasActive` comes from the previous data, which is fine because the first load always fetches.
- [ ] **Step 4: Verify.**
  - Run `npx tsc -b && npx eslint .` in `frontend/`. Expected: 0 errors, 0 warnings.
  - Manual check: on `/jobs/:id` during a running crawl, the Network → WS frames show one `join:job`, not one per render.
  - Manual check: delete the `refreshToken` cookie and the `accessToken` cookie, then click any page. Expected: redirect to `/login`.
- [ ] **Step 5: Commit** with message `fix(frontend): stable socket subscription, logout on failed refresh, conditional polling`.

---

### Task 11: Crawler content safety (M: embed regex, iframe sandbox, image URLs, crawl delay)

**Files:**
- Modify: `backend/src/services/crawler/ContentAnalyzer.ts:38-39, 194-204, 245-248`
- Modify: `backend/src/services/crawler/RobotsTxtParser.ts:28-35`
- Modify: `frontend/src/components/crawl/VideoPlayer.tsx:22-30`
- Test: `backend/test/contentAnalyzer.test.ts`

**Interfaces:**
- Produces:
  - `isEmbedHost(url: string): boolean`, exported from `ContentAnalyzer.ts`. It parses the URL and matches the **hostname** against `youtube.com`, `youtube-nocookie.com`, `youtu.be`, `player.vimeo.com`, `vimeo.com`, `dailymotion.com`, `wistia.com`, `wistia.net` (exact or subdomain), or `facebook.com` with a pathname starting `/plugins/video`.
  - `MAX_CRAWL_DELAY_MS = 10_000` in `RobotsTxtParser.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `isEmbedHost('https://evil.com/?youtube.com')` is `false`; `isEmbedHost('https://www.youtube.com/embed/x')` is `true`.
  - `new ContentAnalyzer().analyze('<img src="javascript:alert(1)"><img src="/a.png">', 'https://ex.com/', [], []).extracted.images` equals `['https://ex.com/a.png']`.
- [ ] **Step 2: Run them to confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Replace the `EMBED_HOST_RE.test(src)` call with `isEmbedHost(resolved)`; resolve first.
  - Add `isValidUrl(resolved)` to the image filter.
  - Clamp `getCrawlDelay` to `MAX_CRAWL_DELAY_MS`.
  - Add `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"` to the `<iframe>` in `VideoPlayer`.
- [ ] **Step 4: Verify.** Run `npx vitest run` (backend) and `npx tsc -b` (frontend). Expected: PASS; a YouTube embed still plays in the job view.
- [ ] **Step 5: Commit** with message `fix: strict embed host check, sandboxed iframes, http-only image URLs, cap crawl delay`.

---

### Task 12: Media and auth polish (M: disposition, merge, progress throttle, cookie lifetimes, Redis, shutdown)

**Files:**
- Modify: `backend/src/controllers/media.controller.ts:250-253`
- Modify: `backend/src/services/media/PageMediaScanner.ts:162`
- Modify: `backend/src/services/media/MediaDownloadService.ts` (progress emits)
- Modify: `backend/src/controllers/auth.controller.ts` (cookie `maxAge`)
- Modify: `backend/src/config/redis.ts:14-20`
- Modify: `backend/src/app.ts:88-95`
- Test: `backend/test/authCookies.test.ts`

**Interfaces:**
- Produces:
  - `cookieMaxAge(token: string): number`, exported from `auth.controller.ts`. It returns `jwt.decode(token).exp * 1000 - Date.now()`, floored at 0.
  - `SOCKET_PROGRESS_INTERVAL_MS = 250` in `MediaDownloadService.ts`.

- [ ] **Step 1: Write the failing test.** With `t = jwt.sign({}, 'x'.repeat(32), { expiresIn: '15m' })`, expect `cookieMaxAge(t)` to be within ±2000 of `900_000`.
- [ ] **Step 2: Run it to confirm it fails.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Use `cookieMaxAge(token)` for both cookies in `register`, `login` and `refreshToken`.
  - Set the header to `Content-Disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<encodeURIComponent(name)>`, where the ASCII fallback replaces non-ASCII characters and `"` with `_`.
  - In the scanner merge, copy only the defined DOM fields: `Object.fromEntries(Object.entries(hit).filter(([,v]) => v !== undefined))`.
  - Throttle the `media:progress` socket emits in both transports to one per `SOCKET_PROGRESS_INTERVAL_MS`; terminal events are unthrottled.
  - Change the Redis `retryStrategy` to always return `Math.min(times * 200, 5000)` (never give up).
  - Make `shutdown` also `await crawlQueue.close(); await mediaQueue.close(); await mongoose.connection.close();`, and guard against running twice with a `let shuttingDown` flag.
- [ ] **Step 4: Verify.**
  - Run `npx vitest run && npx tsc --noEmit`. Expected: PASS.
  - Manual check: download a file labelled `日本語 "test"`. Expected: the browser saves `日本語 test.mp4`.
  - Manual check: Ctrl+C the dev server. Expected: it exits cleanly within 5s.
- [ ] **Step 5: Commit** with message `fix: UTF-8 download names, throttle progress, cookie lifetimes from JWT, resilient Redis, full shutdown`.

---

### Task 13: Make the `scrap/` prototype run (scrap findings)

> **Confirm before executing:** this task assumes `scrap/` should be repaired as a standalone SerpAPI search + yt-dlp download demo. If it is abandoned, replace this task with `git rm -r scrap` and stop.

**Files:**
- Modify: `scrap/index.js`, `scrap/public/app.js`
- Modify: `scrap/package.json` (add `"start": "node index.js"`, dep `dotenv`)

**Interfaces:**
- Produces:
  - `GET /api/search?q=&count=` returns `{ videos: Array<{ title, link, thumbnail, source, duration }> }`.
  - `POST /api/download { url, title }` returns `{ success: boolean, file?: string, message?: string }`. The file is served under `/download/<file>`.

- [ ] **Step 1: Server.**
  - Use `app.use(express.json())`.
  - Read `req.query` instead of `req.q`.
  - Read `SERPAPI_KEY` from `process.env` (via `dotenv`); fail fast with a console error if it is missing.
  - Clamp `count` to 1–20.
  - Move `app.listen` to the top level.
  - Add `/api/download`: validate `url` with `new URL` (http/https only), then run `execFile('yt-dlp', ['-o', path.join(DOWNLOAD_DIR, '%(id)s.%(ext)s'), '--no-playlist', '--', url])`. Never pass the title to the shell. Respond with the produced filename.
- [ ] **Step 2: Client.**
  - Rename everything to `currentVideos`.
  - Use `const btn = document.getElementById('searchBtn')`, and the `.disabled` / `.textContent` property names.
  - Build the cards with DOM APIs (`createElement` + `textContent`) instead of an `innerHTML` template, to remove the XSS.
  - Wire the buttons to `downloadOne(i)`.
  - Separate `const btn = getElementById(...)` from `btn.disabled = true`.
  - Move the "Downloading…" status before the fetch.
- [ ] **Step 3: Verify.** With `SERPAPI_KEY=... npm start` in `scrap/`, open `http://localhost:3000` and search `cats`. Expected: a cards grid renders, and Download on one card produces a file in `scrap/download/` with a link to it.
- [ ] **Step 4: Commit** with message `fix(scrap): make search/download prototype runnable`.

---

## Self-Review Notes

- **Coverage:**
  - #1→T1, #2→T2, #3→T3+T4, #4→T5, #5→T6, #6→T6+T7, #7→T8, #8→T6, #9→T8, #10→T8, #11→T10, #12→T10, #13→T9, #14→T9.
  - M-list: T9–T12 (except "deactivated user keeps access until token expiry" — intentionally deferred, see below).
  - Repo hygiene→T1; scrap→T13.
- **Deferred on purpose:** checking `isActive` on every authenticated request costs a DB read per request. With the 15-minute access token, a deactivated user stays signed in for at most 15 minutes, and that is accepted. Revisit if that window matters.
- **Ordering:** T2 must land before T3/T4. T3 must land before T4 (`installRequestGuard`). T5 is needed by T10's socket check. All other tasks are independent.
