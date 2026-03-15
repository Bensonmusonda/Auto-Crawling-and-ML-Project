import json
import redis.asyncio as redis
import asyncio
import pandas as pd
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import io
import psycopg
from psycopg.rows import dict_row
from celery import Celery
import glob
from datetime import datetime

from fastapi.middleware.cors import CORSMiddleware

from schemas import CrawlRequest
from schemas import PipelineConfig
from ml_processor.core import UniversalEngine
from processed_router import router as processed_router

from ml_training_router import router as ml_training_router

import os

app = FastAPI(title="Data Acquisition & ML Platform")

origins = [
    "http://localhost:5500",
    "https://www.yourapp.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ml_training_router)

from config_router import router as config_router
app.include_router(config_router)


REDIS_HOST = os.getenv("REDIS_HOST", "redis")
DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

CSV_DATASET_DIR = "/app/datasets"

celery_app = Celery(
    'scraper',
    broker=f'redis://{REDIS_HOST}:6379/0',
    backend=f'redis://{REDIS_HOST}:6379/1'
)

@app.get("/api/")
def get_root():
    return {"Backend is running"}

@app.get("/api/health/redis")
async def get_redis_health_check():
    try:
        r = await redis.Redis(host=REDIS_HOST, port=6379, decode_responses=True)
        await r.ping()
        return {"redis": "connected", "postgres": "check console"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/crawl")
async def send_crawl_task(config_request: CrawlRequest):
    json_config = config_request.model_dump()

    result = celery_app.send_task('tasks.run_crawl_task', args=(json_config,))

    # Save crawl config for workflow pre-filling
    async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS crawl_jobs (
                    job_id VARCHAR(255) PRIMARY KEY,
                    dataset_name VARCHAR(255),
                    config JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            await cur.execute("""
                INSERT INTO crawl_jobs (job_id, dataset_name, config)
                VALUES (%s, %s, %s)
                ON CONFLICT (job_id) DO NOTHING
            """, (result.id, config_request.dataset_name, json.dumps(json_config)))
            await conn.commit()

    asyncio.create_task(monitor_crawl_events())
    return {"started crawl job": result.id}


@app.get("/api/crawl/configs/{dataset_name}")
async def get_crawl_configs(dataset_name: str):
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT job_id, dataset_name, config, created_at
                FROM crawl_jobs
                WHERE dataset_name = %s
                ORDER BY created_at DESC
                LIMIT 10
            """, (dataset_name,))
            return await cur.fetchall()

@app.get("/api/crawl/monitor")
async def monitor_crawl_events():
    print(f"Connecting toredis://{REDIS_HOST}:6379")
    async_r = await redis.from_url(f"redis://{REDIS_HOST}:6379", decode_responses=True)
    pubsub = async_r.pubsub()
    await pubsub.subscribe("crawl_events")
    
    try:
        async for message in pubsub.listen():
            if message and message['type'] == 'message':
                print(f"Event: {message['data']}")
    finally:
        await pubsub.close()

@app.websocket("/websocket")
async def websocket_endpoint(websocket: WebSocket):
    a = 0
    await websocket.accept()
    try:
        data = await websocket.receive_text()
        await websocket.send_text(f"You said: '{data}'")
        while True:
            await websocket.send_text(f"seconds since connection: {a}")
            await asyncio.sleep(1)
            a = a + 1
    except WebSocketDisconnect:
        print("Client disconnected")

@app.websocket("/websocket/crawl_events")
async def rt_crawl_events(websocket: WebSocket):
    await websocket.accept()

    async_r = await redis.from_url(f"redis://{REDIS_HOST}:6379", decode_responses=True)
    pubsub = async_r.pubsub()
    await pubsub.subscribe("crawl_events")

    try:
        # job_id = await websocket.receive_text()
        # print(f"[JOB ID: {job_id}] Listening for events...")

        async for message in pubsub.listen():
            if message and message['type'] == 'message':
                await websocket.send_text(f"{message['data']}")
    except WebSocketDisconnect:
        print("Client disconnected")
    finally:
        pubsub.close()

async def ensure_app_config_table(conn):
    async with conn.cursor() as cur:
        await cur.execute("""
            CREATE TABLE IF NOT EXISTS app_config (
                key VARCHAR(100) PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        # Seed tough_sites if not present
        await cur.execute("""
            INSERT INTO app_config (key, value)
            VALUES ('tough_sites', '["amazon.com", "ebay.com", "walmart.com", "worldometers.info"]'::jsonb)
            ON CONFLICT (key) DO NOTHING;
        """)
        await conn.commit()


@app.get("/api/crawl/jobs")
async def get_crawl_jobs():
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT
                    job_id,
                    dataset_name,
                    COUNT(*)              AS item_count,
                    MIN(created_at)       AS started_at,
                    MAX(created_at)       AS last_seen_at
                FROM scraped_items
                WHERE job_id IS NOT NULL
                GROUP BY job_id, dataset_name
                ORDER BY MAX(created_at) DESC
                LIMIT 100
            """)
            return await cur.fetchall()


@app.get("/api/crawl/tough-sites")
async def get_tough_sites():
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        await ensure_app_config_table(conn)
        async with conn.cursor() as cur:
            await cur.execute("SELECT value FROM app_config WHERE key = 'tough_sites'")
            row = await cur.fetchone()
            return {"tough_sites": row["value"] if row else []}


@app.post("/api/crawl/tough-sites")
async def update_tough_sites(payload: dict):
    sites = payload.get("tough_sites", [])
    if not isinstance(sites, list):
        raise HTTPException(400, "tough_sites must be a list")
    async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
        await ensure_app_config_table(conn)
        async with conn.cursor() as cur:
            await cur.execute("""
                INSERT INTO app_config (key, value, updated_at)
                VALUES ('tough_sites', %s::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value,
                        updated_at = NOW()
            """, (json.dumps(sites),))
            await conn.commit()
    return {"status": "updated", "tough_sites": sites}

""" 
CSV Endpoints
"""
@app.get("/api/generate/csv")
async def generate_csv(dataset_name: str):
    connection = None
    try:
        print(f"Connecting to: {DATABASE_URL}")
        
        connection = await psycopg.AsyncConnection.connect(
            conninfo=DATABASE_URL,
            connect_timeout=10
        )
        
        async with connection.cursor() as cur:
            query = "SELECT data FROM scraped_items WHERE dataset_name = %s;"
            await cur.execute(query, (dataset_name,))
            records = await cur.fetchall()

            rows = [row[0] for row in records]
        
        if not rows:
            raise HTTPException(status_code=404, detail="Dataset not found")

        df = pd.DataFrame(rows)
        stream = io.StringIO()
        df.to_csv(stream, index=False, encoding="utf-8-sig")

        response = StreamingResponse( 
            iter([stream.getvalue()]),
            media_type="text/csv"
        )

        response.headers["Content-Disposition"] = f"attachment; filename={dataset_name}.csv"
        return response

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        if connection:
            await connection.close()

@app.post("/api/datasets/save-csv")
async def save_csv_to_dir(dataset_name: str):
    os.makedirs(CSV_DATASET_DIR, exist_ok=True)
    connection = None
    try:
        connection = await psycopg.AsyncConnection.connect(
            conninfo=DATABASE_URL, connect_timeout=10
        )
        async with connection.cursor() as cur:
            await cur.execute(
                "SELECT data FROM scraped_items WHERE dataset_name = %s;",
                (dataset_name,)
            )
            records = await cur.fetchall()

        if not records:
            raise HTTPException(status_code=404, detail="Dataset not found or empty")

        rows = [row[0] for row in records]
        df = pd.DataFrame(rows)
        path = os.path.join(CSV_DATASET_DIR, f"{dataset_name}.csv")
        df.to_csv(path, index=False, encoding="utf-8-sig")

        return {"status": "saved", "path": path, "rows": len(rows)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if connection:
            await connection.close()


@app.get("/api/datasets/csv-list")
def list_csv_datasets():
    os.makedirs(CSV_DATASET_DIR, exist_ok=True)
    files = glob.glob(os.path.join(CSV_DATASET_DIR, "*.csv"))
    return [
        {
            "name": os.path.splitext(os.path.basename(f))[0],
            "path": f,
            "size_kb": round(os.path.getsize(f) / 1024, 1),
            "modified": os.path.getmtime(f)
        }
        for f in sorted(files)
    ]

@app.get("/api/datasets/csv-columns")
def get_csv_columns(path: str):
    if not os.path.exists(path):
        raise HTTPException(404, "CSV file not found")
    try:
        df = pd.read_csv(path, nrows=0)  # read only header row
        return {"columns": list(df.columns)}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/process")
async def process_dataset(request: PipelineConfig):
    try:
        task = celery_app.send_task(
            'tasks.run_ml_pipeline', 
            args=[request.dataset_name, [step.model_dump() for step in request.steps], request.source],
            queue='ml_tasks'
        )
        
        return {
            "message": "Processing started",
            "job_id": task.id,
            "dataset": request.dataset_name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload_temp_csv")
async def upload_temp_csv(payload: dict):
    name = payload.get("dataset_name")
    csv_content = payload.get("csv")

    if not name or not csv_content:
        raise HTTPException(400, detail="Missing dataset_name or csv content")

    try:
        df = pd.read_csv(io.StringIO(csv_content))

        df = df.replace([np.nan, np.inf, -np.inf], None)

        records = df.to_dict(orient="records") 

        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            async with conn.cursor() as cur:
                for record in records:
                    await cur.execute(
                        """
                        INSERT INTO scraped_items (dataset_name, data)
                        VALUES (%s, %s)
                        """,
                        (name, json.dumps(record))
                    )
                await conn.commit()

        return {"status": "stored", "dataset": name, "row_count": len(records)}

    except Exception as e:
        raise HTTPException(400, detail=f"Processing failed: {str(e)}")


@app.get("/api/datasets/list")
async def list_datasets():
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT 
                    dataset_name as source_dataset,
                    COUNT(*) AS row_count
                FROM scraped_items
                GROUP BY dataset_name
                ORDER BY dataset_name ASC
            """)
            results = await cur.fetchall()
            return results

@app.get("/api/processed/list")
async def list_processed():
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT 
                    MIN(id) AS representative_id,          -- Use for changes/preview links
                    source_dataset,
                    operations_applied,
                    COUNT(*) AS row_count,
                    MIN(processed_at) AS processed_at,
                    MAX(processed_at) AS last_updated
                FROM processed_items
                GROUP BY 
                    source_dataset,
                    operations_applied,
                    DATE_TRUNC('minute', processed_at)     -- Group runs within the same minute
                ORDER BY processed_at DESC
            """)
            results = await cur.fetchall()
            return results

@app.get("/api/processed/csv/{source_name}")
async def get_processed_csv(source_name: str):
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT data FROM processed_items WHERE source_dataset = %s",
                (source_name,)
            )
            rows = [r[0] for r in cur.fetchall()]
            if not rows:
                raise HTTPException(404, "Not found")
            
            df = pd.DataFrame(rows)
            output = io.StringIO()
            df.to_csv(output, index=False)
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=processed_{source_name}.csv"}
            )

app.include_router(processed_router)

"""
Worflows
"""
# ── Workflow table helper ───────────────────────────────────
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


# ── Workflow endpoints ──────────────────────────────────────
@app.post("/api/workflows")
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


@app.get("/api/workflows")
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


@app.get("/api/workflows/{workflow_id}")
async def get_workflow(workflow_id: int):
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT * FROM workflows WHERE id = %s", (workflow_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "Workflow not found")
            return row


@app.put("/api/workflows/{workflow_id}")
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


@app.delete("/api/workflows/{workflow_id}")
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


@app.post("/api/workflows/{workflow_id}/run")
async def run_workflow(workflow_id: int):
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


@app.get("/api/workflows/{workflow_id}/history")
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