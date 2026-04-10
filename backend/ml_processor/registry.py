from .strategies import (
    drop_missing, impute, convert_type,
    scale_features, one_hot_encode,
    clean_text, sentiment_analysis, drop_columns, label_encode,
    remove_duplicates,
    rename_columns, filter_rows, clean_numeric_column,
    ner_extract, extract_keywords, detect_language, text_vectorize
)

PROCESSOR_REGISTRY = {
    # Core names
    "drop_missing": drop_missing,
    "drop_nulls": drop_missing,       # alias used by UI
    "impute": impute,
    "fill_missing": impute,           # alias used by UI
    "convert_type": convert_type,
    "drop_columns": drop_columns,
    "label_encode": label_encode,
    "encode_categorical": label_encode,  # alias used by UI
    "scale": scale_features,
    "normalize": scale_features,      # alias used by UI
    "one_hot": one_hot_encode,
    "clean_text": clean_text,
    "sentiment": sentiment_analysis,
    "remove_duplicates": remove_duplicates,  # new
    "rename_columns": rename_columns,        # new
    "filter_rows": filter_rows,              # new
    "clean_numeric_column": clean_numeric_column,
    "ner_extract": ner_extract,
    "extract_keywords": extract_keywords,
    "detect_language": detect_language,
    "text_vectorize": text_vectorize,
}

def get_strategy(name: str):
    return PROCESSOR_REGISTRY.get(name)