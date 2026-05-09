import os
import joblib
import pandas as pd
import numpy as np
import psycopg
from psycopg.rows import dict_row
import json

# DB Config
DB_HOST = "localhost"
DB_NAME = "scraper_db"
DB_USER = "postgres"
DB_PASSWORD = "i forgot again"
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:5432/{DB_NAME}"

def run_test():
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                # 1. Get the latest hockey model
                cur.execute("""
                    SELECT job_id, model_path, feature_names, target_column, source_csv
                    FROM model_registry
                    WHERE source_csv LIKE '%%hockey%%'
                    ORDER BY created_at DESC
                    LIMIT 1;
                """)
                model_meta = cur.fetchone()
                if not model_meta:
                    print("No hockey model found.")
                    return

                print(f"Testing Model: {model_meta['job_id']}")
                print(f"Target Column: {model_meta['target_column']}")
                
                # 2. Get Raw Data Stats from processed_items
                #    In this system, processed_items.data contains the original values
                dataset_name = os.path.basename(model_meta['source_csv']).replace(".csv", "")
                cur.execute("""
                    SELECT data 
                    FROM processed_items 
                    WHERE source_dataset = %s 
                    LIMIT 1000;
                """, (dataset_name,))
                rows = cur.fetchall()
                if not rows:
                    print("No raw data found in processed_items.")
                    return
                
                raw_df = pd.DataFrame([json.loads(r['data']) if isinstance(r['data'], str) else r['data'] for r in rows])
                target_col = model_meta['target_column']
                
                if target_col in raw_df.columns:
                    raw_min = raw_df[target_col].min()
                    raw_max = raw_df[target_col].max()
                    print(f"Ref Range for {target_col}: min={raw_min}, max={raw_max}")
                else:
                    print(f"Target {target_col} not found in raw data.")
                    raw_min, raw_max = 0, 1

                local_model_path = model_meta['model_path'].replace("/app/", "c:/Users/benso/Projects/Auto crawling and ML project/backend/")
                if not os.path.exists(local_model_path):
                    print(f"Model file missing: {local_model_path}")
                    return
                
                package = joblib.load(local_model_path)
                model = package['model']
                feature_names = model_meta['feature_names']

                # 4. Create an 'Actual Value' input
                #    Based on the diagnostic, we know 'goals_for' should be ~160-250
                #    and 'wins' should be ~40.
                print("\n--- Running Prediction Simulation ---")
                test_input = {f: 0 for f in feature_names}
                # Feed some plausible 'actual' values
                if 'goals_for' in test_input: test_input['goals_for'] = 200
                if 'losses' in test_input: test_input['losses'] = 30
                if 'goal_difference' in test_input: test_input['goal_difference'] = 20
                if 'team_name' in test_input: test_input['team_name'] = 5 # Label encoded
                
                input_df = pd.DataFrame([test_input])
                
                # Replay the 'bad' normalization (fitting on already normalized data)
                processed_csv = model_meta['source_csv']
                if os.path.exists(processed_csv):
                    df_proc = pd.read_csv(processed_csv)
                    for col in feature_names:
                        if col in df_proc.columns and pd.api.types.is_numeric_dtype(df_proc[col]):
                            # This is what predict_router.py does:
                            c_min = df_proc[col].min()
                            c_max = df_proc[col].max()
                            input_df[col] = (input_df[col] - c_min) / (c_max - c_min + 1e-9)
                
                print(f"Transformed Feature Vector (what model sees):\n{input_df}")
                
                prediction = model.predict(input_df[feature_names].values)[0]
                print(f"\nRaw Prediction: {prediction:.4f}")
                
                # Un-normalize back to wins
                unnormalized = prediction * (raw_max - raw_min) + raw_min
                print(f"Un-normalized Prediction (Actual Wins): {unnormalized:.2f}")

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    run_test()
