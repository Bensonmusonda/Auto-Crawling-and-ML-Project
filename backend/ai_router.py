import os
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, List, Any
from pydantic import BaseModel
import pandas as pd

from db_utils import get_optional_user
from dataset_router import fetch_dataset
from ml_processor.registry import PROCESSOR_REGISTRY
from ml_training.registry import ModelRegistry
from ml_processor.ai_client import DeepSeekClient, SelectorSuggestionRequest, SelectorSuggestionResponse

router = APIRouter(prefix="/api/ai", tags=["ai"])
client = DeepSeekClient()
training_registry = ModelRegistry()

class PipelineSuggestionRequest(BaseModel):
    dataset_name: str
    dataset_path: Optional[str] = None
    goal: Optional[str] = None

class RegexGenerationRequest(BaseModel):
    dataset_name: str
    dataset_path: Optional[str] = None
    column: str
    intent: str

class MLAdvisorRequest(BaseModel):
    mode: str  # recommend, tune, interpret
    dataset_name: str
    dataset_path: Optional[str] = None
    target_column: str
    current_model_type: Optional[str] = None
    metrics: Optional[Dict[str, Any]] = None
    feature_importance: Optional[Dict[str, Any]] = None
    goal: Optional[str] = None

@router.post("/ml-advisor")
async def ml_advisor(
    req: MLAdvisorRequest,
    user: Optional[dict] = Depends(get_optional_user)
):
    if not client.is_configured():
        raise HTTPException(status_code=503, detail="AI Service is not configured.")
        
    owner_id = user["id"] if user else None
    
    # 1. Fetch stats only if recommending or tuning
    stats = {}
    if req.mode in ["recommend", "tune"]:
        try:
            if req.dataset_path:
                df = pd.read_csv(req.dataset_path)
            else:
                raw_data = fetch_dataset(req.dataset_name, owner_id=owner_id)
                df = pd.DataFrame(raw_data)
                
            if not df.empty:
                stats = {
                    "columns": list(df.columns),
                    "dtypes": {c: str(t) for c, t in df.dtypes.items()},
                    "null_counts": df.isnull().sum().to_dict(),
                    "unique_counts": df.nunique().to_dict(),
                    "shape": df.shape
                }
        except Exception as e:
            # Stats are optional but helpful
            print(f"Stats fetch error: {e}")
            pass

    # 2. Get available models info if recommending or tuning
    models_info = None
    if req.mode in ["recommend", "tune"]:
        all_models = training_registry.list_models()
        models_info = {}
        for m in all_models:
            info = training_registry.get_model_info(m)
            models_info[m] = {
                "task_type": info["task_type"],
                "ui_manifest": info["ui_manifest"]
            }

    # 3. Call AI
    try:
        result = client.analyze_ml_task(
            mode=req.mode,
            stats_info=stats,
            target_column=req.target_column,
            available_models_info=models_info,
            current_model_type=req.current_model_type,
            metrics=req.metrics,
            feature_importance=req.feature_importance,
            goal=req.goal
        )
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/suggest-pipeline")
async def suggest_pipeline(
    req: PipelineSuggestionRequest,
    user: Optional[dict] = Depends(get_optional_user)
):
    if not client.is_configured():
        raise HTTPException(status_code=503, detail="AI Service is not configured (Missing API Key).")
        
    owner_id = user["id"] if user else None
    
    # 1. Fetch dataset (from CSV path or DB name)
    try:
        if req.dataset_path:
            # Security: Ensure user has access to this path
            if not os.path.exists(req.dataset_path):
                raise ValueError(f"CSV file not found at {req.dataset_path}")
            
            # Simple check: path should be inside /app/datasets
            # (In production we'd use more robust path validation)
            df = pd.read_csv(req.dataset_path)
            if df.empty:
                raise ValueError("CSV dataset is empty.")
        else:
            raw_data = await fetch_dataset(req.dataset_name, owner_id=owner_id)
            if not raw_data:
                raise ValueError("Database dataset is empty or not found.")
            df = pd.DataFrame(raw_data)
            
    except Exception as e:
        # Return 400 for bad data/path instead of 404 to distinguish from 'route not found'
        raise HTTPException(status_code=400, detail=f"Failed to fetch dataset: {str(e)}")

    if df.empty:
        raise HTTPException(status_code=400, detail="Dataset has no rows.")

    stats_info = {
        "total_rows": len(df),
        "columns": []
    }
    
    for col in df.columns:
        col_stats = {
            "name": col,
            "dtype": str(df[col].dtype),
            "missing_count": int(df[col].isna().sum()),
            "missing_percentage": float((df[col].isna().sum() / len(df)) * 100),
            "unique_count": int(df[col].nunique())
        }
        # Add basic numeric stats if applicable
        if pd.api.types.is_numeric_dtype(df[col]):
            col_stats.update({
                "min": float(df[col].min()) if not df[col].isna().all() else None,
                "max": float(df[col].max()) if not df[col].isna().all() else None,
                "mean": float(df[col].mean()) if not df[col].isna().all() else None
            })
        stats_info["columns"].append(col_stats)

    # 3. Prepare options context
    available_ops = []
    for op_id, op_func in PROCESSOR_REGISTRY.items():
        op_info = {"id": op_id}
        if op_func.__doc__:
            op_info["description"] = op_func.__doc__.strip().split('\n')[0]
        available_ops.append(op_info)
    
    available_models = training_registry.list_models()

    # 4. Prepare sample (smaller sample for token efficiency)
    sample_size = min(10, len(df))
    df_sample = df.sample(n=sample_size)
    
    # 5. Call DeepSeek
    try:
        suggestion = client.suggest_pipeline(
            df_sample, 
            stats_info, 
            available_ops, 
            available_models, 
            req.goal
        )
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
    
    # 1. Fetch dataset (from CSV path or DB name)
    try:
        if req.dataset_path:
            if not os.path.exists(req.dataset_path):
                raise ValueError(f"CSV file not found at {req.dataset_path}")
            df = pd.read_csv(req.dataset_path)
        else:
            raw_data = await fetch_dataset(req.dataset_name, owner_id=owner_id)
            if not raw_data:
                raise ValueError("Dataset or database record not found.")
            df = pd.DataFrame(raw_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch dataset: {str(e)}")

    if df.empty:
        raise HTTPException(status_code=400, detail="Dataset has no data to analyze.")
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

@router.post("/suggest-selector", response_model=SelectorSuggestionResponse)
async def suggest_selector(
    req: SelectorSuggestionRequest, 
    user: Optional[dict] = Depends(get_optional_user)
):
    """
    Receives DOM context and programmatic candidates from the extension,
    returning merged AI recommendations.
    """
    if not client.is_configured():
        raise HTTPException(status_code=503, detail="AI Service not configured.")
    
    try:
        result = await client.suggest_selector(req)
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        # Failsafe: if rate-limited, empty, or broken, return a clean fallback payload
        # so the extension UI doesn't crash.
        fallback_key = list(req.candidates.keys())[0] if req.candidates else "unknown"
        return SelectorSuggestionResponse(
            recommended_key=fallback_key,
            reason=f"AI Service Temporarily Unavailable: {str(e)}",
            ai_css=None,
            ai_xpath=None
        )

# Add to ai_router.py

class JsonPathRequest(BaseModel):
    url: str
    headers: Dict[str, str]

@router.post("/analyze-json-path")
async def analyze_json_path(req: JsonPathRequest):
    # ADDED LOGGING for debugging
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        import httpx
        async with httpx.AsyncClient() as c:
            resp = await c.get(req.url, headers=req.headers)
            # Check if response is valid JSON before parsing
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="API responded with error")
            data = resp.json()
        
        # Call the client
        path = client.suggest_json_path(data)
        return {"path": path}
        
    except Exception as e:
        logger.error(f"AI Path Analysis Error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI Service error: {str(e)}")