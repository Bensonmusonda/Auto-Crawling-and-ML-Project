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
    asyncio.create_task(monitor_crawl_events())
    return {"started crawl job": result.id}

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

@app.post("/api/process")
async def process_dataset(request: PipelineConfig):
    try:
        task = celery_app.send_task(
            'tasks.run_ml_pipeline', 
            args=[request.dataset_name, [step.model_dump() for step in request.steps]],
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