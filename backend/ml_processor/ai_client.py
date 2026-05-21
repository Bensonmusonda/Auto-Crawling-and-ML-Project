import os
import json
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import pandas as pd

# -------------------------
# Define Pydantic Schemas for Structured Outputs
# -------------------------

class PipelineStep(BaseModel):
    step: str = Field(description="The exact name of the operation strategy (e.g., 'clean_numeric_column', 'impute')")
    params: Dict[str, Any] = Field(description="The parameters required for this operation")
    reasoning: str = Field(description="A brief explanation of why this step is recommended")

class PipelineSuggestion(BaseModel):
    suggested_steps: List[PipelineStep] = Field(description="The list of operations to apply to the dataset in order")

class RegexSuggestion(BaseModel):
    regex: str = Field(description="The raw regex string pattern (e.g., r'\\d+')")
    reasoning: str = Field(description="A brief explanation of how this regex works")

# -------------------------
# Client Wrapper
# -------------------------

class DeepSeekClient:
    def __init__(self):
        self.api_key = os.getenv("DEEPSEEK_API_KEY")
        if not self.api_key:
            # We don't want to crash on boot if the key is missing, 
            # just allow the endpoints to throw a clean error when called.
            self.client = None
        else:
            # Configure OpenAI SDK to talk to DeepSeek
            self.client = OpenAI(
                api_key=self.api_key,
                base_url="https://api.deepseek.com"
            )

    def is_configured(self) -> bool:
        return self.client is not None

    def suggest_pipeline(self, df_sample: pd.DataFrame, columns_info: Dict[str, str]) -> PipelineSuggestion:
        """
        Takes a dataframe sample and asks DeepSeek to suggest a cleaning pipeline.
        """
        if not self.is_configured():
            raise ValueError("DEEPSEEK_API_KEY is not configured in the environment.")

        # Convert sample to readable string
        sample_json = df_sample.to_json(orient='records')

        system_prompt = f"""
            You are an expert Data Scientist. Your job is to analyze a dirty dataset and recommend a series of cleaning operations.

            You MUST reply with a JSON object that strictly adheres to this structure:
            {{
            "suggested_steps": [
                {{
                "step": "The exact name of the operation strategy",
                "params": {{ "param_name": "value" }},
                "reasoning": "A brief explanation of why this step is recommended"
                }}
            ]
            }}

            AVAILABLE OPERATIONS:
            - drop_missing(subset="col1,col2")
            - impute(column="col1", strategy="mean|median|mode|constant", fill_value=0)
            - convert_type(column="col1", dtype="numeric|datetime|string")
            - scale_features(column="col1", method="minmax|standard|robust")
            - one_hot_encode(column="col1")
            - label_encode(column="col1")
            - clean_text(column="col1") - removes HTML, special chars, lowercases
            - clean_numeric_column(column="col1", strip_chars="$,") - specifically for money/numbers
            - sentiment_analysis(column="col1")
            - remove_duplicates(subset="col1")
            - rename_columns(mapping="old:new")
            - filter_rows(column="col1", exclude="val1,val2")
            - regex_extract(column="col1", pattern="regex", new_col_name="new_col")

            DATASET SCHEMA:
            {json.dumps(columns_info, indent=2)}
            """
        
        user_prompt = f"Here is a random sample of the dataset:\n{sample_json}\n\nPlease recommend the optimal cleaning pipeline to prepare this dataset for machine learning."
        
        response = self.client.chat.completions.create(
            model="deepseek-chat",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        )
        
        # Parse the JSON string back into our Pydantic model
        result_json = response.choices[0].message.content
        return PipelineSuggestion.model_validate_json(result_json)

    def generate_regex(self, col_name: str, sample_data: List[Any], intent: str) -> RegexSuggestion:
        """
        Generates a regex pattern based on user intent and sample data.
        """
        if not self.is_configured():
            raise ValueError("DEEPSEEK_API_KEY is not configured in the environment.")

        system_prompt = """
You are an expert Regex builder. Your job is to generate a valid Python Pandas compatible regex string based on the user's intent.
The regex MUST NOT include the Python `r` prefix in the string, just the raw pattern. 
For example, if the regex is r'\\d+', just return '\\d+'.
You MUST reply with a JSON object matching the requested schema.
"""

        user_prompt = f"""
COLUMN NAME: {col_name}
SAMPLE DATA (3 rows):
{json.dumps(sample_data, indent=2)}

USER INTENT: {intent}
"""

        response = self.client.chat.completions.create(
            model="deepseek-chat",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        )
        
        result_json = response.choices[0].message.content
        return RegexSuggestion.model_validate_json(result_json)
