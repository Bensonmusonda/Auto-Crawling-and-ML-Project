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

def fetch_dataset(dataset_name, source="db"):
    """Connects to Postgres to get raw scraped data or reads CSV if source == 'csv'"""
    if source == "csv":
        csv_path = f"/app/datasets/{dataset_name}.csv"
        if os.path.exists(csv_path):
            return pd.read_csv(csv_path)

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
def run_ml_pipeline(self, dataset_name, pipeline_config, source="csv"):
    job_id = self.request.id
    r = redis.Redis(host=REDIS_HOST, port=6379, db=0)
    r.publish('crawl_events', json.dumps({
        "job_id": job_id, "type": "ml_job", "status": "started"
    }))

    try:
        raw_data = fetch_dataset(dataset_name, source=source)
        if raw_data is None or (isinstance(raw_data, list) and not raw_data) or (isinstance(raw_data, pd.DataFrame) and raw_data.empty):
            raise ValueError("Dataset empty or not found")

        engine = UniversalEngine(raw_data)
        processed_df, logs = engine.run_pipeline(pipeline_config)

        archive_processed_data(processed_df, dataset_name, pipeline_config)

        # ── Save CSV to /app/datasets/ ──────────────────────────
        os.makedirs('/app/datasets', exist_ok=True)
        csv_path = f"/app/datasets/{dataset_name}.csv"
        processed_df.to_csv(csv_path, index=False, encoding='utf-8-sig')
        # ────────────────────────────────────────────────────────

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

# ── Workflow Run Helpers ────────────────────────────────────
def ensure_workflow_runs_table(conn):
    """Create workflow_runs table if it doesn't exist."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS workflow_runs (
                id            SERIAL PRIMARY KEY,
                run_id        VARCHAR(64) UNIQUE NOT NULL,
                workflow_id   INTEGER NOT NULL,
                status        VARCHAR(32) DEFAULT 'running',
                crawl_job_id  VARCHAR(255),
                model_job_id  VARCHAR(255),
                output_csv    TEXT,
                stage_results JSONB DEFAULT '{}',
                started_at    TIMESTAMP DEFAULT NOW(),
                finished_at   TIMESTAMP
            );
        """)
        conn.commit()


def create_workflow_run(run_id, workflow_id):
    """Insert a new run record at the start of execution."""
    with psycopg.connect(DATABASE_URL) as conn:
        ensure_workflow_runs_table(conn)
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO workflow_runs (run_id, workflow_id, status, started_at)
                VALUES (%s, %s, 'running', NOW())
                ON CONFLICT (run_id) DO NOTHING
            """, (run_id, workflow_id))
            conn.commit()


def update_workflow_run(run_id, **kwargs):
    """Patch any columns on the workflow_run row."""
    if not kwargs:
        return
    allowed = {'status', 'crawl_job_id', 'model_job_id', 'output_csv', 'stage_results', 'finished_at'}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return
    set_clause = ', '.join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [run_id]
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE workflow_runs SET {set_clause} WHERE run_id = %s",
                values
            )
            conn.commit()


@celery_app.task(bind=True, name='run_workflow')
def run_workflow(self, workflow_id: int):
    job_id = self.request.id
    r = redis.Redis(host=REDIS_HOST, port=6379, db=0)
    import time

    # ── Create run record ───────────────────────────────────────
    create_workflow_run(job_id, workflow_id)
    stage_results = {}

    def publish(status, stage=None, message=None, error=None):
        r.publish('crawl_events', json.dumps({
            "job_id": job_id,
            "type": "workflow",
            "workflow_id": workflow_id,
            "stage": stage,
            "status": status,
            "message": message,
            "error": error
        }))

    def record_stage(stage, status, message=None):
        """Update stage_results in memory and persist to DB."""
        stage_results[stage] = {"status": status, "message": message}
        update_workflow_run(job_id, stage_results=json.dumps(stage_results))

    def update_workflow_status(status):
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE workflows
                    SET last_run_at = NOW(), last_run_status = %s
                    WHERE id = %s
                """, (status, workflow_id))
                conn.commit()
    timeout = 3600

    try:
        # Load workflow
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM workflows WHERE id = %s", (workflow_id,))
                workflow = cur.fetchone()

        if not workflow:
            raise ValueError(f"Workflow {workflow_id} not found")

        dataset_name = workflow['dataset_name']
        stages = workflow['stages']

        publish('started', message=f"Workflow '{workflow['name']}' started")
        update_workflow_status('running')

        # ── Stage 1: Crawl ──────────────────────────────────────
        crawl_job_id = None
        if stages.get('crawl', {}).get('enabled'):
            publish('running', stage='crawl', message='Crawl stage started')

            crawl_config = stages['crawl']['config']
            crawl_config['dataset_name'] = dataset_name

            crawl_task = celery_app.send_task(
                'tasks.run_crawl_task',
                args=[crawl_config],
                queue='celery'
            )
            crawl_job_id = crawl_task.id
            update_workflow_run(job_id, crawl_job_id=crawl_job_id)

            # Wait for done/error event via Redis pub/sub
            pubsub = r.pubsub()
            pubsub.subscribe('crawl_events')
            crawl_done = False
            start = time.time()

            for message in pubsub.listen():
                if time.time() - start > timeout:
                    raise TimeoutError("Crawl stage timed out")
                if message['type'] != 'message':
                    continue
                try:
                    data = json.loads(message['data'])
                    if data.get('job_id') != crawl_task.id:
                        continue
                    if data.get('event') in ('done', 'finished'):
                        crawl_done = True
                        break
                    if data.get('event') == 'error':
                        raise RuntimeError(f"Crawl failed: {data.get('message')}")
                except Exception:
                    continue

            pubsub.unsubscribe()
            if not crawl_done:
                raise RuntimeError("Crawl stage did not complete")

            record_stage('crawl', 'completed', 'Crawl stage complete')
            publish('completed', stage='crawl', message='Crawl stage complete')

        # ── Stage 2: Processing ─────────────────────────────────
        csv_path = os.path.join('/app/datasets', f"{dataset_name}.csv")

        if stages.get('processing', {}).get('enabled'):
            publish('running', stage='processing', message='Processing stage started')

            pipeline_config = stages['processing']['config']['steps']

            raw_data = fetch_dataset(dataset_name, source='csv')
            if raw_data is None or (isinstance(raw_data, list) and not raw_data) or \
               (hasattr(raw_data, 'empty') and raw_data.empty):
                raise ValueError(f"No data found for dataset '{dataset_name}'")

            engine = UniversalEngine(raw_data)
            processed_df, logs = engine.run_pipeline(pipeline_config)

            archive_processed_data(processed_df, dataset_name, pipeline_config)

            os.makedirs('/app/datasets', exist_ok=True)
            processed_df.to_csv(csv_path, index=False, encoding='utf-8-sig')

            row_count = len(processed_df)
            col_count = len(processed_df.columns)
            record_stage('processing', 'completed',
                         f'{row_count} rows, {col_count} columns')
            publish('completed', stage='processing',
                    message=f'Processing complete — {row_count} rows, {col_count} columns')

        # ── Stage 3: ML Training ────────────────────────────────
        model_job_id = None
        if stages.get('ml', {}).get('enabled'):
            publish('running', stage='ml', message='ML training stage started')

            ml_config = stages['ml']['config']

            if not os.path.exists(csv_path):
                raise FileNotFoundError(
                    f"CSV not found at {csv_path}. "
                    "Enable the processing stage or save the dataset first."
                )

            # Validate target_column exists in the CSV
            df_temp = pd.read_csv(csv_path)
            target_col = ml_config.get('target_column', '')
            if target_col not in df_temp.columns:
                raise ValueError(
                    f"target_column '{target_col}' not found in processed CSV. "
                    f"Available columns: {list(df_temp.columns)}"
                )

            params = ml_config.get('params') or {}
            if ml_config.get('auto_tune', True) or not params:
                from ml_training.registry import ModelRegistry
                reg = ModelRegistry()
                params = reg.suggest_hyperparameters(
                    ml_config['model_type'],
                    n_samples=len(df_temp),
                    n_features=len(df_temp.columns) - 1
                )

            ml_task = celery_app.send_task(
                'run_model_training',
                args=[csv_path, target_col, ml_config['model_type'], params],
                queue='ml_tasks'
            )
            model_job_id = ml_task.id
            update_workflow_run(job_id, model_job_id=model_job_id)

            pubsub = r.pubsub()
            pubsub.subscribe('crawl_events')
            ml_done = False
            start = time.time()

            for message in pubsub.listen():
                if time.time() - start > timeout:
                    raise TimeoutError("ML training stage timed out")
                if message['type'] != 'message':
                    continue
                try:
                    data = json.loads(message['data'])
                    if data.get('job_id') != ml_task.id:
                        continue
                    if data.get('type') == 'model_training':
                        if data.get('status') == 'completed':
                            ml_done = True
                            break
                        if data.get('status') == 'failed':
                            raise RuntimeError(f"ML training failed: {data.get('error')}")
                except Exception:
                    continue

            pubsub.unsubscribe()
            if not ml_done:
                raise RuntimeError("ML training stage did not complete")

            record_stage('ml', 'completed', 'Training complete')
            publish('completed', stage='ml', message='ML training complete')

        # ── All stages done ─────────────────────────────────────
        update_workflow_run(
            job_id,
            status='completed',
            finished_at=time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())
        )
        publish('completed', message=f"Workflow '{workflow['name']}' completed successfully")
        update_workflow_status('completed')
        return f"Workflow {workflow_id} completed"

    except Exception as e:
        record_stage('error', 'failed', str(e))
        update_workflow_run(
            job_id,
            status='failed',
            finished_at=time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())
        )
        publish('failed', error=str(e))
        update_workflow_status('failed')
        raise e