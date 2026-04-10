import os
import pandas as pd
import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException
from typing import List
from ml_training_schemas import (
    ModelTrainingRequest,
    ModelTrainingResponse,
    ModelListResponse,
    ModelManifestResponse,
    HyperparameterSuggestionRequest,
    HyperparameterSuggestionResponse,
    ModelMetricsResponse,
    ModelListFromDBResponse
)
from ml_training.registry import ModelRegistry
from tasks import celery_app  # Your existing celery app

# Database configuration
DB_HOST = os.getenv("DB_HOST", "postgres")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:5432/{DB_NAME}"

router = APIRouter(prefix="/api/ml-training", tags=["ML Training"])
registry = ModelRegistry()


@router.get("/models", response_model=ModelListResponse)
async def list_available_models():
    """
    Get a list of all available models.
    
    Returns:
        List of model names and models grouped by type
    """
    return {
        "models": registry.list_models(),
        "models_by_type": {
            "classification": registry.list_models_by_type("classification"),
            "regression": registry.list_models_by_type("regression")
        }
    }


@router.get("/models/{model_type}/manifest", response_model=ModelManifestResponse)
async def get_model_manifest(model_type: str):
    """
    Get the UI manifest for a specific model type.
    This manifest defines the hyperparameter inputs for the frontend.
    
    Args:
        model_type: Name of the model (e.g., 'random_forest')
        
    Returns:
        UI manifest with parameter definitions
    """
    try:
        manifest = registry.get_ui_manifest(model_type)
        task_type = registry.get_task_type(model_type)
        return {
            "model_type": model_type,
            "task_type": task_type,
            "ui_manifest": manifest
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/suggest-hyperparameters", response_model=HyperparameterSuggestionResponse)
async def suggest_hyperparameters(request: HyperparameterSuggestionRequest):
    """
    Analyze a dataset and suggest optimal hyperparameters for a given model type.
    
    Args:
        request: Contains csv_path and model_type
        
    Returns:
        Suggested hyperparameters and dataset information
    """
    try:
        if not os.path.exists(request.csv_path):
            raise HTTPException(status_code=404, detail=f"CSV file not found: {request.csv_path}")
        
        df = pd.read_csv(request.csv_path)
        n_samples = len(df)
        n_features = len(df.columns) - 1
        
        suggestions = registry.suggest_hyperparameters(
            request.model_type,
            n_samples=n_samples,
            n_features=n_features
        )
        
        return {
            "model_type": request.model_type,
            "suggested_params": suggestions,
            "dataset_info": {
                "n_samples": n_samples,
                "n_features": n_features,
                "columns": list(df.columns)
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing dataset: {str(e)}")


@router.post("/train", response_model=ModelTrainingResponse)
async def train_model(request: ModelTrainingRequest):
    """
    Submit a model training job.
    
    Args:
        request: Training configuration including csv_path, target_column, model_type, and params
        
    Returns:
        Job ID and status
    """
    try:
        if request.model_type not in registry.list_models():
            raise HTTPException(
                status_code=400,
                detail=f"Invalid model type: {request.model_type}"
            )
        
        # Validate CSV exists
        if not os.path.exists(request.csv_path):
            raise HTTPException(
                status_code=404,
                detail=f"CSV file not found: {request.csv_path}"
            )
        
        # Handle auto-tuning
        params = request.params
        if request.auto_tune or params is None or params == "auto":
            # Load CSV to get dataset characteristics
            df = pd.read_csv(request.csv_path)
            n_samples = len(df)
            n_features = len(df.columns) - 1
            
            params = registry.suggest_hyperparameters(
                request.model_type,
                n_samples=n_samples,
                n_features=n_features
            )
        
        # Submit the Celery task
        task = celery_app.send_task(
            'run_model_training',
            args=[request.csv_path, request.target_column, request.model_type, params],
            queue='ml_tasks'
        )
        
        return {
            "job_id": task.id,
            "status": "submitted",
            "message": f"Model training job submitted for {request.model_type}"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error submitting training job: {str(e)}")


@router.get("/models/trained", response_model=ModelListFromDBResponse)
async def list_trained_models(limit: int = 50, offset: int = 0):
    """
    Get a list of all trained models from the database.
    
    Args:
        limit: Maximum number of models to return
        offset: Number of models to skip
        
    Returns:
        List of trained models with their metrics
    """
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                # Get total count
                cur.execute("SELECT COUNT(*) as count FROM model_registry")
                total = cur.fetchone()["count"]
                
                # Get models
                cur.execute("""
                    SELECT 
                        job_id, model_type, task_type, metrics,
                        feature_importance, hyperparameters, model_path,
                        n_samples_train, n_samples_test, n_features,
                        created_at
                    FROM model_registry
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                """, (limit, offset))
                
                models = cur.fetchall()
                
                return {
                    "models": [
                        {
                            "job_id": m["job_id"],
                            "model_type": m["model_type"],
                            "task_type": m["task_type"],
                            "metrics": m["metrics"],
                            "feature_importance": m["feature_importance"],
                            "hyperparameters": m["hyperparameters"],
                            "model_path": m["model_path"],
                            "n_samples_train": m["n_samples_train"],
                            "n_samples_test": m["n_samples_test"],
                            "n_features": m["n_features"],
                            "created_at": m["created_at"].isoformat()
                        }
                        for m in models
                    ],
                    "total": total
                }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/models/trained/{job_id}", response_model=ModelMetricsResponse)
async def get_model_details(job_id: str):
    """
    Get details of a specific trained model.
    
    Args:
        job_id: The training job ID
        
    Returns:
        Model details including metrics and feature importance
    """
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT 
                        job_id, model_type, task_type, metrics,
                        feature_importance, hyperparameters, model_path,
                        n_samples_train, n_samples_test, n_features, feature_names,
                        created_at
                    FROM model_registry
                    WHERE job_id = %s
                """, (job_id,))
                
                model = cur.fetchone()
                
                if not model:
                    raise HTTPException(status_code=404, detail=f"Model with job_id {job_id} not found")
                
                return {
                    "job_id": model["job_id"],
                    "model_type": model["model_type"],
                    "task_type": model["task_type"],
                    "metrics": model["metrics"],
                    "feature_importance": model["feature_importance"],
                    "hyperparameters": model["hyperparameters"],
                    "model_path": model["model_path"],
                    "n_samples_train": model["n_samples_train"],
                    "n_samples_test": model["n_samples_test"],
                    "n_features": model["n_features"],
                    "feature_names": model["feature_names"],
                    "created_at": model["created_at"].isoformat()
                }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/configs/{dataset_name}")
async def get_ml_training_configs(dataset_name: str):
    """
    Get past successful training configurations for a given dataset.
    """
    csv_path = f"/app/datasets/{dataset_name}.csv"
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT job_id, model_type, hyperparameters as params, target_column, created_at
                    FROM model_registry
                    WHERE source_csv = %s
                    ORDER BY created_at DESC
                    LIMIT 10
                """, (csv_path,))
                
                rows = cur.fetchall()
                configs = []
                for row in rows:
                    configs.append({
                        "job_id": row["job_id"],
                        "dataset_name": dataset_name,
                        "config": {
                            "model_type": row["model_type"],
                            "target_column": row["target_column"],
                            "params": row["params"],
                            "auto_tune": False
                        },
                        "created_at": row["created_at"].isoformat() if row["created_at"] else None
                    })
                return configs
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")