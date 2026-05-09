import os
import json
import joblib
import numpy as np
import pandas as pd
import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException
from sklearn.preprocessing import LabelEncoder, MinMaxScaler, StandardScaler

try:
    from sklearn.preprocessing import RobustScaler
    HAS_ROBUST = True
except ImportError:
    HAS_ROBUST = False

router = APIRouter(prefix="/api/ml-training", tags=["ML Training"])

DB_HOST = os.getenv("DB_HOST", "postgres")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:5432/{DB_NAME}"

TRANSFORM_STEPS = {"normalize", "scale", "encode_categorical", "label_encode", "one_hot"}
SKIP_STEPS = {
    "drop_columns", "drop_nulls", "drop_missing", "remove_duplicates",
    "filter_rows", "rename_columns", "convert_type", "clean_numeric_column",
    "clean_text", "sentiment", "fill_missing", "impute"
}


def _get_scaler(method: str):
    method = (method or "minmax").lower()
    if method in ("z_score", "standard"):
        return StandardScaler()
    if method == "robust" and HAS_ROBUST:
        return RobustScaler()
    return MinMaxScaler()


def _load_raw_df(dataset_name: str) -> pd.DataFrame:
    """
    Load raw scraped data from Postgres scraped_items table.
    Used for fitting label encoders on original string values.
    """
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT data FROM scraped_items WHERE dataset_name = %s",
                    (dataset_name,)
                )
                rows = cur.fetchall()
                if rows:
                    return pd.DataFrame([r["data"] for r in rows])
    except Exception:
        pass
    return pd.DataFrame()


def _apply_pipeline_to_row(
    input_df: pd.DataFrame,
    operations: list,
    source_csv: str,
    dataset_name: str,
) -> pd.DataFrame:
    """
    Replay value-transforming pipeline steps on a single input row.

    - normalize / scale  → fit scaler on processed CSV (correct numeric range)
    - encode_categorical / label_encode → fit encoder on raw scraped_items
      (original string values, e.g. 'Vancouver Canucks' not 21)
    - one_hot → same as label_encode, uses raw data
    """
    if not operations:
        return input_df

    # Lazy-load — only read files/DB when actually needed
    _processed_df = None
    _raw_df = None

    def get_processed():
        nonlocal _processed_df
        if _processed_df is None and source_csv and os.path.exists(source_csv):
            try:
                _processed_df = pd.read_csv(source_csv)
            except Exception:
                _processed_df = pd.DataFrame()
        return _processed_df if _processed_df is not None else pd.DataFrame()

    def get_raw():
        nonlocal _raw_df
        if _raw_df is None:
            _raw_df = _load_raw_df(dataset_name)
        return _raw_df

    for op in operations:
        step = op.get("step", "")
        params = op.get("params", {})

        if step in SKIP_STEPS:
            continue

        # ── Normalize / scale ────────────────────────────────────────────
        if step in ("normalize", "scale"):
            method = params.get("method", "minmax")
            cols_str = params.get("columns", "")
            cols = [c.strip() for c in cols_str.split(",") if c.strip()] if cols_str else []

            processed = get_processed()
            if processed.empty:
                continue

            if not cols:
                cols = processed.select_dtypes(include="number").columns.tolist()

            valid_cols = [
                c for c in cols
                if c in processed.columns and c in input_df.columns
            ]
            if not valid_cols:
                continue

            scaler = _get_scaler(method)
            try:
                # CRITICAL FIX: If processed looks already normalized [0,1], 
                # we need to find the RAW ranges to properly scale the user input.
                sample_range = processed[valid_cols].max() - processed[valid_cols].min()
                if (sample_range <= 1.0001).all() and (processed[valid_cols].min() >= -0.0001).all():
                    # The CSV is already normalized! Fitting on it is useless for "actual" values.
                    # Try to get raw distribution from the DB
                    raw = get_raw()
                    if not raw.empty and all(c in raw.columns for c in valid_cols):
                        scaler.fit(raw[valid_cols].astype(float).values)
                    else:
                        # Fallback: if we can't get raw, we can't scale "actual" values.
                        # We just have to hope the user entered normalized values.
                        pass
                else:
                    scaler.fit(processed[valid_cols].values)

                input_df[valid_cols] = scaler.transform(
                    input_df[valid_cols].values
                )
            except Exception:
                pass

        # ── Label encode / encode_categorical ────────────────────────────
        elif step in ("encode_categorical", "label_encode"):
            cols_str = params.get("columns", "")
            cols = [c.strip() for c in cols_str.split(",") if c.strip()] if cols_str else []
            method = params.get("method", "label")

            raw = get_raw()

            if method == "one_hot":
                for col in cols:
                    if col not in input_df.columns:
                        continue
                    # Use raw data if available, else processed
                    ref_df = raw if col in raw.columns else get_processed()
                    if ref_df.empty or col not in ref_df.columns:
                        continue
                    dummies = pd.get_dummies(ref_df[col], prefix=col, dummy_na=False)
                    for dummy_col in dummies.columns:
                        input_df[dummy_col] = 0
                    val = str(input_df[col].iloc[0])
                    target_col_name = f"{col}_{val}"
                    if target_col_name in input_df.columns:
                        input_df[target_col_name] = 1
                    input_df.drop(columns=[col], inplace=True, errors="ignore")
            else:
                for col in cols:
                    if col not in input_df.columns:
                        continue
                    # Use raw data for fitting so we encode original strings
                    ref_df = raw if (not raw.empty and col in raw.columns) else get_processed()
                    if ref_df.empty or col not in ref_df.columns:
                        input_df[col] = -1
                        continue
                    le = LabelEncoder()
                    try:
                        le.fit(ref_df[col].astype(str))
                        raw_val = str(input_df[col].iloc[0])
                        if raw_val in le.classes_:
                            input_df[col] = le.transform([raw_val])[0]
                        else:
                            # Unknown team/category — use median class index
                            input_df[col] = len(le.classes_) // 2
                    except Exception:
                        input_df[col] = -1

        # ── one_hot step directly ────────────────────────────────────────
        elif step == "one_hot":
            cols_str = params.get("columns", "")
            cols = [c.strip() for c in cols_str.split(",") if c.strip()] if cols_str else []
            raw = get_raw()
            for col in cols:
                if col not in input_df.columns:
                    continue
                ref_df = raw if (not raw.empty and col in raw.columns) else get_processed()
                if ref_df.empty or col not in ref_df.columns:
                    continue
                dummies = pd.get_dummies(ref_df[col], prefix=col, dummy_na=False)
                for dummy_col in dummies.columns:
                    input_df[dummy_col] = 0
                val = str(input_df[col].iloc[0])
                target_col_name = f"{col}_{val}"
                if target_col_name in input_df.columns:
                    input_df[target_col_name] = 1
                input_df.drop(columns=[col], inplace=True, errors="ignore")

    return input_df


@router.post("/predict/{job_id}")
async def predict(job_id: str, payload: dict):
    """
    Run a prediction using a trained model.

    Accepts { feature_name: raw_value, ... } in original unprocessed form.
    String values like 'Vancouver Canucks' are accepted for categorical features
    and encoded automatically using the original scraped data as reference.
    Numeric features are normalized automatically using the processed CSV.
    """
    # 1. Load model metadata
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT model_path, feature_names, task_type,
                           source_csv, target_column, model_type
                    FROM model_registry
                    WHERE job_id = %s
                    """,
                    (job_id,),
                )
                row = cur.fetchone()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    if not row:
        raise HTTPException(status_code=404, detail=f"Model {job_id} not found")

    model_path    = row["model_path"]
    feature_names = row["feature_names"] or []
    task_type     = row["task_type"]
    source_csv    = row["source_csv"] or ""
    target_column = row["target_column"]
    model_type    = row["model_type"]

    # 2. Validate model file
    if not os.path.exists(model_path):
        raise HTTPException(
            status_code=404,
            detail=f"Model file not found at {model_path}."
        )

    # 3. Validate features
    missing = [f for f in feature_names if f not in payload]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Missing features: {missing}. Required: {feature_names}"
        )

    # 4. Build input DataFrame
    try:
        input_values = {f: payload[f] for f in feature_names}
        input_df = pd.DataFrame([input_values])
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid input: {str(e)}")

    # 5. Derive dataset name from source_csv path
    dataset_name = os.path.basename(source_csv).replace(".csv", "") if source_csv else ""

    # 6. Load processing pipeline for this dataset
    operations = []
    if dataset_name:
        try:
            with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT operations_applied
                        FROM processed_items
                        WHERE source_dataset = %s
                        ORDER BY processed_at DESC
                        LIMIT 1
                        """,
                        (dataset_name,),
                    )
                    ops_row = cur.fetchone()
                    if ops_row and ops_row["operations_applied"]:
                        ops = ops_row["operations_applied"]
                        operations = ops if isinstance(ops, list) else json.loads(ops)
        except Exception:
            pass

    # 7. Replay pipeline on input row
    input_df = _apply_pipeline_to_row(
        input_df, operations, source_csv, dataset_name
    )

    # 8. Coerce all feature columns to numeric
    for col in feature_names:
        if col in input_df.columns:
            input_df[col] = pd.to_numeric(
                input_df[col], errors="coerce"
            ).fillna(0)
        else:
            input_df[col] = 0

    # 9. Load model and predict
    try:
        model_package = joblib.load(model_path)
        model         = model_package["model"]
        label_encoder = model_package.get("label_encoder")

        X = input_df[feature_names].values
        raw_prediction = model.predict(X)[0]

        predicted_label = None
        if task_type == "classification" and label_encoder is not None:
            try:
                predicted_label = label_encoder.inverse_transform(
                    [int(raw_prediction)]
                )[0]
            except Exception:
                predicted_label = str(raw_prediction)

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Prediction failed: {str(e)}"
        )

    # 10. Build response
    steps_applied = [
        op["step"] for op in operations
        if op.get("step") in TRANSFORM_STEPS
    ]

    result = {
        "job_id":                  job_id,
        "model_type":              model_type,
        "task_type":               task_type,
        "target_column":           target_column,
        "input_features":          input_values,
        "pipeline_steps_applied":  steps_applied,
    }

    if task_type == "regression":
        pred_val = float(raw_prediction)
        
        # Target Un-normalization: If target_column is in processed_csv and looks normalized [0,1],
        # try to un-normalize it for display
        display_val = pred_val
        # Only attempt un-normalization if the prediction itself looks normalized
        # (i.e. it falls inside [0, 1]). If the model was trained on raw values the
        # prediction will already be in real units and must not be scaled up.
        if 0.0 <= pred_val <= 1.0 and source_csv and os.path.exists(source_csv):
            try:
                df_proc = pd.read_csv(source_csv)
                if target_column in df_proc.columns:
                    t_min = df_proc[target_column].min()
                    t_max = df_proc[target_column].max()
                    if t_min >= -0.0001 and t_max <= 1.0001:
                        # Target was normalized. Try to find raw range.
                        raw = _load_raw_df(dataset_name)
                        if not raw.empty and target_column in raw.columns:
                            raw_target = pd.to_numeric(raw[target_column], errors='coerce').dropna()
                            if not raw_target.empty:
                                r_min = raw_target.min()
                                r_max = raw_target.max()
                                display_val = pred_val * (r_max - r_min) + r_min
            except Exception:
                pass

        result["prediction"]         = round(pred_val, 4)
        result["prediction_display"] = str(round(display_val, 2))
    else:
        result["prediction"]         = int(raw_prediction)
        result["prediction_display"] = (
            str(predicted_label) if predicted_label is not None
            else str(int(raw_prediction))
        )

    return result