import json
import redis.asyncio as redis
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .schemas import CrawlRequest
from config import Config
from tasks import run_crawl_task

app = FastAPI()
cfg = Config()

@app.get("/")
def get_root():
    return {"Backend is running"}

@app.get("/health/redis")
async def get_redis_health_check():
    try:
        r = await redis.Redis(host=cfg.REDIS_HOST, port=6379, decode_responses=True)
        await r.ping()
        return {"redis": "connected", "postgres": "check console"}
    except Exception as e:
        return {"error": str(e)}
    
@app.post("/crawl")
async def send_crawl_task(config_request: CrawlRequest):
    json_config = config_request.model_dump()
    
    result = run_crawl_task.delay(json_config)
    asyncio.create_task(monitor_crawl_events())

    return {f"started crawl job": result.id}

@app.get("/crawl/monitor")
async def monitor_crawl_events():
    async_r = await redis.from_url(f"redis://{cfg.REDIS_HOST}:6379", decode_responses=True)
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