---
title: Workflows Guide
slug: workflows-guide
category: Guides
description: Build and run multi-stage automated pipelines that combine crawling, processing, and ML training end-to-end.
---

# Workflows Guide

Workflows allow you to chain multiple operations into a single automated pipeline that runs start-to-finish with one click: **scrape → process → train**. This guide explains how to build, run, and monitor workflows, as well as best practices for making them reliable.

---

## What is a Workflow?

A workflow is an ordered sequence of **stages**, where each stage is one of three types:

| Stage Type | What It Does | Output |
|------------|-------------|--------|
| `crawl` | Runs a web scraping job at a configured URL and saves the result as a raw dataset | A CSV file in `/app/datasets/` |
| `process` | Applies a sequence of data cleaning and transformation operations to an input dataset | A new CSV file in `/app/datasets/processed/` |
| `train` | Trains an ML model on a processed dataset and saves the result | A `.joblib` model file in `/app/models/` |

Stages execute **sequentially** in the order you define them. Each stage's output is automatically passed as the input to the next stage. If any stage fails, the workflow stops and reports the error inline — subsequent stages do not run.

---

## Creating a Workflow

1. Open the **Workflows** tab in the sidebar.
2. Click **New Workflow** in the top-right corner.
3. Enter a name for the workflow (e.g. `steam_games_weekly`).
4. Click **+ Add Stage** to append a stage. Configure each stage's parameters (see the field descriptions below for each type).
5. Reorder stages by dragging them if needed.
6. Click **Save** to store the workflow. It will appear in the workflows list.

### Crawl Stage Parameters

| Field | Description |
|-------|-------------|
| **Target URL** | Root page to begin crawling from |
| **Dataset Name** | Output CSV filename (without extension) |
| **Max Pages** | Maximum number of pages to visit |

### Process Stage Parameters

| Field | Description |
|-------|-------------|
| **Input Dataset** | The dataset to process (should be the output of the preceding crawl stage) |
| **Output Dataset Name** | Filename for the processed result |
| **Operations** | Ordered list of processing operations to apply (same options as the Data Processing tab) |

### Train Stage Parameters

| Field | Description |
|-------|-------------|
| **Dataset** | The processed dataset to train on |
| **Target Column** | Column the model should predict |
| **Model Type** | Algorithm to use (`random_forest`, `gradient_boosting`, etc.) |
| **Hyperparameters** | Model-specific settings (n_estimators, max_depth, etc.) |

---

## Running a Workflow

Click **Run** next to any saved workflow in the list. The workflow engine:

1. Validates each stage's configuration before starting.
2. Dispatches stage 1 as a Celery task and waits for it to complete.
3. Dispatches stage 2 with the output of stage 1 passed as input.
4. Continues until all stages complete or one fails.
5. Updates the workflow status to `completed` or `failed`.

The **Workflows** card expands during a run to show per-stage status indicators:

| Status | Meaning |
|--------|---------|
| `pending` | Waiting for the previous stage to finish |
| `running` | Currently executing in the Celery worker |
| `completed` | Finished successfully |
| `failed` | Encountered an error — see the error message inline |

---

## Monitoring Progress

Real-time progress events stream directly into the Workflows tab via the same WebSocket connection used by the Crawl Monitor. You don't need to stay on the tab — the state is preserved. If you navigate away and come back, the current status is fetched from the backend.

The **Crawl Monitor** event log also shows workflow events, since both share the same WebSocket channel. This is useful if you want a more detailed message-by-message view of what the crawling stage is doing.

---

## Real-Time Event Format

WebSocket messages for workflow stages follow this shape:

```json
{
  "job_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "workflow_id": "a1b2c3d4-dead-beef-cafe-feeddeadbeef",
  "workflow_name": "steam_games_weekly",
  "stage": "crawl",
  "stage_index": 0,
  "status": "completed",
  "event": "stage_done",
  "output": "steam_games_v1_raw.csv"
}
```

| Field | Description |
|-------|-------------|
| `job_id` | ID of the individual Celery task for this stage |
| `workflow_id` | ID of the workflow run |
| `stage` | Stage type (`crawl`, `process`, `train`) |
| `stage_index` | Zero-based position in the workflow |
| `status` | Stage status at the time of the event |
| `output` | Name of the output file produced by this stage (if applicable) |

---

## Best Practices

### Naming Conventions

Use a consistent, readable naming convention so stages can locate each other's output without ambiguity:

```
<project>_raw         →  crawl stage output
<project>_clean       →  process stage output
<project>_model       →  train stage output (model filename)
```

Example for a Steam dataset pipeline:
- Crawl output: `steam_games_raw`
- Process output: `steam_games_clean`
- Model: `steam_games_model`

### Test Each Stage Independently First

Before building a workflow, verify each stage works in isolation:

1. Run a manual crawl in the Crawl Monitor. Inspect the output CSV.
2. Apply processing operations in the Data Processing tab. Check the column types and value ranges.
3. Train a model manually in the ML Training tab. Confirm the R² score is reasonable.

Only then assemble the workflow. This saves time because debugging a failing stage inside a workflow is harder than debugging it in isolation.

### Idempotency

Running the same workflow twice **overwrites** the output files from the previous run (same filenames, same paths). This is intentional — workflows are designed to be run on a schedule (e.g. once a week) to refresh data and retrain models automatically.

If you want to preserve the output from a previous run, rename the output files before re-running, or change the dataset name in the workflow configuration.

### Handling Failures

If a stage fails:
1. Read the error message displayed inline on the stage card — it shows the exception from the Celery worker.
2. Reproduce the failure manually (run the same operation in the Crawl Monitor or Data Processing tab with the same parameters).
3. Fix the configuration (e.g. adjust the target URL, or change a processing operation).
4. Update the workflow and click **Run** again. Completed stages will re-run from the beginning.

> There is currently no checkpoint/resume mechanism. All stages re-run when you click **Run**, even if earlier stages succeeded on a previous attempt.
