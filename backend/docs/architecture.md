---
title: Architecture Overview
slug: architecture
category: Technical
description: How the backend services, workers, and frontend fit together.
---

# Architecture Overview

The **Data Acquisition & ML Platform** is a modular, microservices-style system composed of five containers orchestrated by Docker Compose. This document explains how each piece fits together, how data flows through the system, and how to extend it.

---

## High-Level Diagram

```
Browser (React — port 3000)
     │
     │  HTTP REST + WebSocket
     ▼
FastAPI Backend (port 8000)  ───────────── PostgreSQL 14 (port 5432)
     │                                      (job records, dataset metadata)
     │
     ├── Redis 7 (port 6379) ─────────────────────────────────────┐
     │   Celery task broker                                        │
     │   Pub/sub event bus (real-time job updates)                 │
     │                                                             │
     ├── Celery Worker  (scraping module)                          │
     │   Scrapy + Playwright                                       │
     │   Queue: celery (default)                          ◄────────┤
     │                                                             │
     └── Celery ML Worker  (backend container)                     │
         scikit-learn + pandas                           ◄─────────┘
         Queue: ml_tasks
```

---

## Services

| Service | Image / Build | Port | Responsibility |
|---------|--------------|------|----------------|
| `backend` | `./backend` (FastAPI + Uvicorn) | 8000 | REST API, WebSocket hub, ML task dispatch |
| `worker` | `./scraping module` (Celery + Scrapy) | — | Executes crawl jobs, writes CSV output |
| `ml_worker` | `./backend` (Celery) | — | Trains ML models on the `ml_tasks` queue |
| `postgres` | `postgres:14-alpine` | 5432 | Persistent relational storage |
| `redis` | `redis:7-alpine` | 6379 | Task broker + pub/sub event bus |
| `frontend` (optional) | `./frontend` (React) | 3000 | Single-page application |

All five containers share the `scraper_network` bridge network and communicate by **service name** (e.g. `redis:6379`, `postgres:5432`).

---

## Data Flow: Crawl Job

1. The user fills in the crawl form in the React app and clicks **Start Crawl**.
2. Frontend sends `POST /api/crawl/start` with `{ url, dataset_name, max_pages }`.
3. The FastAPI backend creates a Celery task and pushes it to the **default Redis queue**.
4. The `worker` container (Scrapy + Playwright) picks up the task and begins crawling.
5. As pages are scraped, the worker publishes progress events to the **Redis pub/sub channel**.
6. The FastAPI WebSocket handler subscribes to that channel and streams events to every connected browser in real time.
7. On completion, the scraped rows are flushed to a CSV file in `/app/datasets/` (a shared Docker volume).
8. The job record in PostgreSQL is updated to `completed`.

---

## Data Flow: ML Training Job

1. The user selects a dataset and model configuration on the **ML Training** tab.
2. Frontend sends `POST /api/ml-training/train` with dataset name, target column, model type, and hyperparameters.
3. The FastAPI backend creates a Celery task and pushes it to the **`ml_tasks` Redis queue**.
4. The `ml_worker` container (same Docker image as `backend`) picks up the task, loads the CSV with pandas, and trains the model with scikit-learn.
5. Training metrics (R², MAE, RMSE, feature importances) and the serialised model (`.joblib`) are saved to `/app/models/`.
6. Job status is updated in Redis; the frontend receives the completion event via WebSocket or polling.

---

## Shared Volume Mounts

| Host Path | Container Path | Used By |
|-----------|---------------|---------| 
| `./backend` | `/app` | `backend`, `ml_worker` |
| `./scraping module` | `/app` | `worker` |
| `./backend/datasets` | `/app/datasets` | All (read/write CSVs) |
| `./backend/models` | `/app/models` | `ml_worker` (write), `backend` (serve predictions) |

Because `./backend` is bind-mounted to `/app` on both the API and ML worker containers, **changes to files in `backend/` take effect immediately without a rebuild** — including new documentation files in `backend/docs/`.

---

## Documentation Registry

The in-app Docs & Guides section is handled by the `documentation` Python module inside `backend/`. At startup, `build_registry()` scans every `.md` file in `DOCS_DIR` (default `/app/docs`), parses the YAML front-matter, and renders the Markdown body to HTML using **marko** with GitHub Flavoured Markdown (GFM) enabled — this is what makes pipe tables render correctly.

The registry is cached in-process. To make a new doc appear without restarting:
1. Drop a `.md` file into `backend/docs/` (with valid YAML front-matter).
2. Call `GET /api/docs/refresh` (or restart the backend container).

---

## Backend Module Layout

```
backend/
├── main.py                  # FastAPI app factory, router registration, lifespan events
├── celery_app.py            # Celery application instance
├── database.py              # SQLAlchemy engine, session maker
├── models.py                # ORM table definitions
├── crawl/                   # Crawl job API (router, schemas, core logic)
├── datasets/                # Dataset listing, upload, preview API
├── ml_training/             # ML training job API and training logic
├── workflows/               # Workflow builder and execution engine
├── documentation/           # Docs registry service and router
├── monitoring/              # Health check endpoints
└── docs/                    # Markdown source files (this directory)
```

---

## Adding a New API Module

1. Create a directory under `backend/` — e.g. `backend/my_module/`.
2. Add the standard files:

```
my_module/
├── __init__.py
├── router.py      # APIRouter with your endpoints
├── schemas.py     # Pydantic request/response models
└── core.py        # Business logic (no FastAPI imports here)
```

3. Register the router in `backend/main.py`:

```python
from my_module.router import router as my_router
app.include_router(my_router, prefix="/api/my-module", tags=["My Module"])
```

4. Apply the change:
   - **Docker:** `docker compose up --build backend`
   - **Local:** The Uvicorn `--reload` flag will pick it up automatically.

---

## Network & Security

All services share the `scraper_network` Docker bridge. No service ports (except the frontend on 3000 and backend on 8000) are exposed to the host by default. The backend container has a `host.docker.internal` extra-host entry so it can reach services on the Docker host machine if needed.

The platform currently has **no authentication** and is intended for local/private network use only. Do not expose port 8000 to the public internet without adding an auth layer.
