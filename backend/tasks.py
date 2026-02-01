import os
import json
import redis
import psycopg
import numpy as np
import pandas as pd
from psycopg.rows import dict_row
from celery import Celery
import hashlib
from ml_processor.core import UniversalEngine
from ml_training.core import ModelTrainer
from ml_training_task import persist_model_metadata

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
DB_HOST = os.getenv("DB_HOST", "postgres")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:5432/{DB_NAME}"

celery_app = Celery(
    'ml_worker',
    broker=f'redis://{REDIS_HOST}:6379/0',
    backend=f'redis://{REDIS_HOST}:6379/1'
)

def fetch_dataset(dataset_name):
    """Connects to Postgres to get raw scraped data"""
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM scraped_items WHERE dataset_name = %s", (dataset_name,))
            rows = cur.fetchall()
            return [row['data'] for row in rows]

def archive_processed_data(df, source_name, pipeline_config):
    """Archives the cleaned dataframe into the processed_items table"""
    # 1. Prepare data: Replace NaNs/inf with None
    df_clean = df.replace([np.nan, np.inf, -np.inf], None)
    records = df_clean.to_dict(orient='records')
    # 2. Serialize pipeline config
    config_json = json.dumps(pipeline_config)

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            # Ensure table exists (including new column)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS processed_items (
                    id SERIAL PRIMARY KEY,
                    source_dataset VARCHAR(255),
                    operations_applied JSONB,
                    data JSONB,
                    row_hash TEXT,
                    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # 3. Insert each record with computed hash
            for record in records:
                # Convert to stable JSON string (sort keys + consistent formatting)
                record_json = json.dumps(record, sort_keys=True, separators=(',', ':'))
                # Compute SHA-256 hash
                row_hash = hashlib.sha256(record_json.encode('utf-8')).hexdigest()

                cur.execute(
                    """
                    INSERT INTO processed_items
                    (source_dataset, operations_applied, data, row_hash)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (source_name, config_json, json.dumps(record), row_hash)
                )
            conn.commit()

@celery_app.task(bind=True)
def run_ml_pipeline(self, dataset_name, pipeline_config):
    """Existing data cleaning pipeline task"""
    job_id = self.request.id
    r = redis.Redis(host=REDIS_HOST, port=6379, db=0)
    r.publish('crawl_events', json.dumps({
        "job_id": job_id, "type": "ml_job", "status": "started"
    }))

    try:
        raw_data = fetch_dataset(dataset_name)
        if not raw_data:
            raise ValueError("Dataset empty or not found")

        engine = UniversalEngine(raw_data)
        processed_df, logs = engine.run_pipeline(pipeline_config)

        # --- NEW: ARCHIVE STEP ---
        archive_processed_data(processed_df, dataset_name, pipeline_config)
        # -------------------------

        # Handle NaN for the preview JSON
        preview_df = processed_df.fillna("NaN")
        preview = preview_df.head(5).to_dict(orient='records')

        result_payload = {
            "job_id": job_id,
            "type": "ml_job",
            "status": "completed",
            "logs": logs,
            "preview": preview,
            "total_rows": len(processed_df),
            "columns": list(processed_df.columns)
        }
        r.publish('crawl_events', json.dumps(result_payload))
        return "Pipeline execution and archiving successful"

    except Exception as e:
        r.publish('crawl_events', json.dumps({
            "job_id": job_id, "type": "ml_job", "status": "failed", "error": str(e)
        }))
        raise e


@celery_app.task(bind=True, name='run_model_training')
def run_model_training(self, csv_path: str, target_column: str, model_type: str, params: dict):
    """
    NEW: Celery task to train a machine learning model.
    
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