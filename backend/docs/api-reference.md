---
title: API Reference
slug: api-reference
category: Technical
description: Complete reference for all REST endpoints and WebSocket connections exposed by the Data Platform backend.
---

# API Reference

This document is the complete reference for all endpoints provided by the **Data Acquisition & ML Platform** backend. The base URL for all HTTP endpoints is `http://localhost:8000`. The interactive Swagger UI is available at `http://localhost:8000/docs`.

---

## Authentication

The platform currently operates **without authentication** for local development. All endpoints are open. Do not expose the backend port to a public network without adding an authentication layer (e.g. JWT middleware or an API gateway).

---

## Health Checks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/` | API root — returns version info and confirms the backend is running |
| `GET` | `/api/health/redis` | Checks Redis connectivity — returns `{"status": "ok"}` or an error |

These are useful for container health check configuration in `docker-compose.yaml` and for verifying setup after deployment.

---

## Datasets

### `GET /api/datasets`

Returns a list of all CSV datasets available in `/app/datasets/` and its subdirectories.

**Response:**

```json
[
  {
    "name": "steam_games_v1_raw.csv",
    "rows": 4200,
    "columns": 18,
    "size_bytes": 233692,
    "path": "steam_games_v1_raw.csv"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Filename including any subdirectory prefix |
| `rows` | integer | Number of data rows (excluding header) |
| `columns` | integer | Number of columns |
| `size_bytes` | integer | File size on disk in bytes |
| `path` | string | Relative path from `/app/datasets/` |

---

### `GET /api/datasets/{filename}/preview`

Returns the first N rows of a dataset for display in the Dataset Explorer.

**Query Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `rows` | `100` | Number of rows to return |

**Response:**

```json
{
  "columns": ["name", "price", "rating"],
  "dtypes": {"name": "object", "price": "float64", "rating": "float64"},
  "data": [
    {"name": "Half-Life: Alyx", "price": 49.99, "rating": 4.8}
  ],
  "total_rows": 4200
}
```

---

### `POST /api/datasets/upload`

Upload a new CSV file as a dataset.

**Body:** `multipart/form-data` with a single `file` field containing the CSV.

**Response:**

```json
{
  "filename": "my_data.csv",
  "rows": 1500,
  "columns": 12
}
```

**Error responses:**

| Status | Reason |
|--------|--------|
| `400` | File is not a valid CSV, or the file is empty |
| `413` | File exceeds the configured upload size limit |

---

## Crawling

### `POST /api/crawl/start`

Start a new crawl job. The job is dispatched asynchronously to the Celery worker.

**Request Body:**

```json
{
  "url": "https://store.steampowered.com/search/?sort_by=Reviews_DESC",
  "dataset_name": "steam_games_v1",
  "max_pages": 50
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Root URL for the spider to begin crawling |
| `dataset_name` | string | Yes | Output filename (without `.csv` extension) |
| `max_pages` | integer | No (default: 50) | Maximum pages the spider will visit |

**Response:**

```json
{
  "job_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "status": "started",
  "dataset_name": "steam_games_v1"
}
```

---

### `GET /api/crawl/jobs`

Returns all crawl jobs and their current status.

**Response:**

```json
[
  {
    "job_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "url": "https://store.steampowered.com",
    "dataset_name": "steam_games_v1",
    "status": "completed",
    "pages_crawled": 47,
    "items_scraped": 940,
    "created_at": "2024-03-01T10:30:00Z",
    "updated_at": "2024-03-01T10:34:22Z"
  }
]
```

**Job statuses:** `queued` → `running` → `completed` or `failed`

---

### `GET /api/crawl/jobs/{job_id}`

Returns the full record for a single crawl job, including any error message if it failed.

---

## Data Processing

### `POST /api/datasets/process`

Apply a sequence of processing operations to a dataset and save the result as a new file.

**Request Body:**

```json
{
  "input_dataset": "steam_games_v1_raw.csv",
  "output_name": "steam_games_v1_clean",
  "operations": [
    { "op": "drop_duplicates" },
    { "op": "extract_number", "column": "price" },
    { "op": "fill_missing_median", "column": "price" },
    { "op": "drop_missing" },
    { "op": "standardise", "column": "price" }
  ]
}
```

**Supported operations:**

| `op` value | Extra Fields | Description |
|------------|-------------|-------------|
| `drop_duplicates` | — | Remove exact duplicate rows |
| `drop_missing` | — | Remove rows with any null value |
| `fill_missing_mean` | `column` | Fill nulls with column mean |
| `fill_missing_median` | `column` | Fill nulls with column median |
| `extract_number` | `column` | Strip non-numeric characters from a text column |
| `label_encode` | `column` | Convert string categories to integers |
| `one_hot_encode` | `column` | Expand string categories into binary indicator columns |
| `normalise` | `column` | Min-Max scale to 0–1 range |
| `standardise` | `column` | Z-score scale to mean=0, std=1 |
| `log_transform` | `column` | Apply `log1p` to a numeric column |
| `bin_column` | `column`, `bins` | Discretise a numeric column into `bins` equal-width buckets |

**Response:**

```json
{
  "output_dataset": "steam_games_v1_clean.csv",
  "rows": 3950,
  "columns": 22
}
```

---

## ML Training

### `POST /api/ml-training/train`

Queue an ML training job. The job runs asynchronously on the `ml_tasks` Celery queue.

**Request Body:**

```json
{
  "dataset": "steam_games_v1_clean.csv",
  "target_column": "popularity_score",
  "model_type": "random_forest",
  "test_size": 0.2,
  "hyperparameters": {
    "n_estimators": 200,
    "max_depth": null
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dataset` | string | — | CSV filename to train on |
| `target_column` | string | — | Column to predict |
| `model_type` | string | `"random_forest"` | One of: `random_forest`, `gradient_boosting`, `linear_regression`, `ridge`, `svr` |
| `test_size` | float | `0.2` | Fraction of data used for evaluation (0.05–0.5) |
| `hyperparameters` | object | `{}` | Model-specific parameters |

**Response:**

```json
{
  "job_id": "a1b2c3d4-dead-beef-cafe-feeddeadbeef",
  "status": "queued"
}
```

---

### `GET /api/ml-training/results/{job_id}`

Returns the metrics and model file path for a completed training job.

**Response:**

```json
{
  "job_id": "a1b2c3d4-dead-beef-cafe-feeddeadbeef",
  "status": "completed",
  "model_type": "random_forest",
  "metrics": {
    "r2": 0.847,
    "mae": 12.3,
    "rmse": 18.7
  },
  "feature_importances": {
    "review_count": 0.41,
    "price": 0.23,
    "release_year": 0.18,
    "rating": 0.12,
    "tags_count": 0.06
  },
  "model_path": "/app/models/steam_games_random_forest_a1b2c3d4.joblib"
}
```

---

### `POST /api/ml-training/predict`

Run a single prediction using a saved model.

**Request Body:**

```json
{
  "model_path": "/app/models/steam_games_random_forest_a1b2c3d4.joblib",
  "features": {
    "review_count": 5000,
    "price": 19.99,
    "release_year": 2023,
    "rating": 4.5,
    "tags_count": 8
  }
}
```

**Response:**

```json
{
  "prediction": 284.7
}
```

---

## Documentation

### `GET /api/docs`

Returns the metadata list of all documentation files registered in the docs registry. Does not include the HTML body — use the slug endpoint to retrieve the rendered content of a specific doc.

**Response:**

```json
[
  {
    "slug": "getting-started",
    "title": "Getting Started",
    "category": "Guides",
    "description": "Set up and run the platform locally in under 10 minutes."
  }
]
```

---

### `GET /api/docs/{slug}`

Returns the full content (including rendered HTML) for a single documentation page.

**Response:**

```json
{
  "slug": "getting-started",
  "title": "Getting Started",
  "category": "Guides",
  "description": "...",
  "html": "<h1>Getting Started</h1><p>...</p>"
}
```

The `html` field contains the Markdown body rendered to HTML with GitHub Flavoured Markdown (GFM) extensions enabled — including table support.

---

## WebSocket

### `ws://localhost:8000/websocket/crawl_events`

A persistent WebSocket connection used for real-time job progress updates. Both crawl jobs and workflow stages publish events to this channel.

**Connection:**

After connecting, send `*` to subscribe to all events:

```
→ *
← {"type": "subscribed", "channel": "*"}
```

**Event shape (crawl progress):**

```json
{
  "job_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "event": "progress",
  "data": {
    "pages_crawled": 12,
    "items_scraped": 340,
    "status": "running"
  }
}
```

**Event shape (workflow stage):**

```json
{
  "job_id": "uuid",
  "workflow_id": "uuid",
  "stage": "crawl",
  "stage_index": 0,
  "status": "completed",
  "event": "stage_done"
}
```

The frontend reconnects automatically on disconnect (every 3 seconds). The sidebar WebSocket indicator reflects the current connection state.
