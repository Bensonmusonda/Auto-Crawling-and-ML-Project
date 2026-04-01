import os
import json
import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException

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
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            await conn.commit()

@router.post("")
async def create_workflow(payload: dict):
    await ensure_workflows_table()
    name = payload.get('name')
    dataset_name = payload.get('dataset_name')
    stages = payload.get('stages')

    if not all([name, dataset_name, stages]):
        raise HTTPException(400, "name, dataset_name and stages are required")

    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                INSERT INTO workflows (name, dataset_name, stages)
                VALUES (%s, %s, %s)
                RETURNING id, name, dataset_name, stages, last_run_at, last_run_status, created_at
            """, (name, dataset_name, json.dumps(stages)))
            row = await cur.fetchone()
            await conn.commit()
            return row


@router.get("")
async def list_workflows():
    await ensure_workflows_table()
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT id, name, dataset_name, stages,
                       last_run_at, last_run_status, created_at
                FROM workflows ORDER BY created_at DESC
            """)
            return await cur.fetchall()


@router.get("/{workflow_id}")
async def get_workflow(workflow_id: int):
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT * FROM workflows WHERE id = %s", (workflow_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "Workflow not found")
            return row


@router.put("/{workflow_id}")
async def update_workflow(workflow_id: int, payload: dict):
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                UPDATE workflows
                SET name = COALESCE(%s, name),
                    dataset_name = COALESCE(%s, dataset_name),
                    stages = COALESCE(%s::jsonb, stages)
                WHERE id = %s
                RETURNING *
            """, (
                payload.get('name'),
                payload.get('dataset_name'),
                json.dumps(payload['stages']) if 'stages' in payload else None,
                workflow_id
            ))
            row = await cur.fetchone()
            await conn.commit()
            if not row:
                raise HTTPException(404, "Workflow not found")
            return row


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: int):
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM workflows WHERE id = %s RETURNING id", (workflow_id,)
            )
            row = await cur.fetchone()
            await conn.commit()
            if not row:
                raise HTTPException(404, "Workflow not found")
            return {"deleted": workflow_id}


@router.post("/{workflow_id}/run")
async def run_workflow(workflow_id: int):
    from main import celery_app
    # Verify workflow exists
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT id, name FROM workflows WHERE id = %s", (workflow_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "Workflow not found")

    task = celery_app.send_task(
        'run_workflow',
        args=[workflow_id],
        queue='ml_tasks'
    )
    return {"job_id": task.id, "workflow_id": workflow_id, "status": "submitted"}


@router.get("/{workflow_id}/history")
async def get_workflow_history(workflow_id: int, limit: int = 5):
    """Return the last N run records for a workflow, newest first."""
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            # Ensure table exists (handles first request before any run)
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
            "run_id": row["run_id"],
            "status": row["status"],
            "crawl_job_id": row["crawl_job_id"],
            "model_job_id": row["model_job_id"],
            "output_csv": row["output_csv"],
            "stage_results": row["stage_results"],
            "started_at": row["started_at"].isoformat() if row["started_at"] else None,
            "finished_at": row["finished_at"].isoformat() if row["finished_at"] else None,
            "duration": duration,
        })

    return result
