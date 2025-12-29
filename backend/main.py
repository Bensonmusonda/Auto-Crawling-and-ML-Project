import json
import redis
from fastapi import FastAPI

from .schemas import CrawlRequest
from config import Config
from tasks import run_crawl_task

app = FastAPI()

@app.get("/")
def get_root():
    return {"Backend is running"}

@app.get("/health/redis")
def get_redis_health_check():
    try:
        r = redis.Redis(host=Config.REDIS_HOST, port=6379, decode_responses=True)
        r.ping()
        return {"redis": "connected", "postgres": "check console"}
    except Exception as e:
        return {"error": str(e)}
    
@app.post("/crawl")
def send_crawl_task(config_request: CrawlRequest):
    json_config = config_request.model_dump()
    
    result = run_crawl_task.delay(json_config)
    return {f"started crawl job": result.id}