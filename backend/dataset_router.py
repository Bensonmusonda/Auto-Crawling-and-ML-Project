import os
import io
import json
import glob
import psycopg
from psycopg.rows import dict_row
import pandas as pd
import numpy as np
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from typing import Optional
from schemas import PipelineConfig
from db_utils import (
    get_optional_user, 
    get_user_dataset_dir, 
    get_admin_id,
    DATABASE_URL as DB_URL_FROM_UTILS
)

router = APIRouter(tags=["datasets"])

# Helper function to fetch raw dataset records for AI endpoints
async def fetch_dataset(dataset_name: str, owner_id: Optional[int] = None) -> list:
    """Retrieve raw dataset rows from the database.

    Args:
        dataset_name: Name of the dataset to fetch.
        owner_id: Optional user ID for permission filtering. If None, no owner filter is applied.

    Returns:
        A list of records (each record is a JSON-serializable dict).
    """
    # Determine if the user is admin based on owner_id (admin ID is 1 by convention)
    is_admin = (owner_id == 1)
    query = "SELECT data FROM scraped_items WHERE dataset_name = %s"
    params = [dataset_name]
    if not is_admin:
        query += " AND owner_id = %s"
        params.append(owner_id)
    try:
        async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, tuple(params))
                records = await cur.fetchall()
        # Extract the JSON payload from each row
        return [row["data"] for row in records]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch dataset: {str(e)}")
DATABASE_URL = DB_URL_FROM_UTILS

DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
CSV_DATASET_DIR = "/app/datasets"

@router.get("/api/generate/csv")
async def generate_csv(
    dataset_name: str,
    user: Optional[dict] = Depends(get_optional_user),
):
    owner_id = user["id"] if user else None
    connection = None
    try:
        connection = await psycopg.AsyncConnection.connect(
            conninfo=DATABASE_URL,
            connect_timeout=10
        )
        
        async with connection.cursor() as cur:
            if user and user.get("is_admin"):
                query = "SELECT data FROM scraped_items WHERE dataset_name = %s;"
                await cur.execute(query, (dataset_name,))
            else:
                query = "SELECT data FROM scraped_items WHERE dataset_name = %s AND owner_id = %s;"
                await cur.execute(query, (dataset_name, owner_id))
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
async def save_csv_to_dir(
    dataset_name: str,
    save_name: Optional[str] = None,
    user: Optional[dict] = Depends(get_optional_user),
):
    owner_id = user["id"] if user else None
    target_dir = get_user_dataset_dir(owner_id)
    
    connection = None
    try:
        connection = await psycopg.AsyncConnection.connect(
            conninfo=DATABASE_URL, connect_timeout=10
        )
        async with connection.cursor() as cur:
            if user and user.get("is_admin"):
                await cur.execute(
                    "SELECT data FROM scraped_items WHERE dataset_name = %s;",
                    (dataset_name,)
                )
            else:
                await cur.execute(
                    "SELECT data FROM scraped_items WHERE dataset_name = %s AND owner_id = %s;",
                    (dataset_name, owner_id)
                )
            records = await cur.fetchall()

        if not records:
            raise HTTPException(status_code=404, detail="Dataset not found or empty")

        rows = [row[0] for row in records]
        df = pd.DataFrame(rows)
        file_stem = (save_name.strip() or dataset_name) if save_name else dataset_name
        path = os.path.join(target_dir, f"{file_stem}.csv")
        df.to_csv(path, index=False, encoding="utf-8-sig")

        return {"status": "saved", "path": path, "rows": len(rows), "saved_as": file_stem}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if connection:
            await connection.close()

@router.get("/api/datasets/csv-list")
async def list_csv_datasets(
    user: Optional[dict] = Depends(get_optional_user),
):
    owner_id = user["id"] if user else None
    user_dir = get_user_dataset_dir(owner_id)
    
    # Also include files from admin as shared datasets
    admin_id = await get_admin_id()
    admin_dir = get_user_dataset_dir(admin_id)
    
    all_files = []
    # Collect from user dir
    all_files.extend(glob.glob(os.path.join(user_dir, "*.csv")))
    
    # Collect from admin dir if different
    if admin_dir != user_dir:
        admin_files = glob.glob(os.path.join(admin_dir, "*.csv"))
        # Avoid duplicates if admin_dir was somehow user_dir
        for f in admin_files:
            if f not in all_files:
                all_files.append(f)

    return [
        {
            "name": os.path.splitext(os.path.basename(f))[0],
            "path": f,
            "size_kb": round(os.path.getsize(f) / 1024, 1),
            "modified": os.path.getmtime(f),
            "is_shared": os.path.dirname(f).endswith("user_1") and owner_id != 1
        }
        for f in sorted(all_files)
    ]

@router.get("/api/datasets/csv-columns")
async def get_csv_columns(
    path: str,
    user: Optional[dict] = Depends(get_optional_user),
):
    if not os.path.exists(path):
        raise HTTPException(404, "CSV file not found")
    
    # Security: Ensure the CSV is in a folder the user has access to
    owner_id = user["id"] if user else None
    user_dir = get_user_dataset_dir(owner_id)
    admin_id = await get_admin_id()
    admin_dir = get_user_dataset_dir(admin_id)
    
    real_path = os.path.realpath(path)
    allowed_dirs = [os.path.realpath(user_dir), os.path.realpath(admin_dir)]
    
    if not any(real_path.startswith(d) for d in allowed_dirs):
        raise HTTPException(403, "Access to this CSV is restricted")

    try:
        df = pd.read_csv(path, nrows=0)  # read only header row
        return {"columns": list(df.columns)}
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/api/process")
async def process_dataset(
    request: PipelineConfig,
    user: Optional[dict] = Depends(get_optional_user),
):
    from tasks import celery_app
    owner_id = user["id"] if user else None
    try:
        task = celery_app.send_task(
            'tasks.run_ml_pipeline', 
            args=[request.dataset_name, [step.model_dump() for step in request.steps], request.source],
            kwargs={'owner_id': owner_id},
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
async def upload_temp_csv(
    payload: dict,
    user: Optional[dict] = Depends(get_optional_user),
):
    name = payload.get("dataset_name")
    csv_content = payload.get("csv")

    if not name or not csv_content:
        raise HTTPException(400, detail="Missing dataset_name or csv content")

    owner_id = user["id"] if user else None

    try:
        df = pd.read_csv(io.StringIO(csv_content))
        df = df.replace([np.nan, np.inf, -np.inf], None)
        records = df.to_dict(orient="records")

        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            async with conn.cursor() as cur:
                for record in records:
                    await cur.execute(
                        """
                        INSERT INTO scraped_items (dataset_name, data, owner_id)
                        VALUES (%s, %s, %s)
                        """,
                        (name, json.dumps(record), owner_id)
                    )
                await conn.commit()

        return {"status": "stored", "dataset": name, "row_count": len(records)}

    except Exception as e:
        raise HTTPException(400, detail=f"Processing failed: {str(e)}")

@router.get("/api/datasets/list")
async def list_datasets(
    user: Optional[dict] = Depends(get_optional_user),
):
    if not user:
        return []
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            if user.get("is_admin"):
                # Admin sees everything
                await cur.execute("""
                    SELECT
                        si.dataset_name as source_dataset,
                        COUNT(*) AS row_count,
                        u.username as owner_username
                    FROM scraped_items si
                    LEFT JOIN users u ON si.owner_id = u.id
                    GROUP BY si.dataset_name, u.username
                    ORDER BY si.dataset_name ASC
                """)
            else:
                await cur.execute("""
                    SELECT
                        si.dataset_name as source_dataset,
                        COUNT(*) AS row_count,
                        u.username as owner_username
                    FROM scraped_items si
                    LEFT JOIN users u ON si.owner_id = u.id
                    WHERE si.owner_id = %s
                    GROUP BY si.dataset_name, u.username
                    ORDER BY si.dataset_name ASC
                """, (user["id"],))
            return await cur.fetchall()

@router.delete("/api/datasets/{dataset_name}")
async def delete_dataset(
    dataset_name: str,
    user: Optional[dict] = Depends(get_optional_user),
):
    if not user:
        raise HTTPException(401, "Authentication required")
        
    owner_id = user["id"]
    is_admin = user.get("is_admin", False)
    
    try:
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            async with conn.cursor() as cur:
                # 1. Delete from database
                if is_admin:
                    await cur.execute(
                        "DELETE FROM scraped_items WHERE dataset_name = %s",
                        (dataset_name,)
                    )
                else:
                    await cur.execute(
                        "DELETE FROM scraped_items WHERE dataset_name = %s AND owner_id = %s",
                        (dataset_name, owner_id)
                    )
                
                rows_deleted = cur.rowcount
                await conn.commit()

        # 2. Delete physical CSV if it exists in the user's directory
        target_dir = get_user_dataset_dir(owner_id)
        csv_path = os.path.join(target_dir, f"{dataset_name}.csv")
        
        file_deleted = False
        if os.path.exists(csv_path):
            os.remove(csv_path)
            file_deleted = True
            
        # Also check admin dir if admin is deleting
        if is_admin and not file_deleted:
            admin_id = await get_admin_id()
            admin_dir = get_user_dataset_dir(admin_id)
            admin_csv_path = os.path.join(admin_dir, f"{dataset_name}.csv")
            if os.path.exists(admin_csv_path):
                os.remove(admin_csv_path)
                file_deleted = True

        if rows_deleted == 0 and not file_deleted:
             raise HTTPException(404, detail="Dataset not found or you don't have permission to delete it")

        return {
            "status": "deleted",
            "dataset": dataset_name,
            "rows_removed": rows_deleted,
            "file_removed": file_deleted
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, detail=f"Deletion failed: {str(e)}")
