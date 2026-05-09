from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any
import pandas as pd
import io
import json
import os
import psycopg
import uuid

from ml_processor.core import UniversalEngine
from db_utils import get_optional_user, get_user_dataset_dir, DATABASE_URL as DB_URL_FROM_UTILS
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends

DB_URL = DB_URL_FROM_UTILS


class PipelineStep(BaseModel):
    step: str
    params: Dict[str, Any] = {}


class ProcessRequest(BaseModel):
    dataset_name: str
    pipeline: List[PipelineStep]


@router.post("/execute")
async def execute_processing(
    request: ProcessRequest,
    user: Optional[dict] = Depends(get_optional_user),
):
    connection = None
    owner_id = user["id"] if user else None
    try:
        # 1. Fetch data from Postgres
        connection = await psycopg.AsyncConnection.connect(conninfo=DB_URL)
        async with connection.cursor() as cur:
            await cur.execute(
                "SELECT data FROM scraped_items WHERE dataset_name = %s;",
                (request.dataset_name,)
            )
            records = await cur.fetchall()
            rows = [row[0] for row in records]

        if not rows:
            raise HTTPException(status_code=404, detail="Dataset is empty or not found.")

        # 2. Convert to DataFrame
        df = pd.DataFrame(rows)

        # 3. Fetch any previously applied operations for this dataset and accumulate.
        #    This ensures that adding a forgotten step later still produces a correct
        #    full pipeline (raw data is always the starting point).
        existing_ops = []
        async with connection.cursor() as cur:
            await cur.execute("""
                SELECT operations_applied FROM processed_items
                WHERE source_dataset = %s
                ORDER BY processed_at DESC
                LIMIT 1
            """, (request.dataset_name,))
            prev = await cur.fetchone()
            if prev and prev[0]:
                ops = prev[0]
                existing_ops = ops if isinstance(ops, list) else json.loads(ops)

        new_ops = [step.model_dump() for step in request.pipeline]
        # Full accumulated pipeline: previous steps first, new steps appended
        pipeline_dicts = existing_ops + new_ops

        engine = UniversalEngine(df)
        processed_df, logs = engine.run_pipeline(pipeline_dicts)

        # 4. Save processed CSV to Scoped Directory for ML training
        target_dir = get_user_dataset_dir(owner_id)
        csv_path = os.path.join(target_dir, f"{request.dataset_name}.csv")
        processed_df.to_csv(csv_path, index=False, encoding="utf-8-sig")
        
        job_id = f"proc_{uuid.uuid4().hex[:12]}"

        # 5. Also archive to processed_items table
        import hashlib
        import numpy as np

        df_clean = processed_df.replace([np.nan, np.inf, -np.inf], None)
        records_out = df_clean.to_dict(orient="records")
        # Store the FULL accumulated pipeline so predict_router always gets the
        # complete list when it queries by dataset name.
        config_json = json.dumps(pipeline_dicts)

        async with connection.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS processed_items (
                    id SERIAL PRIMARY KEY,
                    source_dataset VARCHAR(255),
                    operations_applied JSONB,
                    data JSONB,
                    row_hash TEXT,
                    owner_id INTEGER REFERENCES users(id),
                    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            # Also add owner_id if it's missing (idempotent)
            await cur.execute("""
                ALTER TABLE processed_items ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)
            """)
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS processing_jobs (
                    job_id VARCHAR(255) PRIMARY KEY,
                    dataset_name VARCHAR(255),
                    config JSONB,
                    owner_id INTEGER REFERENCES users(id),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            await cur.execute("""
                INSERT INTO processing_jobs (job_id, dataset_name, config, owner_id)
                VALUES (%s, %s, %s, %s)
            """, (job_id, request.dataset_name, config_json, owner_id))

            for record in records_out:
                record_json = json.dumps(record, sort_keys=True, separators=(",", ":"))
                row_hash = hashlib.sha256(record_json.encode("utf-8")).hexdigest()
                await cur.execute(
                    """
                    INSERT INTO processed_items
                        (source_dataset, operations_applied, data, row_hash, owner_id)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (request.dataset_name, config_json, json.dumps(record), row_hash, owner_id),
                )
            await connection.commit()

        # 6. Return as CSV stream
        stream = io.StringIO()
        processed_df.to_csv(stream, index=False, encoding="utf-8-sig")
        response = StreamingResponse(
            iter([stream.getvalue()]),
            media_type="text/csv",
        )
        response.headers["Content-Disposition"] = (
            f"attachment; filename=processed_{request.dataset_name}.csv"
        )
        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing error: {str(e)}")
    finally:
        if connection:
            await connection.close()


@router.get("/configs/{dataset_name}")
async def get_processing_configs(
    dataset_name: str,
    user: Optional[dict] = Depends(get_optional_user),
):
    from psycopg.rows import dict_row
    async with await psycopg.AsyncConnection.connect(
        DB_URL, row_factory=dict_row
    ) as conn:
        async with conn.cursor() as cur:
            # Ensure table exists in case this is called before any processing
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS processing_jobs (
                    job_id VARCHAR(255) PRIMARY KEY,
                    dataset_name VARCHAR(255),
                    config JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            await conn.commit()
            
            await cur.execute("""
                SELECT job_id, dataset_name, config, created_at
                FROM processing_jobs
                WHERE dataset_name = %s AND (owner_id = %s OR owner_id = 1)
                ORDER BY created_at DESC
                LIMIT 10
            """, (dataset_name, user["id"] if user else None))
            return await cur.fetchall()