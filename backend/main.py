import json
import redis.asyncio as redis
import asyncio
import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
import io
import psycopg
from psycopg.rows import dict_row
from celery import Celery
import glob
from datetime import datetime

from fastapi.middleware.cors import CORSMiddleware

from ml_processor.core import UniversalEngine

from schemas import CrawlRequest
from schemas import PipelineConfig

from processed_router import router as processed_router
from ml_training_router import router as ml_training_router
from config_router import router as config_router
from crawl_router import router as crawl_router
from dataset_router import router as dataset_router
from workflow_router import router as workflow_router
from websocket_router import router as websocket_router
from predict_router import router as predict_router
from documentation.router import router as docs_router
from documentation.core import build_registry
from auth_router import router as auth_router
from db_utils import run_ownership_migrations
from ai_router import router as ai_router


import os
from contextlib import asynccontextmanager
from fastapi.staticfiles import StaticFiles

@asynccontextmanager
async def lifespan(fastapi_app: FastAPI):
    # Build documentation registry at startup
    build_registry()
    # Add owner_id columns + create admin user + reassign legacy data
    run_ownership_migrations()
    yield

app = FastAPI(title="Data Acquisition & ML Platform", lifespan=lifespan)

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

app.include_router(auth_router)
app.include_router(ml_training_router)
app.include_router(config_router)
app.include_router(processed_router)
app.include_router(crawl_router)
app.include_router(dataset_router)
app.include_router(workflow_router)
app.include_router(websocket_router)
app.include_router(predict_router)
app.include_router(docs_router)
app.include_router(ai_router)

# Serve images referenced in docs (e.g. /docs-images/diagram.png)
_docs_images_dir = os.getenv("DOCS_IMAGES_DIR", "/app/docs/images")
if os.path.isdir(_docs_images_dir):
    app.mount("/docs-images", StaticFiles(directory=_docs_images_dir), name="docs-images")

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

CSV_DATASET_DIR = "/app/datasets"

from tasks import celery_app

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