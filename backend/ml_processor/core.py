import pandas as pd
from .registry import get_strategy
import logging

logger = logging.getLogger(__name__)

class UniversalEngine:
    def __init__(self, dataset):
        if isinstance(dataset, pd.DataFrame):
            self.df = dataset.copy()
        else:
            self.df = pd.DataFrame(dataset)
        self.logs = []

    def run_pipeline(self, pipeline_config: list):
        """
        pipeline_config format:
        [
            {"step": "impute", "params": {"column": "price", "strategy": "mean"}},
            {"step": "clean_text", "params": {"column": "description"}}
        ]
        """
        for i, op in enumerate(pipeline_config):
            step_name = op.get("step")
            params = op.get("params", {})

            func = get_strategy(step_name)
            
            if not func:
                msg = f"Step {i+1}: '{step_name}' not found in registry."
                self.logs.append(msg)
                logger.warning(msg)
                continue

            try:
                # Apply the strategy
                self.df = func(self.df, **params)
                self.logs.append(f"Step {i+1}: '{step_name}' applied successfully.")
            except Exception as e:
                msg = f"Step {i+1}: '{step_name}' failed. Error: {str(e)}"
                self.logs.append(msg)
                logger.error(msg)
        
        return self.df, self.logs