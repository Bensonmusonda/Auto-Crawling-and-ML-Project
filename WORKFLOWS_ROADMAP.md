# Workflow Feature Roadmap

> **How to resume:** paste the relevant prompt from the [Prompts](#prompts) section at the bottom of this file into a new chat. The agent will read this file and pick up where we left off.

---

## Background Context

This project is a data platform for citizen data scientists and business analysts. It has three main modules:

- **Scraping** — Scrapy-based crawler controlled via the backend API, stores items in Postgres `scraped_items` table tagged with `job_id` and `dataset_name`.
- **Data Processing** — Pandas pipeline executed by a Celery worker (`tasks.py::run_ml_pipeline`). Strategies live in `backend/ml_processor/strategies.py`.
- **ML Training** — Celery worker (`tasks.py::run_model_training`), model registry in Postgres `model_registry` table, trained model files on disk.

**Workflows** are end-to-end saved pipelines that chain all three stages and can be re-run at the click of a button when new data is available (e.g. after a fresh scrape or an uploaded CSV).

Key files:
| File | Role |
|---|---|
| `backend/main.py` | FastAPI app + workflow CRUD endpoints |
| `backend/tasks.py` | Celery tasks: `run_ml_pipeline`, `run_model_training`, `run_workflow` |
| `backend/ml_processor/strategies.py` | Processing step implementations |
| `backend/ml_processor/registry.py` | Maps step IDs to strategy functions |
| `backend/schemas.py` | Pydantic models for API requests |
| `frontend/src/components/Workflows.jsx` | Workflow builder + list UI |
| `scraping module/crawler/crawler/pipelines.py` | Scrapy pipeline — writes items to Postgres |

---

## Decisions Made

- **Append, don't replace** — new crawl runs append rows to the existing dataset rather than truncating it. The first processing step should always be `remove_duplicates` to handle overlap between crawl runs.
- **CSV versioning** — named-slot approach: each workflow run writes `{dataset}/{run_id[:8]}.csv`; the latest clean output is also written to `{dataset}/latest.csv`. Keep last 5 snapshots (or 7 days), delete older ones automatically.
- **Run history is the anchor** — a `workflow_runs` table links everything together (crawl job_id → processed CSV path → trained model job_id). This is Phase 1.

---

## Phase Plan

### Phase 1 — Run History (foundation) `[x]`

> Everything else depends on this.

- [x] Add `workflow_runs` Postgres table
- [x] Update `run_workflow` Celery task to create and update a run record
- [x] Add `/api/workflows/{id}/history` endpoint
- [x] Show last N runs panel on each workflow card in `Workflows.jsx`

**Files changed:** `tasks.py`, `main.py`, `Workflows.jsx`

---

### Phase 2 — Data Correctness `[ ]`

- [ ] Scope `fetch_dataset` in workflow executor to only rows from the triggering crawl `job_id`
- [ ] Switch processed output to named-slot CSV paths (`{dataset}/{run_id[:8]}.csv` + `{dataset}/latest.csv`)
- [ ] Validate `target_column` against post-processing CSV columns before dispatching ML task — surface a clear error to the frontend if missing

**Files to change:** `tasks.py`, `schemas.py`

---

### Phase 3 — Crawl Reliability + Dedup `[ ]`

- [ ] Standardise crawl completion event keys between `backend/tasks.py` and `scraping module/tasks.py`
- [ ] Add dedup option to crawl stage — append mode with URL + content-hash dedup in `pipelines.py`
- [ ] Add shorter timeout + heartbeat to crawl wait loop in workflow executor

**Files to change:** `tasks.py` (both), `pipelines.py`, `Workflows.jsx`

---

### Phase 4 — UX + NLP Prep `[ ]`

- [ ] Run history diff view in the UI (compare metrics across runs)
- [ ] Add `text_columns` + `model_task` (`classification`, `regression`, `text_classification`, `ner`) to ML workflow config
- [ ] Add `clean_text`, `tokenize`, `tfidf_vectorize` to processing step registry

**Files to change:** `strategies.py`, `registry.py`, `Workflows.jsx`, `schemas.py`

---

## Progress Log

| Date       | Phase    | What was done                                                                                                                                                                                                                               |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-15 | Pre-work | Fixed `drop_nulls` param mismatch; `fetch_dataset` now reads CSVs when source=csv; other strategy param fixes                                                                                                                               |
| 2026-03-15 | Planning | Workflow analysis complete, phases agreed, this file created                                                                                                                                                                                |
| 2026-03-15 | Phase 1  | `workflow_runs` table + helpers added to `tasks.py`; `run_workflow` instrumented with per-stage tracking, job IDs, timestamps; `GET /api/workflows/{id}/history` added to `main.py`; collapsible run history panel added to `Workflows.jsx` |

---

## Prompts

Copy-paste these exactly into a new chat to resume work.

### Start next phase

```
Read WORKFLOWS_ROADMAP.md in the project root. Pick up the first uncompleted item in the earliest incomplete phase and implement it. Write an implementation plan first before touching any code.
```

### Complete a task and update roadmap

```
Mark the task we just completed as done in WORKFLOWS_ROADMAP.md (tick the checkbox and add a row to the progress log with today's date and a brief description of what was done).
```

### Check what's left

```
Read WORKFLOWS_ROADMAP.md and summarise which tasks are done and what the next step is.
```

### Explain a decision

```
Read WORKFLOWS_ROADMAP.md and explain the reasoning behind [decision name, e.g. "append vs replace"].
```

### Add a new idea to the roadmap

```
Read WORKFLOWS_ROADMAP.md and add a new task: [describe the task and which phase it belongs to].
```
