import os
import json
import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional

from db_utils import get_optional_user

router = APIRouter(prefix="/api/workflows", tags=["workflows"])

DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"


async def ensure_workflows_table():
    async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS workflows (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    dataset_name VARCHAR(255) NOT NULL,
                    stages JSONB NOT NULL,
                    last_run_at TIMESTAMP,
                    last_run_status VARCHAR(50),
                    owner_id INTEGER REFERENCES users(id),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            await conn.commit()


def _visibility_filter(user: Optional[dict]) -> tuple[str, list]:
    """
    Returns an SQL WHERE clause fragment and its bind values.
    - Admin  →  no filter (sees everything)
    - User   →  only their own rows
    - None   →  no rows
    """
    if not user:
        return "FALSE", []
    if user.get("is_admin"):
        return "TRUE", []
    return "w.owner_id = %s", [user["id"]]


@router.post("")
async def create_workflow(
    payload: dict,
    user: Optional[dict] = Depends(get_optional_user),
):
    await ensure_workflows_table()
    name         = payload.get("name")
    dataset_name = payload.get("dataset_name")
    stages       = payload.get("stages")

    if not all([name, dataset_name, stages]):
        raise HTTPException(400, "name, dataset_name and stages are required")

    owner_id = user["id"] if user else None

    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                INSERT INTO workflows (name, dataset_name, stages, owner_id)
                VALUES (%s, %s, %s, %s)
                RETURNING
                    id, name, dataset_name, stages,
                    last_run_at, last_run_status, created_at, owner_id
            """, (name, dataset_name, json.dumps(stages), owner_id))
            row = await cur.fetchone()
            await conn.commit()
            return row


@router.post("/from-past-runs")
async def create_workflow_from_past_runs(
    payload: dict,
    user: Optional[dict] = Depends(get_optional_user),
):
    """
    Creates a new workflow by stitching together configurations from past standalone jobs.
    """
    await ensure_workflows_table()
    name             = payload.get("name")
    dataset_name     = payload.get("dataset_name")
    stages_to_include = payload.get("stages_to_include", {})

    if not all([name, dataset_name]):
        raise HTTPException(400, "name and dataset_name are required")

    owner_id = user["id"] if user else None

    stages = {
        "crawl":      {"enabled": False, "config": {}},
        "processing": {"enabled": False, "config": {"steps": []}},
        "ml":         {"enabled": False, "config": {}},
    }

    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            # 1. Fetch Crawl Config
            crawl_id = stages_to_include.get("crawl_job_id")
            if crawl_id:
                await cur.execute(
                    "SELECT config FROM crawl_jobs WHERE job_id = %s", (crawl_id,)
                )
                row = await cur.fetchone()
                if row:
                    stages["crawl"]["enabled"] = True
                    stages["crawl"]["config"] = row["config"]
                else:
                    raise HTTPException(404, f"Crawl job {crawl_id} not found")

            # 2. Fetch Process Config
            proc_id = stages_to_include.get("process_job_id")
            if proc_id:
                await cur.execute(
                    "SELECT config FROM processing_jobs WHERE job_id = %s", (proc_id,)
                )
                row = await cur.fetchone()
                if row:
                    stages["processing"]["enabled"] = True
                    stages["processing"]["config"]["steps"] = row["config"]
                else:
                    # Fallback to querying processed_items using representative ID
                    try:
                        proc_id_int = int(proc_id)
                        await cur.execute("""
                            SELECT operations_applied FROM processed_items WHERE id = %s
                        """, (proc_id_int,))
                        row = await cur.fetchone()
                        if row:
                            stages["processing"]["enabled"] = True
                            stages["processing"]["config"]["steps"] = row["operations_applied"]
                        else:
                            raise HTTPException(404, f"Processing job {proc_id} not found")
                    except ValueError:
                        raise HTTPException(404, f"Processing job {proc_id} not found")


            # 3. Fetch Train Config
            train_id = stages_to_include.get("train_job_id")
            if train_id:
                await cur.execute("""
                    SELECT model_type, hyperparameters as params, target_column
                    FROM model_registry
                    WHERE job_id = %s
                """, (train_id,))
                row = await cur.fetchone()
                if row:
                    stages["ml"]["enabled"] = True
                    stages["ml"]["config"] = {
                        "model_type":    row["model_type"],
                        "target_column": row["target_column"],
                        "params":        row["params"],
                        "auto_tune":     False,
                    }
                else:
                    raise HTTPException(404, f"Training job {train_id} not found")

            if not any(s["enabled"] for s in stages.values()):
                raise HTTPException(
                    400,
                    "At least one valid job ID must be provided to create a workflow",
                )

            await cur.execute("""
                INSERT INTO workflows (name, dataset_name, stages, owner_id)
                VALUES (%s, %s, %s, %s)
                RETURNING
                    id, name, dataset_name, stages,
                    last_run_at, last_run_status, created_at, owner_id
            """, (name, dataset_name, json.dumps(stages), owner_id))

            created_row = await cur.fetchone()
            await conn.commit()
            return created_row


@router.get("")
async def list_workflows(
    user: Optional[dict] = Depends(get_optional_user),
):
    await ensure_workflows_table()
    where_clause, bind_vals = _visibility_filter(user)

    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(f"""
                SELECT
                    w.id, w.name, w.dataset_name, w.stages,
                    w.last_run_at, w.last_run_status, w.created_at,
                    w.owner_id, u.username AS owner_username
                FROM workflows w
                LEFT JOIN users u ON w.owner_id = u.id
                WHERE {where_clause}
                ORDER BY w.created_at DESC
            """, bind_vals)
            return await cur.fetchall()


# ── IMPORTANT: These specific-path routes MUST be registered before
# ── the /{workflow_id} wildcard, otherwise FastAPI will match the
# ── wildcard first and treat "configs" / "runs" as integer IDs.
@router.get("/configs/process/{dataset_name}")
async def get_workflow_processing_configs(
    dataset_name: str,
    user: Optional[dict] = Depends(get_optional_user),
):
    """
    Safely retrieve past processing configs from processed_items
    grouped by operations to support workflow creation.
    """
    if not user:
        return []

    is_admin = user.get("is_admin", False)

    if is_admin:
        owner_filter = "TRUE"
        params = [dataset_name]
    else:
        owner_filter = "(owner_id = %s OR owner_id = 1)"
        params = [dataset_name, user["id"]]

    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(f"""
                SELECT
                    MIN(id)               AS job_id,
                    source_dataset        AS dataset_name,
                    operations_applied    AS config,
                    MAX(processed_at)     AS created_at
                FROM processed_items
                WHERE source_dataset = %s AND {owner_filter}
                GROUP BY source_dataset, operations_applied
                ORDER BY created_at DESC
                LIMIT 10
            """, params)
            rows = await cur.fetchall()

    results = []
    for row in rows:
        cfg = row["config"]
        if isinstance(cfg, str):
            try:
                cfg = json.loads(cfg)
            except Exception:
                cfg = []
        results.append({
            "job_id":       str(row["job_id"]),
            "dataset_name": row["dataset_name"],
            "config":       cfg if isinstance(cfg, list) else [],
            "created_at":   row["created_at"].isoformat() if row["created_at"] else None,
        })
    return results


@router.get("/runs/{run_id}/stage-logs/{stage}")
async def get_stage_logs(run_id: str, stage: str):
    """Return all logs for a specific workflow run and stage."""
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT level, message, timestamp
                FROM workflow_logs
                WHERE run_id = %s AND stage = %s
                ORDER BY timestamp ASC
            """, (run_id, stage))
            rows = await cur.fetchall()

    logs = [
        {
            "level":     row["level"],
            "message":   row["message"],
            "timestamp": row["timestamp"].isoformat() if row["timestamp"] else None,
        }
        for row in rows
    ]
    return {"logs": logs}


@router.get("/{workflow_id}")
async def get_workflow(
    workflow_id: int,
    user: Optional[dict] = Depends(get_optional_user),
):
    where_clause, bind_vals = _visibility_filter(user)
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(f"""
                SELECT w.*, u.username AS owner_username
                FROM workflows w
                LEFT JOIN users u ON w.owner_id = u.id
                WHERE w.id = %s AND ({where_clause})
            """, [workflow_id] + bind_vals)
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "Workflow not found")
            return row


@router.put("/{workflow_id}")
async def update_workflow(
    workflow_id: int,
    payload: dict,
    user: Optional[dict] = Depends(get_optional_user),
):
    where_clause, bind_vals = _visibility_filter(user)
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(f"""
                UPDATE workflows
                SET name         = COALESCE(%s, name),
                    dataset_name = COALESCE(%s, dataset_name),
                    stages       = COALESCE(%s::jsonb, stages)
                WHERE id = %s AND ({where_clause})
                RETURNING *
            """, (
                payload.get("name"),
                payload.get("dataset_name"),
                json.dumps(payload["stages"]) if "stages" in payload else None,
                workflow_id,
                *bind_vals,
            ))
            row = await cur.fetchone()
            await conn.commit()
            if not row:
                raise HTTPException(404, "Workflow not found or access denied")
            return row


@router.delete("/{workflow_id}")
async def delete_workflow(
    workflow_id: int,
    user: Optional[dict] = Depends(get_optional_user),
):
    where_clause, bind_vals = _visibility_filter(user)
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(f"""
                DELETE FROM workflows
                WHERE id = %s AND ({where_clause})
                RETURNING id
            """, [workflow_id] + bind_vals)
            row = await cur.fetchone()
            await conn.commit()
            if not row:
                raise HTTPException(404, "Workflow not found or access denied")
            return {"deleted": workflow_id}


@router.post("/{workflow_id}/run")
async def run_workflow(
    workflow_id: int,
    user: Optional[dict] = Depends(get_optional_user),
):
    from tasks import celery_app
    where_clause, bind_vals = _visibility_filter(user)
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(f"""
                SELECT id, name FROM workflows
                WHERE id = %s AND ({where_clause})
            """, [workflow_id] + bind_vals)
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "Workflow not found or access denied")

    task = celery_app.send_task(
        "run_workflow",
        args=[workflow_id],
        kwargs={'owner_id': user["id"] if user else None},
        queue="ml_tasks",
    )
    return {"job_id": task.id, "workflow_id": workflow_id, "status": "submitted"}


@router.get("/{workflow_id}/history")
async def get_workflow_history(
    workflow_id: int,
    limit: int = 5,
    user: Optional[dict] = Depends(get_optional_user),
):
    """Return the last N run records for a workflow, newest first."""
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS workflow_runs (
                    id            SERIAL PRIMARY KEY,
                    run_id        VARCHAR(64) UNIQUE NOT NULL,
                    workflow_id   INTEGER NOT NULL,
                    status        VARCHAR(32) DEFAULT 'running',
                    crawl_job_id  VARCHAR(255),
                    model_job_id  VARCHAR(255),
                    output_csv    TEXT,
                    stage_results JSONB DEFAULT '{}',
                    started_at    TIMESTAMP DEFAULT NOW(),
                    finished_at   TIMESTAMP
                );
            """)
            await conn.commit()

            await cur.execute("""
                SELECT
                    run_id, workflow_id, status,
                    crawl_job_id, model_job_id, output_csv,
                    stage_results, started_at, finished_at
                FROM workflow_runs
                WHERE workflow_id = %s
                ORDER BY started_at DESC
                LIMIT %s
            """, (workflow_id, limit))

            rows = await cur.fetchall()

    result = []
    for row in rows:
        duration = None
        if row["started_at"] and row["finished_at"]:
            delta = row["finished_at"] - row["started_at"]
            total_seconds = int(delta.total_seconds())
            duration = f"{total_seconds // 60}m {total_seconds % 60}s"

        result.append({
            "run_id":        row["run_id"],
            "status":        row["status"],
            "crawl_job_id":  row["crawl_job_id"],
            "model_job_id":  row["model_job_id"],
            "output_csv":    row["output_csv"],
            "stage_results": row["stage_results"],
            "started_at":    row["started_at"].isoformat() if row["started_at"] else None,
            "finished_at":   row["finished_at"].isoformat() if row["finished_at"] else None,
            "duration":      duration,
        })

    return result



