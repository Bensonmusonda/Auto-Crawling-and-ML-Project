"""
Pydantic schemas for ML Training API
Add these to your backend/schemas.py or use as a separate module
"""

from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List


class ModelTrainingRequest(BaseModel):
    """Request schema for initiating model training"""
    csv_path: str = Field(..., description="Path to the cleaned CSV file")
    target_column: str = Field(..., description="Name of the target column")
    model_type: str = Field(..., description="Type of model (e.g., 'random_forest')")
    params: Optional[Dict[str, Any]] = Field(
        None,
        description="Hyperparameters. If None or 'auto', auto-suggestion will be used"
    )
    auto_tune: bool = Field(
        False,
        description="If True, automatically suggest hyperparameters based on dataset"
    )


class ModelListResponse(BaseModel):
    """Response schema for listing available models"""
    models: List[str]
    models_by_type: Dict[str, List[str]]


class ModelManifestResponse(BaseModel):
    """Response schema for model UI manifest"""
    model_type: str
    task_type: str
    ui_manifest: Dict[str, Any]


class HyperparameterSuggestionRequest(BaseModel):
    """Request schema for hyperparameter auto-suggestion"""
    csv_path: str = Field(..., description="Path to CSV for analysis")
    model_type: str = Field(..., description="Type of model")


class HyperparameterSuggestionResponse(BaseModel):
    """Response schema for hyperparameter suggestions"""
    model_type: str
    suggested_params: Dict[str, Any]
    dataset_info: Dict[str, Any]


class ModelTrainingResponse(BaseModel):
    """Response schema for training job submission"""
    job_id: str
    status: str
    message: str


class ModelMetricsResponse(BaseModel):
    job_id: str
    model_type: str
    task_type: str
    metrics: Dict[str, float]
    feature_importance: Dict[str, float]
    hyperparameters: Dict[str, Any]
    model_path: str
    n_samples_train: int
    n_samples_test: int
    n_features: int
    feature_names: Optional[List[str]] = None      
    target_column: Optional[str] = None
    source_csv: Optional[str] = None
    owner_username: Optional[str] = None
    created_at: str


class ModelListFromDBResponse(BaseModel):
    models: List[ModelMetricsResponse]
    total: int