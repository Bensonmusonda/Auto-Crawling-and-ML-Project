import os
import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import redis.asyncio as redis

router = APIRouter(tags=["websockets"])

REDIS_HOST = os.getenv("REDIS_HOST", "redis")


@router.websocket("/websocket")
async def websocket_endpoint(websocket: WebSocket):
    """Simple echo + heartbeat. Used for connection testing."""
    a = 0
    await websocket.accept()
    try:
        data = await websocket.receive_text()
        await websocket.send_text(f"You said: '{data}'")
        while True:
            await websocket.send_text(f"seconds since connection: {a}")
            await asyncio.sleep(1)
            a += 1
    except WebSocketDisconnect:
        print("Client disconnected")


@router.websocket("/websocket/crawl_events")
async def rt_crawl_events(websocket: WebSocket):
    """
    Real-time event stream for a specific job.

    Protocol:
      1. Client connects.
      2. Client sends a job_id string (or "*" to receive all events).
      3. Server filters Redis crawl_events and forwards only matching messages.
    """
    await websocket.accept()

    # Wait for the client to identify which job it wants to track.
    try:
        job_id = await websocket.receive_text()
        job_id = job_id.strip()
    except WebSocketDisconnect:
        return

    print(f"[WS] Listening for job_id='{job_id}'")

    async_r = await redis.from_url(
        f"redis://{REDIS_HOST}:6379", decode_responses=True
    )
    pubsub = async_r.pubsub()
    await pubsub.subscribe("crawl_events")

    try:
        async for message in pubsub.listen():
            if not message or message["type"] != "message":
                continue

            # Forward unfiltered if client requested all events
            if job_id == "*":
                await websocket.send_text(message["data"])
                continue

            # Otherwise only forward events that match the requested job_id
            try:
                data = json.loads(message["data"])
            except (json.JSONDecodeError, TypeError):
                continue

            if data.get("job_id") == job_id:
                await websocket.send_text(message["data"])

    except WebSocketDisconnect:
        print(f"[WS] Client disconnected (job_id='{job_id}')")
    finally:
        await pubsub.unsubscribe("crawl_events")
        await pubsub.close()
        await async_r.aclose()