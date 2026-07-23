# WebCrawler — Web Intelligence Platform

A full-stack, job-queue-based web crawler. Submit a URL and a set of keywords/phrases;
the platform crawls the site, extracts structured content, scores each page for
relevance, and streams progress back to the UI in real time.

## Features

- **Authentication & RBAC** — JWT (httpOnly cookies) with access/refresh rotation, `user` and `admin` roles.
- **Crawl jobs** — background processing via BullMQ + Redis, per-user concurrency limits.
- **Two-tier crawler** — fast HTTP + Cheerio first, automatic Playwright fallback for JS-rendered pages.
- **Polite crawling** — honours `robots.txt` (permissions + crawl-delay) and seeds from `sitemap.xml`.
- **Relevance scoring** — keyword frequency (log-scaled) + exact phrase matching, 0–100.
- **Real-time updates** — Socket.io streams `started` / `progress` / `completed` / `failed` events.
- **Admin console** — platform stats, per-user activation and crawl-limit management.
- **Modern UI** — React 19, Redux Toolkit + RTK Query, Tailwind CSS, light/dark themes.

## Tech Stack

| Layer     | Technology |
|-----------|-----------|
| Backend   | Node.js, Express, TypeScript, Mongoose (MongoDB), BullMQ (Redis), Socket.io, Playwright, Cheerio, Zod, Winston |
| Frontend  | React 19, Vite, Redux Toolkit / RTK Query, React Router, Tailwind CSS v4, socket.io-client, lucide-react |

## Prerequisites

- Node.js 20.19+ or 22.12+
- MongoDB (local or Atlas)
- Redis

## Getting Started

### 1. Backend

```bash
cd backend
npm install
npx playwright install chromium   # one-time, for the Playwright fallback
cp .env.example .env              # then fill in the values
npm run dev                       # starts API + Socket.io + crawl worker on :5000
```

Generate strong JWT secrets for `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                       # Vite dev server on :5173 (proxies /api + /socket.io)
```

Open http://localhost:5173. Register an account to get started. To grant admin
rights, set a user's `role` to `admin` in MongoDB.

## Environment Variables (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | `development` \| `production` \| `test` | `development` |
| `PORT` | API port | `5000` |
| `CLIENT_URL` | Frontend origin (CORS + Socket.io) | `http://localhost:5173` |
| `MONGO_URI` | MongoDB connection string | — (required) |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | Access-token secret (≥ 32 chars) | — (required) |
| `JWT_REFRESH_SECRET` | Refresh-token secret (≥ 32 chars) | — (required) |
| `JWT_EXPIRES_IN` | Access-token TTL | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh-token TTL | `7d` |
| `BCRYPT_ROUNDS` | bcrypt cost factor | `12` |

## Project Structure

```
backend/src
├── config/          env, MongoDB, Redis
├── controllers/     auth, crawl, admin
├── middleware/      auth (JWT), rbac, rate limiting
├── models/          User, CrawlJob, CrawlResult
├── queue/           BullMQ queue + worker
├── routes/          auth, crawl, admin
├── services/
│   ├── crawler/     Orchestrator, Cheerio/Playwright crawlers, robots + sitemap, analyzer
│   └── socketService.ts
├── utils/           jwt, logger, urlUtils
└── app.ts           bootstrap (API + sockets + worker + graceful shutdown)

frontend/src
├── app/             Redux store + typed hooks
├── features/        api (RTK Query base), auth, crawl, admin
├── components/      ui primitives, layout, crawl, routing guards
├── hooks/           useAuth, useSocket, useTheme
├── lib/             utils, types, socket, apiError
└── pages/           Login, Register, Dashboard, CrawlSubmit, JobDetail, admin/*
```

## API Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | – | Create account |
| POST | `/api/auth/login` | – | Sign in |
| POST | `/api/auth/refresh` | – | Rotate tokens |
| POST | `/api/auth/logout` | – | Clear session |
| GET | `/api/auth/me` | user | Current user |
| POST | `/api/crawl` | user | Submit a crawl job |
| GET | `/api/crawl` | user | List own jobs |
| GET | `/api/crawl/:id` | user | Job detail |
| GET | `/api/crawl/:id/results` | user | Paginated results |
| PATCH | `/api/crawl/:id/cancel` | user | Cancel a pending/queued job |
| GET | `/api/admin/stats` | admin | Platform metrics |
| GET | `/api/admin/users` | admin | List users |
| PATCH | `/api/admin/users/:id/toggle-status` | admin | Activate/suspend |
| PATCH | `/api/admin/users/:id/crawl-limit` | admin | Set crawl limit |
| GET | `/api/admin/jobs` | admin | All jobs |

## Production Build

```bash
cd backend  && npm run build && npm start   # compiles to dist/, runs node
cd frontend && npm run build                # emits static assets to dist/
```
