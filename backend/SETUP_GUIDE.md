# ML Training Module - Setup Guide

## Quick Setup Steps

### 1. Create Directory Structure

```bash
cd "C:\Users\benso\Projects\Auto crawling and ML project\backend"

# Create the ml_training module directory
mkdir ml_training
```

### 2. Create Module Files

Copy the following files into your `backend/` directory:

```
backend/
├── ml_training/
│   ├── __init__.py          # From artifact: ml_training_init
│   ├── registry.py          # From artifact: ml_training_registry
│   ├── strategies.py        # From artifact: ml_training_strategies
│   └── core.py             # From artifact: ml_training_core
├── ml_training_task.py      # From artifact: ml_training_task
├── ml_training_schemas.py   # From artifact: ml_training_schemas
└── ml_training_router.py    # From artifact: ml_training_router
```

### 3. Update Existing Files

#### Update `backend/tasks.py`
Replace your current `backend/tasks.py` with the updated version (artifact: updated_tasks), or add these lines:

```python
# Add these imports at the top
from ml_training.core import ModelTrainer
from ml_training_task import persist_model_metadata

# Add this new task at the bottom
@celery_app.task(bind=True, name='run_model_training')
def run_model_training(self, csv_path: str, target_column: str, model_type: str, params: dict):
    # ... (copy the full implementation from the artifact)
```

#### Update `backend/main.py`
Add this import and router inclusion:

```python
from ml_training_router import router as ml_training_router

# After your app initialization:
app.include_router(ml_training_router)
```

#### Update `backend/requirements.txt`
Add these dependencies:

```txt
scikit-learn>=1.3.0
joblib>=1.3.0
```

### 4. Rebuild Docker Containers

```bash
cd "C:\Users\benso\Projects\Auto crawling and ML project"

# Rebuild the containers
docker-compose build backend ml_worker

# Restart the services
docker-compose down
docker-compose up -d
```

### 5. Verify Installation

Check that containers are running:

```bash
docker-compose ps
```

You should see:
- `backend` (FastAPI)
- `ml_worker` (Celery worker)
- `redis_service`
- `postgres_service`

### 6. Test the API

#### Test 1: List Available Models
```bash
curl http://localhost:8000/api/ml-training/models
```

Expected response:
```json
{
  "models": ["random_forest", "logistic_regression", ...],
  "models_by_type": {...}
}
```

#### Test 2: Get Model Manifest
```bash
curl http://localhost:8000/api/ml-training/models/random_forest/manifest
```

Expected response:
```json
{
  "model_type": "random_forest",
  "task_type": "classification",
  "ui_manifest": {...}
}
```

#### Test 3: Check Database Table
```bash
# Connect to postgres
docker exec -it postgres_service psql -U postgres -d scraper_db

# List tables
\dt

# Should see 'model_registry' table
# Exit with \q
```

### 7. Run a Test Training Job

Create a test CSV file or use one of your processed datasets:

```bash
curl -X POST http://localhost:8000/api/ml-training/train \
  -H "Content-Type: application/json" \
  -d '{
    "csv_path": "/path/to/your/processed_dataset.csv",
    "target_column": "your_target_column",
    "model_type": "random_forest",
    "auto_tune": true
  }'
```

Expected response:
```json
{
  "job_id": "abc-123-def-456",
  "status": "submitted",
  "message": "Model training job submitted for random_forest"
}
```

### 8. Monitor Training Progress

#### Check Celery Logs
```bash
docker logs -f ml_worker
```

#### Check Redis Events
If you have a Redis CLI tool:
```bash
docker exec -it redis_service redis-cli
SUBSCRIBE crawl_events
```

You'll see events like:
```json
{"job_id": "...", "type": "model_training", "status": "started", ...}
{"job_id": "...", "type": "model_training", "status": "completed", "metrics": {...}, ...}
```

#### Query Training Results
```bash
curl http://localhost:8000/api/ml-training/models/trained
```

## File Structure Checklist

After setup, verify you have:

```
backend/
├── ml_training/
│   ├── __init__.py          ✓
│   ├── __pycache__/         (auto-generated)
│   ├── registry.py          ✓
│   ├── strategies.py        ✓
│   └── core.py              ✓
├── ml_processor/            (existing - data cleaning)
│   ├── __init__.py
│   ├── core.py
│   ├── registry.py
│   └── strategies.py
├── models/                  (will be created automatically)
├── Dockerfile               (existing)
├── main.py                  ✓ UPDATED
├── tasks.py                 ✓ UPDATED
├── ml_training_task.py      ✓ NEW
├── ml_training_schemas.py   ✓ NEW
├── ml_training_router.py    ✓ NEW
├── requirements.txt         ✓ UPDATED
└── ... (other existing files)
```

## Common Issues and Solutions

### Issue: Import errors after adding files

**Solution:**
```bash
# Rebuild the Docker image
docker-compose build backend ml_worker
docker-compose restart backend ml_worker
```

### Issue: Task not found in Celery

**Solution:**
Check that the task name matches in both the decorator and the call:
```python
# In tasks.py
@celery_app.task(bind=True, name='run_model_training')

# In router
celery_app.send_task('run_model_training', ...)  # Name must match
```

### Issue: Database table not created

**Solution:**
```bash
# Manually create the table
docker exec -it postgres_service psql -U postgres -d scraper_db

CREATE TABLE IF NOT EXISTS model_registry (
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

### Issue: Models directory not found

**Solution:**
The directory will be created automatically on first training. If you want to create it manually:

```bash
# Inside the container
docker exec -it backend mkdir -p /app/models
docker exec -it backend chmod 777 /app/models
```

Or add a volume mount in docker-compose.yaml:
```yaml
backend:
  volumes:
    - ./backend:/app
    - ./models:/app/models  # Add this line
```

### Issue: CSV file not found

**Solution:**
Ensure the CSV path is accessible from within the Docker container. You may need to:
1. Use an absolute path that's mounted as a volume
2. Save processed CSVs to a known location (e.g., `/app/processed_data/`)

## Next Steps

1. **Test with Real Data**: Use a cleaned CSV from your data processing pipeline
2. **Frontend Integration**: Connect your frontend to the new endpoints
3. **Monitoring**: Set up logging and monitoring for training jobs
4. **Optimization**: Tune the auto-suggestion heuristics based on your use cases
5. **Documentation**: Document your specific model types and use cases

## Support

If you encounter any issues:
1. Check Docker logs: `docker logs backend` and `docker logs ml_worker`
2. Verify database connectivity: `docker exec -it postgres_service psql -U postgres`
3. Test Redis: `docker exec -it redis_service redis-cli ping`
4. Review the comprehensive README in ML_TRAINING_MODULE_README.md

Happy training! 🚀