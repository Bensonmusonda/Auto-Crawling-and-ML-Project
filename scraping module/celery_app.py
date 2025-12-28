import os
from celery import Celery

REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")

print(f"--- DEBUG: Celery connecting to Redis at: {REDIS_HOST} ---")

app = Celery(
    "scraper",
    broker=f"redis://{REDIS_HOST}:6379/0",
    backend=f"redis://{REDIS_HOST}:6379/1"
)

app.conf.update(
    broker_connection_retry_on_startup=True,
    worker_max_tasks_per_child=1,
    worker_prefetch_multiplier=1,
)