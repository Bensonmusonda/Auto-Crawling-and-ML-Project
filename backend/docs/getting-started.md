---
title: Getting Started
slug: getting-started
category: Guides
description: Set up and run the Auto-Crawling & ML Platform locally in under 10 minutes.
---

# Getting Started

This guide walks you through getting the full **Data Acquisition & ML Platform** running on your local machine — from cloning the repo to seeing live crawl events in the browser.

---

## Prerequisites

Before you begin, make sure the following are installed:

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| Docker Desktop | 4.x | Includes Docker Compose v2. Enable WSL2 on Windows. |
| Node.js + npm | 18 LTS | Only needed if running the React frontend outside Docker. |
| Python | 3.10+ | Only needed if running the backend directly (not in Docker). |
| Git | Any recent | For cloning the repository. |

---

## Quick Start with Docker Compose

Docker Compose is the recommended way to run the entire stack. It starts the backend API, Celery workers, PostgreSQL, Redis, and (optionally) the frontend in one command.

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd "Auto crawling and ML project"

# 2. Copy the environment file and fill in values
cp .env.example .env

# 3. Build and start all services
docker compose up --build
```

Once the services are healthy, the following will be available:

| Service | URL |
|---------|-----|
| React Frontend | `http://localhost:3000` |
| FastAPI Backend | `http://localhost:8000` |
| Swagger / OpenAPI Docs | `http://localhost:8000/docs` |
| ReDoc | `http://localhost:8000/redoc` |

> The first `--build` takes longer as it pulls base images and installs Python/npm dependencies. Subsequent starts without `--build` are much faster.

---

## Running Without Docker (Development Mode)

If you prefer to run services directly on your machine — useful for fast iteration — follow the steps below.

### Step 1 — Start PostgreSQL and Redis

You can still use Docker just for the databases:

```bash
docker compose up -d postgres redis
```

Or install them natively and update your `.env` with the correct host/port values.

### Step 2 — Backend (FastAPI)

```bash
cd backend
python -m venv venv

# Activate the virtual environment
venv\Scripts\activate        # Windows
source venv/bin/activate     # macOS / Linux

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be live at `http://localhost:8000`. The `--reload` flag means code changes restart the server automatically.

### Step 3 — Celery Worker (Crawling)

Open a second terminal in the project root:

```bash
cd "scraping module"
celery -A tasks worker --loglevel=info -Q celery
```

### Step 4 — Celery ML Worker

Open a third terminal:

```bash
cd backend
celery -A celery_app worker --loglevel=info -Q ml_tasks
```

### Step 5 — Frontend (React)

```bash
cd frontend
npm install
npm start
```

React dev server opens at `http://localhost:3000` and proxies API calls to `localhost:8000`.

---

## Environment Variables

Copy `.env.example` to `.env` in the project root. The table below describes every variable:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `scraper_db` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `password` | Database password |
| `REDIS_HOST` | `localhost` | Redis host (used by Celery broker and pub/sub) |
| `REDIS_PORT` | `6379` | Redis port |
| `DOCS_DIR` | `/app/docs` | Path where the documentation registry looks for `.md` files |

Inside Docker Compose, service names act as hostnames (`postgres`, `redis`). When running locally, set them to `localhost`.

---

## Project Directory Layout

```
Auto crawling and ML project/
├── backend/                   # FastAPI application + Celery ML tasks
│   ├── main.py                # App entry point, router registration
│   ├── docs/                  # Markdown files for the in-app Docs & Guides section
│   ├── datasets/              # Scraped + processed CSV files (volume mount)
│   ├── models/                # Trained .joblib model files (volume mount)
│   └── documentation/         # Python module that serves the docs API
├── scraping module/           # Scrapy + Playwright crawling worker
│   ├── spiders/               # Scrapy spider definitions
│   └── tasks.py               # Celery task entry point for crawl jobs
├── frontend/                  # React single-page application
│   └── src/components/        # UI components (DatasetExplorer, MLTraining, etc.)
├── docker-compose.yaml        # Service orchestration
└── .env.example               # Template environment file
```

---

## Verifying the Installation

Once everything is running, do a quick sanity check:

1. Open `http://localhost:8000/api/health/redis` — you should see `{"status": "ok"}`.
2. Open `http://localhost:3000` — the React app should load with the sidebar visible.
3. Go to the **Datasets** tab. If the datasets volume has any CSVs, they'll appear here.
4. Check the WebSocket indicator at the bottom of the sidebar — it should show **Connected**.

---

## Next Steps

- **[Crawling Workflow Guide](crawling-workflow)** — start your first data collection job.
- **[Data Processing Guide](data-processing)** — clean and transform raw scraped data.
- **[ML Training Guide](ml-training-guide)** — train a regression model on your dataset.
- **[API Reference](api-reference)** — full list of REST endpoints.
- **[Architecture Overview](architecture)** — understand how all the services fit together.
