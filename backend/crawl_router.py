import os
import json
import psycopg
from psycopg.rows import dict_row
import redis.asyncio as redis
from fastapi import APIRouter, HTTPException
from schemas import CrawlRequest, SiteTierConfig

router = APIRouter(prefix="/api/crawl", tags=["crawl"])

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"


@router.post("")
async def send_crawl_task(config_request: CrawlRequest):
    from tasks import celery_app

    json_config = config_request.model_dump()
    result = celery_app.send_task("tasks.run_crawl_task", args=(json_config,))

    # Persist crawl config for workflow pre-filling
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
            await cur.execute(
                """
                INSERT INTO crawl_jobs (job_id, dataset_name, config)
                VALUES (%s, %s, %s)
                ON CONFLICT (job_id) DO NOTHING
                """,
                (result.id, config_request.dataset_name, json.dumps(json_config)),
            )
            await conn.commit()

    # NOTE: Live events are streamed via /websocket/crawl_events.
    # Do NOT spawn a monitor task here — it creates a Redis connection
    # leak that never terminates.
    return {"started crawl job": result.id}


@router.get("/configs/{dataset_name}")
async def get_crawl_configs(dataset_name: str):
    async with await psycopg.AsyncConnection.connect(
        DATABASE_URL, row_factory=dict_row
    ) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT job_id, dataset_name, config, created_at
                FROM crawl_jobs
                WHERE dataset_name = %s
                ORDER BY created_at DESC
                LIMIT 10
                """,
                (dataset_name,),
            )
            return await cur.fetchall()


@router.get("/jobs")
async def get_crawl_jobs():
    async with await psycopg.AsyncConnection.connect(
        DATABASE_URL, row_factory=dict_row
    ) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT
                    job_id,
                    dataset_name,
                    COUNT(*)        AS item_count,
                    MIN(created_at) AS started_at,
                    MAX(created_at) AS last_seen_at
                FROM scraped_items
                WHERE job_id IS NOT NULL
                GROUP BY job_id, dataset_name
                ORDER BY MAX(created_at) DESC
                LIMIT 100
            """)
            return await cur.fetchall()


# ============================================================
# SITE TIER MANAGEMENT
# ============================================================

async def ensure_app_config_table(conn):
    async with conn.cursor() as cur:
        await cur.execute("""
            CREATE TABLE IF NOT EXISTS app_config (
                key VARCHAR(100) PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        await cur.execute("""
            INSERT INTO app_config (key, value)
            VALUES
                ('tough_sites',    '["amazon.com", "ebay.com", "walmart.com"]'::jsonb),
                ('playwright_sites', '[]'::jsonb),
                ('hybrid_sites',   '[]'::jsonb)
            ON CONFLICT (key) DO NOTHING;
        """)
        await conn.commit()


@router.get("/site-tiers")
async def get_all_site_tiers():
    async with await psycopg.AsyncConnection.connect(
        DATABASE_URL, row_factory=dict_row
    ) as conn:
        await ensure_app_config_table(conn)
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT key, value FROM app_config
                WHERE key IN ('tough_sites', 'playwright_sites', 'hybrid_sites')
            """)
            rows = await cur.fetchall()

        result = {"tough_sites": [], "playwright_sites": [], "hybrid_sites": []}
        for row in rows:
            result[row["key"]] = row["value"]
        return result


@router.get("/tough-sites")
async def get_tough_sites():
    async with await psycopg.AsyncConnection.connect(
        DATABASE_URL, row_factory=dict_row
    ) as conn:
        await ensure_app_config_table(conn)
        async with conn.cursor() as cur:
            await cur.execute("SELECT value FROM app_config WHERE key = 'tough_sites'")
            row = await cur.fetchone()
            return {"tough_sites": row["value"] if row else []}


@router.post("/tough-sites")
async def update_tough_sites(config: SiteTierConfig):
    async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
        await ensure_app_config_table(conn)
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO app_config (key, value, updated_at)
                VALUES ('tough_sites', %s::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value, updated_at = NOW()
                """,
                (json.dumps(config.sites),),
            )
            await conn.commit()
    return {"status": "updated", "tough_sites": config.sites}


@router.get("/playwright-sites")
async def get_playwright_sites():
    async with await psycopg.AsyncConnection.connect(
        DATABASE_URL, row_factory=dict_row
    ) as conn:
        await ensure_app_config_table(conn)
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT value FROM app_config WHERE key = 'playwright_sites'"
            )
            row = await cur.fetchone()
            return {"playwright_sites": row["value"] if row else []}


@router.post("/playwright-sites")
async def update_playwright_sites(config: SiteTierConfig):
    async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
        await ensure_app_config_table(conn)
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO app_config (key, value, updated_at)
                VALUES ('playwright_sites', %s::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value, updated_at = NOW()
                """,
                (json.dumps(config.sites),),
            )
            await conn.commit()
    return {"status": "updated", "playwright_sites": config.sites}


@router.get("/hybrid-sites")
async def get_hybrid_sites():
    async with await psycopg.AsyncConnection.connect(
        DATABASE_URL, row_factory=dict_row
    ) as conn:
        await ensure_app_config_table(conn)
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT value FROM app_config WHERE key = 'hybrid_sites'"
            )
            row = await cur.fetchone()
            return {"hybrid_sites": row["value"] if row else []}


@router.post("/hybrid-sites")
async def update_hybrid_sites(config: SiteTierConfig):
    async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
        await ensure_app_config_table(conn)
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO app_config (key, value, updated_at)
                VALUES ('hybrid_sites', %s::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value, updated_at = NOW()
                """,
                (json.dumps(config.sites),),
            )
            await conn.commit()
    return {"status": "updated", "hybrid_sites": config.sites}