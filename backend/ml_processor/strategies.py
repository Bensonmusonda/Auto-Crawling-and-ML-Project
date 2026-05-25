import pandas as pd
import numpy as np
import re
from sklearn.preprocessing import MinMaxScaler, StandardScaler, RobustScaler, OneHotEncoder, LabelEncoder

# --- 1. CLEANING STRATEGIES ---

def drop_missing(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Drops rows where specific columns are NaN."""
    subset_val = kwargs.get('subset') or kwargs.get('columns')
    if subset_val and isinstance(subset_val, str):
        subset_val = [s.strip() for s in subset_val.split(',') if s.strip()]
    if not subset_val:
        subset_val = None
    return df.dropna(subset=subset_val)

def impute(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Fills NaN values with Mean, Median, Mode, or Constant."""
    col = kwargs.get('column') or kwargs.get('columns')
    strategy = kwargs.get('strategy', 'constant')
    fill_value = kwargs.get('fill_value', 0)

    if col and isinstance(col, str):
        cols = [c.strip() for c in col.split(',') if c.strip()]
    elif isinstance(col, list):
        cols = col
    else:
        cols = df.columns.tolist()

    for c in cols:
        if c not in df.columns:
            continue
        if strategy == 'mean' and pd.api.types.is_numeric_dtype(df[c]):
            df[c] = df[c].fillna(df[c].mean())
        elif strategy == 'median' and pd.api.types.is_numeric_dtype(df[c]):
            df[c] = df[c].fillna(df[c].median())
        elif strategy == 'mode':
            df[c] = df[c].fillna(df[c].mode()[0] if not df[c].mode().empty else fill_value)
        else:
            df[c] = df[c].fillna(fill_value)
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
    """Applies MinMax, Standard, or Robust scaling."""
    col = kwargs.get('column') or kwargs.get('columns', '')
    method = kwargs.get('method', 'minmax')

    cols = [c.strip() for c in col.split(',')] if col else []
    if not cols:
        cols = df.select_dtypes(include='number').columns.tolist()

    scaler = (StandardScaler() if method in ('z_score', 'standard')
              else RobustScaler() if method == 'robust'
              else MinMaxScaler())

    for c in cols:
        if c in df.columns and pd.api.types.is_numeric_dtype(df[c]):
            df[c] = scaler.fit_transform(df[c].values.reshape(-1, 1))
    return df

def one_hot_encode(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Converts categorical column to binary columns."""
    col = kwargs.get('column') or kwargs.get('columns')
    if col and isinstance(col, str):
        cols = [c.strip() for c in col.split(',') if c.strip()]
    elif isinstance(col, list):
        cols = col
    else:
        cols = []

    for c in cols:
        if c in df.columns:
            dummies = pd.get_dummies(df[c], prefix=c, dummy_na=False)
            dummies = dummies.astype(int)
            df = pd.concat([df.drop(columns=[c]), dummies], axis=1) # Also drop original
    return df

def drop_columns(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Removes unnecessary columns (IDs, URLs, etc.) before training."""
    cols_to_drop = kwargs.get('columns', [])
    if isinstance(cols_to_drop, str):
        cols_to_drop = [c.strip() for c in cols_to_drop.split(',') if c.strip()]
    
    # Only drop if they exist to prevent crashing the pipeline
    existing_cols = [c for c in cols_to_drop if c in df.columns]
    if existing_cols:
        return df.drop(columns=existing_cols)
    return df

def label_encode(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Converts categorical text to integers (e.g., 'Small','Med','Large' -> 0,1,2)."""
    col = kwargs.get('column') or kwargs.get('columns')
    if col and isinstance(col, str):
        cols = [c.strip() for c in col.split(',') if c.strip()]
    elif isinstance(col, list):
        cols = col
    else:
        cols = []

    for c in cols:
        if c in df.columns:
            le = LabelEncoder()
            # Handle NaN by converting to string first
            df[c] = le.fit_transform(df[c].astype(str))
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

def clean_numeric_column(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    col = kwargs.get('column')
    chars_to_strip = kwargs.get('strip_chars', '')
    
    # Accept boolean flags from AI but don't rely on them —
    # the real cleaning is regex-based below
    strip_dollar = kwargs.get('strip_dollar', False)
    remove_commas = kwargs.get('remove_commas', False)

    if col not in df.columns:
        return df

    s = df[col].astype(str).str.replace(r'<[^>]+>', '', regex=True)

    # Strip ANY currency symbol or non-numeric prefix/suffix regardless of
    # what the AI sent — covers $, £, €, ¥, ₹, kr, etc.
    s = s.str.replace(r'[^\d,.\-]', '', regex=True)

    # Handle explicit strip_chars on top if provided
    if chars_to_strip:
        chars = [c.strip() for c in re.split(r'[,|]', chars_to_strip) if c.strip()]
        for c in chars:
            s = s.str.replace(re.escape(c), '', regex=True)

    s = s.str.replace(r'\s+', '', regex=True)

    def parse_number_string(x):
        if x in ('None', 'nan', '', 'nan'): return np.nan
        # Both separators present: comma is always the thousands separator (e.g. 1,234.56)
        if ',' in x and '.' in x:
            return x.replace(',', '')
        if ',' in x and '.' not in x:
            # Thousands separator: comma followed by exactly 3 digits, possibly repeating
            # e.g. 215,000 or 1,234,567 — NOT a decimal comma like 1,5
            if re.match(r'^\d{1,3}(,\d{3})+$', x):
                return x.replace(',', '')
            # European decimal comma (e.g. 1,5 or 3,14)
            return x.replace(',', '.')
        return x

    s = s.apply(parse_number_string)
    df[col] = pd.to_numeric(s, errors='coerce')
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



def regex_extract(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Extracts substrings matching a Regex pattern."""
    col = kwargs.get('column')
    pattern = kwargs.get('pattern')
    new_col_name = kwargs.get('new_col_name')
    
    if col not in df.columns or not pattern:
        return df
        
    try:
        extracted = df[col].astype(str).str.extract(f'({pattern})', expand=False)
        target_col = new_col_name if new_col_name else col
        df[target_col] = extracted
    except Exception as e:
        pass
    
    return df

# --- 4. ADVANCED NLP STRATEGIES ---

def ner_extract(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Extracts Named Entities (like ORG, PERSON) from text using spaCy."""
    col = kwargs.get('column')
    entity_types = kwargs.get('entity_types', 'ORG,PERSON,GPE')
    if not col or col not in df.columns:
        return df
        
    try:
        import spacy
        # Load the small english model
        nlp = spacy.load("en_core_web_sm")
    except Exception:
        return df

    target_types = [t.strip().upper() for t in entity_types.split(',') if t.strip()]

    def get_entities(text):
        if not isinstance(text, str):
            return ""
        try:
            doc = nlp(text)
            found = [ent.text for ent in doc.ents if not target_types or ent.label_ in target_types]
            return ", ".join(list(set(found)))
        except Exception:
            return ""

    df[f"{col}_entities"] = df[col].apply(get_entities)
    return df

def extract_keywords(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Extracts top keywords using scikit-learn TF-IDF."""
    col = kwargs.get('column')
    top_n = kwargs.get('top_n', 3)
    try:
        top_n = int(top_n)
    except ValueError:
        top_n = 3
    
    if not col or col not in df.columns:
        return df
        
    from sklearn.feature_extraction.text import TfidfVectorizer
    vectorizer = TfidfVectorizer(stop_words='english', max_features=1000)
    
    # Fill NA with empty string
    texts = df[col].fillna('').astype(str).tolist()
    
    try:
        matrix = vectorizer.fit_transform(texts)
        feature_names = vectorizer.get_feature_names_out()
        
        results = []
        for row in matrix:
            # Get indices sorted by tf-idf score
            indices = row.toarray()[0].argsort()[-top_n:][::-1]
            keywords = [feature_names[i] for i in indices if row.toarray()[0][i] > 0]
            results.append(", ".join(keywords))
            
        df[f"{col}_keywords"] = results
    except Exception:
        df[f"{col}_keywords"] = ""
        
    return df

def detect_language(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Detects the language of a text column."""
    col = kwargs.get('column')
    if not col or col not in df.columns:
        return df
        
    try:
        from langdetect import detect
        
        def safe_detect(text):
            if not isinstance(text, str) or not text.strip():
                return "unknown"
            try:
                return detect(text)
            except Exception:
                return "unknown"
                
        df[f"{col}_lang"] = df[col].apply(safe_detect)
    except ImportError:
        pass
    
    return df

def text_vectorize(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """Converts a text column into multiple TF-IDF numeric features."""
    col = kwargs.get('column')
    max_features = kwargs.get('max_features', 50)
    try:
        max_features = int(max_features)
    except ValueError:
        max_features = 50
    
    if not col or col not in df.columns:
        return df
        
    from sklearn.feature_extraction.text import TfidfVectorizer
    vectorizer = TfidfVectorizer(stop_words='english', max_features=max_features)
    
    texts = df[col].fillna('').astype(str).tolist()
    
    try:
        matrix = vectorizer.fit_transform(texts)
        feature_names = vectorizer.get_feature_names_out()
        
        # Create a dataframe from the matrix
        tfidf_df = pd.DataFrame(matrix.toarray(), columns=[f"{col}_tfidf_{name}" for name in feature_names], index=df.index)
        
        # Concatenate
        df = pd.concat([df, tfidf_df], axis=1)
    except Exception:
        pass
        
    return df