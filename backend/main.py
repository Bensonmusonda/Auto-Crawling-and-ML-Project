import redis
from fastapi import FastAPI

from schemas import CrawlRequest

app = FastAPI()

@app.get("/")
def get_root():
    return {"Backend is running"}

@app.get("/health/redis")
def get_redis_health_check():
    try:
        r = redis.Redis(host='localhost', port=6379, decode_responses=True)
        r.ping()
        return {"redis": "connected", "postgres": "check console"}
    except Exception as e:
        return {"error": str(e)}
    
@app.post("/crawl")
def send_crawl_task(json_config: CrawlRequest):
    return {
        "job_id": json_config.job_id,
        "crawl type":
        json_config.crawl_type, "status": "starting"
    }