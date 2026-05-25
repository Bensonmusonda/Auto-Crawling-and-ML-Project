# ML Training Module - No-Code ML Training System

## Overview

This module provides a complete no-code machine learning training system built on top of your existing FastAPI/Celery/Redis/Postgres stack. It follows the Strategy Pattern for model implementations and handles asynchronous training.

## Architecture

```
backend/
├── ml_training/                 # NEW: ML Training Module
│   ├── __init__.py
│   ├── registry.py             # Model registry with UI manifests
│   ├── strategies.py           # Strategy pattern implementations
│   └── core.py                 # Core training logic
├── ml_training_task.py         # NEW: Celery task implementation
├── ml_training_schemas.py      # NEW: Pydantic schemas
├── ml_training_router.py       # NEW: FastAPI router
├── tasks.py                    # UPDATED: Added run_model_training task
└── main.py                     # UPDATED: Added router inclusion
```

## Features

### 1. Model Registry with UI Manifests

The `ModelRegistry` class maps model names to their Scikit-Learn implementations and provides UI manifests for frontend rendering.

**Supported Models:**

**Classification:**
- Random Forest (`random_forest`)
- Logistic Regression (`logistic_regression`)
- Gradient Boosting (`gradient_boosting`)
- Support Vector Machine (`svm`)

**Regression:**
- Linear Regression (`linear_regression`)
- Ridge Regression (`ridge_regression`)

### 2. Auto-Suggestion Logic

The registry includes intelligent hyperparameter suggestions based on dataset characteristics:

```python
registry = ModelRegistry()
suggestions = registry.suggest_hyperparameters(
    model_name="random_forest",
    n_samples=10000,
    n_features=20
)
```

**Heuristics:**
- Adjusts number of trees based on dataset size
- Adapts tree depth based on feature count
- Modifies regularization strength based on feature-to-sample ratio
- Optimizes learning rates for larger datasets

### 3. Strategy Pattern Implementation

Each model implements the `ModelStrategy` abstract base class:

```python
class ModelStrategy(ABC):
    def create_model(self, params: Dict[str, Any])
    def train(self, model, X_train, y_train)
    def evaluate(self, model, X_test, y_test) -> Dict[str, float]
    def get_feature_importance(self, model, feature_names) -> Dict[str, float]
    def task_type(self) -> str
```

This makes it easy to add new models by creating new strategy classes.

### 4. Asynchronous Training Task

The Celery task `run_model_training` handles:
- Dynamic model loading via registry
- 80/20 train/test split with stratification (for classification)
- Comprehensive metrics calculation
- Feature importance extraction
- Model persistence as `.joblib` files
- Metadata storage in Postgres

### 5. Model Persistence

**File Storage:** Models saved to `/app/models/` as `.joblib` files with timestamp

**Database Schema:**
```sql
CREATE TABLE model_registry (
    id SERIAL PRIMARY KEY,
    job_id VARCHAR(255) UNIQUE NOT NULL,
    model_type VARCHAR(100) NOT NULL,
    task_type VARCHAR(50) NOT NULL,
    model_path TEXT NOT NULL,
    hyperparameters JSONB NOT NULL,
    metrics JSONB NOT NULL,
    feature_importance JSONB NOT NULL,
    feature_names JSONB NOT NULL,
    n_samples_train INTEGER,
    n_samples_test INTEGER,
    n_features INTEGER,
    source_csv TEXT,
    target_column VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

### 1. List Available Models
```http
GET /api/ml-training/models
```

**Response:**
```json
{
  "models": ["random_forest", "logistic_regression", ...],
  "models_by_type": {
    "classification": ["random_forest", "logistic_regression", ...],
    "regression": ["linear_regression", "ridge_regression"]
  }
}
```

### 2. Get Model UI Manifest
```http
GET /api/ml-training/models/{model_type}/manifest
```

**Response:**
```json
{
  "model_type": "random_forest",
  "task_type": "classification",
  "ui_manifest": {
    "n_estimators": {
      "type": "range",
      "min": 10,
      "max": 500,
      "step": 10,
      "default": 100,
      "label": "Number of Trees"
    },
    ...
  }
}
```

### 3. Auto-Suggest Hyperparameters
```http
POST /api/ml-training/suggest-hyperparameters
Content-Type: application/json

{
  "csv_path": "/path/to/cleaned.csv",
  "model_type": "random_forest"
}
```

**Response:**
```json
{
  "model_type": "random_forest",
  "suggested_params": {
    "n_estimators": 200,
    "max_depth": 15,
    "min_samples_split": 10,
    ...
  },
  "dataset_info": {
    "n_samples": 10000,
    "n_features": 20,
    "columns": ["feature1", "feature2", ...]
  }
}
```

### 4. Train Model
```http
POST /api/ml-training/train
Content-Type: application/json

{
  "csv_path": "/path/to/cleaned.csv",
  "target_column": "target",
  "model_type": "random_forest",
  "params": {
    "n_estimators": 100,
    "max_depth": 10
  },
  "auto_tune": false
}
```

**Response:**
```json
{
  "job_id": "abc-123-def-456",
  "status": "submitted",
  "message": "Model training job submitted for random_forest"
}
```

### 5. List Trained Models
```http
GET /api/ml-training/models/trained?limit=50&offset=0
```

**Response:**
```json
{
  "models": [
    {
      "job_id": "abc-123",
      "model_type": "random_forest",
      "task_type": "classification",
      "metrics": {
        "accuracy": 0.92,
        "f1_score": 0.91,
        "precision": 0.90,
        "recall": 0.93
      },
      "feature_importance": {
        "feature1": 0.35,
        "feature2": 0.25,
        ...
      },
      "hyperparameters": {...},
      "model_path": "/app/models/random_forest_1234567890.joblib",
      "n_samples_train": 8000,
      "n_samples_test": 2000,
      "n_features": 15,
      "created_at": "2026-01-25T10:30:00"
    }
  ],
  "total": 42
}
```

### 6. Get Model Details
```http
GET /api/ml-training/models/trained/{job_id}
```

## Usage Examples

### Example 1: Manual Training with Custom Parameters

```python
import requests

# Submit training job
response = requests.post("http://localhost:8000/api/ml-training/train", json={
    "csv_path": "/app/processed_data/my_dataset.csv",
    "target_column": "churn",
    "model_type": "random_forest",
    "params": {
        "n_estimators": 150,
        "max_depth": 12,
        "min_samples_split": 5,
        "criterion": "gini",
        "bootstrap": True
    }
})

job_id = response.json()["job_id"]
print(f"Job submitted: {job_id}")
```

### Example 2: Auto-Tune Mode

```python
# Let the system suggest parameters
response = requests.post("http://localhost:8000/api/ml-training/train", json={
    "csv_path": "/app/processed_data/my_dataset.csv",
    "target_column": "price",
    "model_type": "ridge_regression",
    "auto_tune": True  # System will analyze dataset and suggest params
})
```

### Example 3: Get Suggestions First, Then Train

```python
# 1. Get suggestions
suggestions = requests.post("http://localhost:8000/api/ml-training/suggest-hyperparameters", json={
    "csv_path": "/app/processed_data/my_dataset.csv",
    "model_type": "gradient_boosting"
}).json()

print("Suggested params:", suggestions["suggested_params"])

# 2. Modify suggestions if needed
params = suggestions["suggested_params"]
params["learning_rate"] = 0.05  # Override one parameter

# 3. Train with modified params
response = requests.post("http://localhost:8000/api/ml-training/train", json={
    "csv_path": "/app/processed_data/my_dataset.csv",
    "target_column": "outcome",
    "model_type": "gradient_boosting",
    "params": params
})
```

## Frontend Integration Guide

### 1. Fetch Available Models

```javascript
const models = await fetch('/api/ml-training/models').then(r => r.json());
// Render model selection dropdown
```

### 2. Dynamically Render Hyperparameter Controls

```javascript
const manifest = await fetch(`/api/ml-training/models/${modelType}/manifest`)
  .then(r => r.json());

// For each parameter in manifest.ui_manifest:
Object.entries(manifest.ui_manifest).forEach(([param, config]) => {
  if (config.type === 'range') {
    // Render slider: min, max, step, default
  } else if (config.type === 'choice') {
    // Render dropdown: options, default
  } else if (config.type === 'boolean') {
    // Render toggle: default
  }
});
```

### 3. Submit Training Job

```javascript
const response = await fetch('/api/ml-training/train', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    csv_path: selectedCsvPath,
    target_column: selectedColumn,
    model_type: selectedModel,
    params: userSelectedParams,
    auto_tune: autoTuneEnabled
  })
});

const { job_id } = await response.json();
// Listen to Redis 'crawl_events' for progress updates
```

### 4. Monitor Training Progress

Subscribe to Redis events:

```javascript
// Client-side: Use SSE or WebSocket to receive events
// Events published to 'crawl_events' channel:

// Start event:
{ "job_id": "...", "type": "model_training", "status": "started", "model_type": "..." }

// Success event:
{ 
  "job_id": "...", 
  "type": "model_training", 
  "status": "completed",
  "metrics": { "accuracy": 0.92, ... },
  "feature_importance": { ... },
  ...
}

// Failure event:
{ "job_id": "...", "type": "model_training", "status": "failed", "error": "..." }
```

### 5. Display Results

```javascript
// Fetch completed model details
const model = await fetch(`/api/ml-training/models/trained/${job_id}`)
  .then(r => r.json());

// Display metrics
console.log('Accuracy:', model.metrics.accuracy);

// Visualize feature importance
const importanceChart = createBarChart(model.feature_importance);
```

## Metrics Returned

### Classification Models
- **accuracy**: Overall accuracy
- **f1_score**: Weighted F1 score
- **precision**: Weighted precision
- **recall**: Weighted recall

### Regression Models
- **r2_score**: R² coefficient of determination
- **mae**: Mean Absolute Error
- **mse**: Mean Squared Error
- **rmse**: Root Mean Squared Error

## Adding New Models

To add a new model, create a new strategy class:

```python
# In ml_training/strategies.py

class XGBoostStrategy(ModelStrategy):
    def create_model(self, params: Dict[str, Any]):
        from xgboost import XGBClassifier
        return XGBClassifier(**params)
    
    def train(self, model, X_train, y_train):
        model.fit(X_train, y_train)
        return model
    
    def evaluate(self, model, X_test, y_test):
        # Return metrics dict
        pass
    
    def get_feature_importance(self, model, feature_names):
        # Return feature importance dict
        pass
    
    @property
    def task_type(self):
        return "classification"
```

Then register it in `registry.py`:

```python
"xgboost": {
    "strategy": XGBoostStrategy,
    "task_type": "classification",
    "ui_manifest": {
        "n_estimators": {...},
        "learning_rate": {...},
        ...
    }
}
```

## Testing

### Test the Registry

```python
from ml_training.registry import ModelRegistry

registry = ModelRegistry()

# List models
print(registry.list_models())

# Get manifest
manifest = registry.get_ui_manifest("random_forest")
print(manifest)

# Get suggestions
params = registry.suggest_hyperparameters("random_forest", 10000, 20)
print(params)
```

### Test Training Locally

```python
from ml_training.core import ModelTrainer

trainer = ModelTrainer(
    csv_path="/app/test_data.csv",
    target_column="target",
    model_type="random_forest",
    params={"n_estimators": 100, "max_depth": 10}
)

result = trainer.train_model()
print(result["metrics"])
print(result["feature_importance"])
```

## Troubleshooting

### Model file not saved
- Check `/app/models/` directory exists
- Verify permissions on the directory
- Check disk space

### Task not executing
- Ensure `ml_worker` container is running
- Check Celery logs: `docker logs ml_worker`
- Verify Redis connection
- Confirm task is routed to `ml_tasks` queue

### CSV not found
- Ensure the CSV path is absolute and accessible from the container
- Mount the appropriate volume in docker-compose.yaml

### Database errors
- Verify Postgres connection
- Run the table creation manually if needed
- Check database credentials in .env

### Import errors
- Ensure `scikit-learn` and `joblib` are in requirements.txt
- Rebuild Docker image: `docker-compose build backend ml_worker`

## Performance Considerations

- **Large Datasets**: Consider using `subsample` parameter for gradient boosting
- **Many Features**: Linear models may be faster than tree-based models
- **Memory**: Monitor container memory usage for large models
- **CPU**: Set `n_jobs=-1` for parallel training (already configured)

## Security Considerations

- Validate CSV paths to prevent path traversal attacks
- Sanitize model names and parameters
- Limit model file storage size
- Implement rate limiting on training endpoints
- Add authentication/authorization as needed

## Future Enhancements

Potential additions:
- Cross-validation support
- Hyperparameter tuning (GridSearch, RandomSearch)
- Model comparison and A/B testing
- Ensemble methods
- Deep learning models (TensorFlow/PyTorch)
- Model versioning
- Model deployment API
- Batch prediction endpoint
- Model explainability (SHAP values)