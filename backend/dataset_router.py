import os
import io
import json
import glob
import psycopg
from psycopg.rows import dict_row
import pandas as pd
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from schemas import PipelineConfig

router = APIRouter(tags=["datasets"])

DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
CSV_DATASET_DIR = "/app/datasets"

@router.get("/api/generate/csv")
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

@router.post("/api/datasets/save-csv")
async def save_csv_to_dir(dataset_name: str):
    os.makedirs(CSV_DATASET_DIR, exist_ok=True)
    connection = None
    try:
        connection = await psycopg.AsyncConnection.connect(
            conninfo=DATABASE_URL, connect_timeout=10
        )
        async with connection.cursor() as cur:
            await cur.execute(
                "SELECT data FROM scraped_items WHERE dataset_name = %s;",
                (dataset_name,)
            )
            records = await cur.fetchall()

        if not records:
            raise HTTPException(status_code=404, detail="Dataset not found or empty")

        rows = [row[0] for row in records]
        df = pd.DataFrame(rows)
        path = os.path.join(CSV_DATASET_DIR, f"{dataset_name}.csv")
        df.to_csv(path, index=False, encoding="utf-8-sig")

        return {"status": "saved", "path": path, "rows": len(rows)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if connection:
            await connection.close()

@router.get("/api/datasets/csv-list")
def list_csv_datasets():
    os.makedirs(CSV_DATASET_DIR, exist_ok=True)
    files = glob.glob(os.path.join(CSV_DATASET_DIR, "*.csv"))
    return [
        {
            "name": os.path.splitext(os.path.basename(f))[0],
            "path": f,
            "size_kb": round(os.path.getsize(f) / 1024, 1),
            "modified": os.path.getmtime(f)
        }
        for f in sorted(files)
    ]

@router.get("/api/datasets/csv-columns")
def get_csv_columns(path: str):
    if not os.path.exists(path):
        raise HTTPException(404, "CSV file not found")
    try:
        df = pd.read_csv(path, nrows=0)  # read only header row
        return {"columns": list(df.columns)}
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/api/process")
async def process_dataset(request: PipelineConfig):
    from main import celery_app
    try:
        task = celery_app.send_task(
            'tasks.run_ml_pipeline', 
            args=[request.dataset_name, [step.model_dump() for step in request.steps], request.source],
            queue='ml_tasks'
        )
        
        return {
            "message": "Processing started",
            "job_id": task.id,
            "dataset": request.dataset_name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/upload_temp_csv")
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

@router.get("/api/datasets/list")
async def list_datasets():
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                SELECT 
                    dataset_name as source_dataset,
                    COUNT(*) AS row_count
                FROM scraped_items
                GROUP BY dataset_name
                ORDER BY dataset_name ASC
            """)
            results = await cur.fetchall()
            return results
