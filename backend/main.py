import json
import redis.asyncio as redis
import asyncio
import pandas as pd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import io
import psycopg
from psycopg.rows import dict_row
from celery import Celery

from schemas import CrawlRequest
import os

app = FastAPI()

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