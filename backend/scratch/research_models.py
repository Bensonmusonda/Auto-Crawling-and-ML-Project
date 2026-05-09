import os
import psycopg
from psycopg.rows import dict_row
import json

# Try to get DB config from env or defaults
DB_HOST = "localhost"
DB_NAME = "scraper_db"
DB_USER = "postgres"
DB_PASSWORD = "i forgot again"
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:5432/{DB_NAME}"

def get_models():
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                # 1. Get recent models
                cur.execute("""
                    SELECT job_id, model_type, target_column, source_csv, created_at 
                    FROM model_registry 
                    ORDER BY created_at DESC 
                    LIMIT 20;
                """)
                models = cur.fetchall()
                print("--- RECENT MODELS ---")
                for m in models:
                    print(f"ID: {m['job_id'][:8]}... | Type: {m['model_type']:15} | Target: {m['target_column']:15} | Date: {m['created_at']}")
                
                # 2. Get processing operations for the latest dataset
                if models:
                    latest_csv = models[0]['source_csv']
                    if latest_csv:
                        dataset_name = os.path.basename(latest_csv).replace(".csv", "")
                        cur.execute("""
                            SELECT source_dataset, operations_applied, processed_at
                            FROM processed_items
                            WHERE source_dataset = %s
                            ORDER BY processed_at DESC
                            LIMIT 1;
                        """, (dataset_name,))
                        proc = cur.fetchone()
                        if proc:
                            print(f"\n--- LATEST PROCESSING FOR {dataset_name} ---")
                            print(f"Operations: {proc['operations_applied']}")

    except Exception as e:
        print(f"Error connecting to DB: {e}")

if __name__ == "__main__":
    get_models()
