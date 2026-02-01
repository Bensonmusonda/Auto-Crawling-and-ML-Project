from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
import pandas as pd
import io
from fastapi.responses import StreamingResponse
import psycopg
import os
from .processing.engine import run_pipeline

router = APIRouter(prefix="/api/process", tags=["Engine"])

DB_URL = f"postgresql://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"

class PipelineStep(BaseModel):
    step: str
    params: Dict[str, Any]

class ProcessRequest(BaseModel):
    dataset_name: str
    pipeline: List[PipelineStep]

@router.post("/execute")
async def execute_processing(request: ProcessRequest):
    connection = None
    try:
        # 1. Fetch Data from Postgres
        connection = await psycopg.AsyncConnection.connect(conninfo=DB_URL)
        async with connection.cursor() as cur:
            query = "SELECT data FROM scraped_items WHERE dataset_name = %s;"
            await cur.execute(query, (request.dataset_name,))
            records = await cur.fetchall()
            rows = [row[0] for row in records]

        if not rows:
            raise HTTPException(status_code=404, detail="Dataset is empty or not found.")

        # 2. Convert to DataFrame
        df = pd.DataFrame(rows)

        # 3. Run the "Universal Engine" (The Strategy Pattern)
        # We convert the Pydantic models back to dicts for the engine
        pipeline_dicts = [step.model_dump() for step in request.pipeline]
        processed_df = run_pipeline(df, pipeline_dicts)

        # 4. Return as CSV Stream
        stream = io.StringIO()
        processed_df.to_csv(stream, index=False, encoding="utf-8-sig")
        
        response = StreamingResponse(
            iter([stream.getvalue()]),
            media_type="text/csv"
        )
        response.headers["Content-Disposition"] = f"attachment; filename=processed_{request.dataset_name}.csv"
        return response

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing Error: {str(e)}")
    finally:
        if connection:
            await connection.close()