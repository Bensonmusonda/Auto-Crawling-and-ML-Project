from .strategies import (
    drop_missing, impute, convert_type,
    scale_features, one_hot_encode,
    clean_text, sentiment_analysis, drop_columns, label_encode
)

PROCESSOR_REGISTRY = {
    "drop_missing": drop_missing,
    "impute": impute,
    "convert_type": convert_type,
    "drop_columns": drop_columns,
    "label_encode": label_encode,
    "scale": scale_features,
    "one_hot": one_hot_encode,
    "clean_text": clean_text,
    "sentiment": sentiment_analysis
}

def get_strategy(name: str):
    return PROCESSOR_REGISTRY.get(name)