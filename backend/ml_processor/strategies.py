import pandas as pd
import numpy as np
import re
from sklearn.preprocessing import MinMaxScaler, StandardScaler, OneHotEncoder, LabelEncoder

# --- 1. CLEANING STRATEGIES ---

def drop_missing(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Drops rows where specific columns are NaN."""
    subset = kwargs.get('columns', None)
    return df.dropna(subset=subset)

def impute(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Fills NaN values with Mean, Median, Mode, or Constant."""
    col = kwargs.get('column')
    strategy = kwargs.get('strategy', 'constant')
    fill_value = kwargs.get('fill_value', 0)

    if col not in df.columns:
        return df

    if strategy == 'mean' and pd.api.types.is_numeric_dtype(df[col]):
        df[col] = df[col].fillna(df[col].mean())
    elif strategy == 'median' and pd.api.types.is_numeric_dtype(df[col]):
        df[col] = df[col].fillna(df[col].median())
    elif strategy == 'mode':
        df[col] = df[col].fillna(df[col].mode()[0])
    else:
        df[col] = df[col].fillna(fill_value)
    return df

def convert_type(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Forces a column to numeric, datetime, or string."""
    col = kwargs.get('column')
    dtype = kwargs.get('dtype')

    if col not in df.columns:
        return df

    try:
        if dtype == 'numeric':
            df[col] = pd.to_numeric(df[col], errors='coerce')
        elif dtype == 'datetime':
            df[col] = pd.to_datetime(df[col], errors='coerce')
        elif dtype == 'string':
            df[col] = df[col].astype(str)
    except Exception:
        pass
    return df

# --- 2. FEATURE ENGINEERING STRATEGIES ---

def scale_features(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Applies MinMax or Standard scaling."""
    # Support both 'column' and 'columns' from UI
    col = kwargs.get('column') or kwargs.get('columns', '')
    method = kwargs.get('method', 'minmax')

    cols = [c.strip() for c in col.split(',')] if col else []
    if not cols:
        cols = df.select_dtypes(include='number').columns.tolist()

    for c in cols:
        if c in df.columns and pd.api.types.is_numeric_dtype(df[c]):
            data = df[c].values.reshape(-1, 1)
            scaler = StandardScaler() if method in ('z_score', 'standard') else MinMaxScaler()
            df[c] = scaler.fit_transform(data)
    return df

def one_hot_encode(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Converts categorical column to binary columns."""
    col = kwargs.get('column')
    if col in df.columns:
        dummies = pd.get_dummies(df[col], prefix=col, dummy_na=False)
        dummies = dummies.astype(int)
        df = pd.concat([df, dummies], axis=1)
    return df

def drop_columns(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Removes unnecessary columns (IDs, URLs, etc.) before training."""
    cols_to_drop = kwargs.get('columns', [])
    # Only drop if they exist to prevent crashing the pipeline
    existing_cols = [c for c in cols_to_drop if c in df.columns]
    if existing_cols:
        return df.drop(columns=existing_cols)
    return df

def label_encode(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Converts categorical text to integers (e.g., 'Small','Med','Large' -> 0,1,2)."""
    col = kwargs.get('column')
    if col in df.columns:
        le = LabelEncoder()
        # Handle NaN by converting to string first
        df[col] = le.fit_transform(df[col].astype(str))
    return df

# --- 3. NLP STRATEGIES ---

def clean_text(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Removes HTML, special chars, and lowercases text."""
    col = kwargs.get('column')
    if col in df.columns:
        df[col] = df[col].astype(str).str.replace(r'<[^>]+>', '', regex=True)
        df[col] = df[col].str.replace(r'[^a-zA-Z0-9\s]', '', regex=True)
        df[col] = df[col].str.lower().str.strip()
    return df

def sentiment_analysis(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """
    Simple rule-based sentiment. 
    NOTE: Requires 'textblob' in requirements.txt
    """
    from textblob import TextBlob
    col = kwargs.get('column')
    
    if col in df.columns:
        def get_sentiment(text):
            return TextBlob(str(text)).sentiment.polarity

        df[f"{col}_sentiment"] = df[col].apply(get_sentiment)
    return df

def remove_duplicates(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Removes duplicate rows."""
    subset = kwargs.get('subset', None)
    if subset and isinstance(subset, str):
        subset = [s.strip() for s in subset.split(',') if s.strip()]
    return df.drop_duplicates(subset=subset if subset else None)

def rename_columns(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Renames columns using a mapping string like 'old:new, old2:new2'."""
    mapping_str = kwargs.get('mapping', '')
    mapping = {}
    for pair in mapping_str.split(','):
        parts = pair.strip().split(':')
        if len(parts) == 2:
            old, new = parts[0].strip(), parts[1].strip()
            if old in df.columns:
                mapping[old] = new
    if mapping:
        df = df.rename(columns=mapping)
    return df


def filter_rows(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Remove rows where a column equals a specific value or is empty."""
    col = kwargs.get('column')
    exclude = kwargs.get('exclude', '')
    
    if col not in df.columns:
        return df
    
    # Remove empty strings and whitespace-only values
    df = df[df[col].astype(str).str.strip() != '']
    
    # Remove specific values if provided
    if exclude:
        values_to_exclude = [v.strip() for v in exclude.split(',')]
        df = df[~df[col].astype(str).isin(values_to_exclude)]
    
    return df