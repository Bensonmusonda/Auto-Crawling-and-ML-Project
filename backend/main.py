from fastapi import FastAPI
import redis

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