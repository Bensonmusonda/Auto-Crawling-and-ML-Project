from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, List, Any
from pydantic import BaseModel
import pandas as pd

from db_utils import get_optional_user
from ml_processor.ai_client import DeepSeekClient
from dataset_router import fetch_dataset  # Reuse existing fetch logic

router = APIRouter(prefix="/api/ai", tags=["ai"])
client = DeepSeekClient()

class PipelineSuggestionRequest(BaseModel):
    dataset_name: str

class RegexGenerationRequest(BaseModel):
    dataset_name: str
    column: str
    intent: str

@router.post("/suggest-pipeline")
async def suggest_pipeline(
    req: PipelineSuggestionRequest,
    user: Optional[dict] = Depends(get_optional_user)
):
    if not client.is_configured():
        raise HTTPException(status_code=503, detail="AI Service is not configured (Missing API Key).")
        
    owner_id = user["id"] if user else None
    
    # 1. Fetch dataset
    try:
        raw_data = await fetch_dataset(req.dataset_name, owner_id=owner_id)
        if not raw_data:
            raise ValueError("Dataset is empty.")
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Failed to fetch dataset: {str(e)}")

    # 2. Prepare sample
    df = pd.DataFrame(raw_data)
    if df.empty:
        raise HTTPException(status_code=400, detail="Dataset has no rows.")
        
    # Get a random sample of up to 5 rows
    sample_size = min(50, len(df))
    df_sample = df.sample(n=sample_size)
    
    # Prepare column schema info
    columns_info = {col: str(df[col].dtype) for col in df.columns}
    
    # 3. Call DeepSeek
    try:
        suggestion = client.suggest_pipeline(df_sample, columns_info)
        return suggestion.model_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Suggestion failed: {str(e)}")


@router.post("/generate-regex")
async def generate_regex(
    req: RegexGenerationRequest,
    user: Optional[dict] = Depends(get_optional_user)
):
    if not client.is_configured():
        raise HTTPException(status_code=503, detail="AI Service is not configured (Missing API Key).")
        
    owner_id = user["id"] if user else None
    
    try:
        raw_data = fetch_dataset(req.dataset_name, owner_id=owner_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Failed to fetch dataset: {str(e)}")

    df = pd.DataFrame(raw_data)
    if req.column not in df.columns:
        raise HTTPException(status_code=400, detail=f"Column '{req.column}' not found in dataset.")
        
    # Get up to 3 non-null samples
    sample_series = df[req.column].dropna()
    sample_size = min(20, len(sample_series))
    
    if sample_size == 0:
        raise HTTPException(status_code=400, detail="Column has no non-null data to sample.")
        
    sample_data = sample_series.sample(n=sample_size).tolist()
    
    try:
        suggestion = client.generate_regex(req.column, sample_data, req.intent)
        return suggestion.model_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Generation failed: {str(e)}")
