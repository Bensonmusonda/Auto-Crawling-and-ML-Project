import os
import json
import redis
import psycopg
from celery import Celery
from ml_training.core import ModelTrainer
from ml_training.registry import ModelRegistry

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
DB_HOST = os.getenv("DB_HOST", "postgres")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:5432/{DB_NAME}"


def create_model_registry_table():
    """Create the model_registry table if it doesn't exist"""
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
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
            """)
            conn.commit()


def persist_model_metadata(job_id: str, result: dict, csv_path: str, target_column: str, model_type: str):
    """
    Save model training results to the model_registry table.
    
    Args:
        job_id: Celery task ID
        result: Training result dictionary
        csv_path: Path to the source CSV
        target_column: Target column name
        model_type: Type of model trained
    """
    create_model_registry_table()
    
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO model_registry (
                    job_id, model_type, task_type, model_path,
                    hyperparameters, metrics, feature_importance,
                    feature_names, n_samples_train, n_samples_test,
                    n_features, source_csv, target_column
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (job_id) DO UPDATE SET
                    metrics = EXCLUDED.metrics,
                    feature_importance = EXCLUDED.feature_importance
            """, (
                job_id,
                model_type,
                result["task_type"],
                result["model_path"],
                json.dumps(result["hyperparameters"]),
                json.dumps(result["metrics"]),
                json.dumps(result["feature_importance"]),
                json.dumps(result["feature_names"]),
                result["n_samples_train"],
                result["n_samples_test"],
                result["n_features"],
                csv_path,
                target_column
            ))
            conn.commit()


def run_model_training(self, csv_path: str, target_column: str, model_type: str, params: dict, **kwargs):
    """
    Celery task to train a machine learning model.
    
    Args:
        csv_path: Path to the cleaned CSV file
        target_column: Name of the target column
        model_type: Type of model to train (e.g., 'random_forest')
        params: Dictionary of hyperparameters
        
    Returns:
        JSON payload containing metrics and feature importance
    """
    job_id = self.request.id
    r = redis.Redis(host=REDIS_HOST, port=6379, db=0)
    
    # Publish start event
    r.publish('crawl_events', json.dumps({
        "job_id": job_id,
        "type": "model_training",
        "status": "started",
        "model_type": model_type
    }))
    
    try:
        # Initialize the trainer
        trainer = ModelTrainer(
            csv_path=csv_path,
            target_column=target_column,
            model_type=model_type,
            params=params
        )
        
        # Execute training
        result = trainer.train_model()
        
        # Persist to database
        persist_model_metadata(job_id, result, csv_path, target_column, model_type)
        
        # Prepare success payload
        success_payload = {
            "job_id": job_id,
            "type": "model_training",
            "status": "completed",
            "model_type": model_type,
            "task_type": result["task_type"],
            "metrics": result["metrics"],
            "feature_importance": result["feature_importance"],
            "model_path": result["model_path"],
            "n_features": result["n_features"],
            "n_samples_train": result["n_samples_train"],
            "n_samples_test": result["n_samples_test"]
        }
        
        # Publish completion event
        r.publish('crawl_events', json.dumps(success_payload))
        
        return success_payload
        
    except Exception as e:
        # Publish failure event
        error_payload = {
            "job_id": job_id,
            "type": "model_training",
            "status": "failed",
            "error": str(e),
            "model_type": model_type
        }
        r.publish('crawl_events', json.dumps(error_payload))
        raise e
