from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any
import pandas as pd
import io
import json
import os
import psycopg

from ml_processor.core import UniversalEngine

router = APIRouter(prefix="/api/process", tags=["Engine"])

DB_URL = (
    f"postgresql://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}"
    f"@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
)


class PipelineStep(BaseModel):
    step: str
    params: Dict[str, Any] = {}


class ProcessRequest(BaseModel):
    dataset_name: str
    pipeline: List[PipelineStep]


@router.post("/execute")
async def execute_processing(request: ProcessRequest):
    connection = None
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

        # 3. Run the UniversalEngine pipeline
        pipeline_dicts = [step.model_dump() for step in request.pipeline]
        engine = UniversalEngine(df)
        processed_df, logs = engine.run_pipeline(pipeline_dicts)

        # 4. Save processed CSV to /app/datasets/ for ML training
        os.makedirs("/app/datasets", exist_ok=True)
        csv_path = f"/app/datasets/{request.dataset_name}.csv"
        processed_df.to_csv(csv_path, index=False, encoding="utf-8-sig")

        # 5. Also archive to processed_items table
        import hashlib
        import numpy as np

        df_clean = processed_df.replace([np.nan, np.inf, -np.inf], None)
        records_out = df_clean.to_dict(orient="records")
        config_json = json.dumps(pipeline_dicts)

        async with connection.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS processed_items (
                    id SERIAL PRIMARY KEY,
                    source_dataset VARCHAR(255),
                    operations_applied JSONB,
                    data JSONB,
                    row_hash TEXT,
                    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            for record in records_out:
                record_json = json.dumps(record, sort_keys=True, separators=(",", ":"))
                row_hash = hashlib.sha256(record_json.encode("utf-8")).hexdigest()
                await cur.execute(
                    """
                    INSERT INTO processed_items
                        (source_dataset, operations_applied, data, row_hash)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (request.dataset_name, config_json, json.dumps(record), row_hash),
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