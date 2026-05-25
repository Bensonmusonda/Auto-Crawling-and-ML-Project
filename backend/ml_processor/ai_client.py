import os
import json
import logging
from openai import OpenAI
from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import List, Dict, Any, Optional, Union
import pandas as pd

logger = logging.getLogger(__name__)

# -------------------------
# Define Pydantic Schemas for Structured Outputs
# -------------------------

class PipelineStep(BaseModel):
    step: str = Field(alias="id", description="The exact name of the operation strategy")
    params: Dict[str, Any] = Field(default_factory=dict, description="The parameters required for this operation")
    reasoning: str = Field(default="", description="A brief explanation of why this specific step is recommended")

    model_config = ConfigDict(populate_by_name=True)

class PipelineSuggestion(BaseModel):
    overall_summary: str = Field(default="", description="A high-level summary of the cleaning strategy")
    suggested_models: List[str] = Field(default_factory=list, description="Recommended model IDs from the registry")
    suggested_steps: List[PipelineStep] = Field(alias="steps", description="The list of operations to apply")

    model_config = ConfigDict(populate_by_name=True)

class RegexSuggestion(BaseModel):
    regex: str = Field(description="The raw regex string pattern (e.g., r'\\d+')")
    reasoning: str = Field(description="A brief explanation of how this regex works")

class MLAdvisorRecommendation(BaseModel):
    model_type: str = Field(alias="recommended_model", description="The ID of the recommended model (e.g. random_forest)")
    reasoning: str = Field(description="Why this model is suited for the data and target")
    suggested_params: Dict[str, Any] = Field(default_factory=dict, description="Recommended hyperparameters for this model")
    param_explanations: Dict[str, str] = Field(default_factory=dict, description="Brief explanations for the suggested parameters")

    model_config = ConfigDict(populate_by_name=True)

class SelectorSuggestionRequest(BaseModel):
    # Default to an empty list so it doesn't crash if JS sends undefined
    html_context: List[Dict[str, Any]] = Field(default_factory=list)
    # Accept Optional values — the validator below strips nulls before the AI sees them,
    # fixing the 422 caused by JS sending null values into Dict[str, str].
    candidates: Dict[str, Optional[str]]
    mode: str = "field"
    last_fields: Dict[str, str] = Field(default_factory=dict)

    @field_validator('candidates', mode='before')
    @classmethod
    def strip_null_candidates(cls, v):
        """Remove null/empty entries so the AI prompt stays clean."""
        if isinstance(v, dict):
            return {k: val for k, val in v.items() if val and val != 'null'}
        return v

class SelectorSuggestionResponse(BaseModel):
    recommended_key: str
    reason: Optional[str] = "No explanation provided by AI."
    # The prompt instructs the AI to always return both. Optional only as a
    # safety net for malformed responses — the UI injects whichever are present.
    ai_css: Optional[str] = None
    ai_xpath: Optional[str] = None

class MLAdvisorInterpretation(BaseModel):
    summary: str = Field(..., alias="performance_summary", description="High-level narrative performance summary")
    strengths: List[str] = Field(default_factory=list, description="Key model strengths")
    weaknesses: List[str] = Field(default_factory=list, description="Areas for improvement")
    feature_insights: str = Field(..., alias="insights", description="Insights on feature importance")
    
    model_config = ConfigDict(populate_by_name=True)

    @field_validator('strengths', 'weaknesses', mode='before')
    @classmethod
    def ensure_list(cls, v):
        if isinstance(v, str):
            return [v]
        return v

# -------------------------
# Operation Parameter Schema (used by suggest_pipeline)
# -------------------------

OP_PARAM_SCHEMA = {
    "drop_missing":           {"subset": "comma-separated column names or omit for all"},
    "impute":                 {"column": "column name(s), comma-separated", "strategy": "mean|median|mode|constant", "fill_value": "value if strategy=constant"},
    "convert_type":           {"column": "column name", "dtype": "numeric|float|int|integer|datetime|string"},
    "scale_features":         {"column": "column name(s), comma-separated", "method": "minmax|z_score|robust"},
    "one_hot_encode":         {"column": "column name(s), comma-separated"},
    "label_encode":           {"column": "column name(s), comma-separated"},
    "drop_columns":           {"columns": "column name(s), comma-separated"},
    "clean_text":             {"column": "column name"},
    "clean_numeric_column":   {"column": "column name", "strip_chars": "optional extra chars to remove e.g. 'kr, per month'"},
    "sentiment_analysis":     {"column": "column name"},
    "remove_duplicates":      {"subset": "comma-separated column names or omit for all"},
    "rename_columns":         {"mapping": "old:new pairs, comma-separated e.g. 'OldName:new_name,OldB:new_b'"},
    "filter_rows":            {"column": "column name", "exclude": "comma-separated values to exclude"},
    "regex_extract":          {"column": "column name", "pattern": "regex pattern string", "new_col_name": "optional new column name"},
    "ner_extract":            {"column": "column name", "entity_types": "comma-separated spaCy entity types e.g. ORG,PERSON,GPE"},
    "extract_keywords":       {"column": "column name", "top_n": "integer number of keywords"},
    "detect_language":        {"column": "column name"},
    "text_vectorize":         {"column": "column name", "max_features": "integer max TF-IDF features"},
}

# -------------------------
# Client Wrapper
# -------------------------

class DeepSeekClient:
    def __init__(self):
        self.api_key = os.getenv("DEEPSEEK_API_KEY")
        if not self.api_key:
            self.client = None
        else:
            self.client = OpenAI(
                api_key=self.api_key,
                base_url="https://api.deepseek.com"
            )

    def is_configured(self) -> bool:
        return self.client is not None

    async def suggest_selector(self, data: SelectorSuggestionRequest) -> SelectorSuggestionResponse:
        """Audits candidate selectors based on mode and recommends stable options."""
        if not self.is_configured():
            raise ValueError("DEEPSEEK_API_KEY is not configured.")

        # Mode-specific routing strategy
        MODE_DIRECTIVES = {
            "container": "Focus on locating the repeating block element wrap. Avoid selecting singular text elements. Look for structural sibling patterns.",
            "pagination": "Look for sequential navigation matrices, 'rel=next' attributes, or explicit 'Next' state controls.",
            "field": "Isolate the precise semantic leaf node containing the descriptive target metric.",
            "list_detail": "Target structural anchor paths (<a> tags) designed to transition into absolute deep-links. Avoid tracking hashes."
        }
        
        active_directive = MODE_DIRECTIVES.get(data.mode, MODE_DIRECTIVES["field"])

        system_prompt = f"""
            You are a Web Scraper Architect. Your goal is to provide the most ROBUST and STABLE selector.

            ACTIVE SCRAPING MODE: {data.mode.upper()}
            MODE DIRECTIVE: {active_directive}

            STRATEGY:
            1. Evaluate the CANDIDATE SELECTORS provided and pick the most stable one as 'recommended_key'.
            2. Analyze the DOM Path Snippet carefully for hidden gems: stable data-attributes, ARIA roles,
               microdata, semantic landmark tags, or any attribute that is clearly human-authored and
               unlikely to change across page renders.
            3. Synthesize a NEW CSS selector in 'ai_css' that is more robust than any of the candidates.
               This MUST always be populated — do not return null.
            4. Synthesize a NEW XPath expression in 'ai_xpath' as an alternative scraping path.
               This MUST always be populated — do not return null.
            5. If no candidate selectors are provided, synthesize both from the DOM context alone.

            SYNTHESIS RULES FOR ai_css and ai_xpath:
            - NEVER copy a candidate verbatim. These must be genuinely new paths derived from the DOM.
            - Prefer: data-* attributes > aria-label/role > semantic tags (article, header, time, price)
                      > stable BEM-style class names > tag + class combos > structural paths.
            - Reject: randomized utility hashes (e.g., .css-1x8vd3, .sc-abc123), :nth-child positional
                      selectors, and any attribute whose value looks dynamically generated (long hex strings,
                      UUIDs, timestamps).
            - For XPath: use contains(@class, 'x') rather than @class='x y z' for resilience.
            - For CSS: prefer direct child (>) over descendant ( ) where the structure is clear.
            - Keep selectors as short as possible while remaining unambiguous within the container context.

            CONTEXT:
            DOM Path Snippet (parent → target): {json.dumps(data.html_context, indent=2)}
            Already Configured Fields (avoid overlapping): {json.dumps(data.last_fields)}

            CANDIDATE SELECTORS (evaluate, do NOT copy into ai_css/ai_xpath):
            {json.dumps(data.candidates, indent=2)}

            RESPONSE FORMAT — return ONLY this JSON, no prose:
            {{
              "recommended_key": "<key from candidates dict>",
              "reason": "<one sentence explaining your choice and synthesis approach>",
              "ai_css": "<your synthesized CSS selector — REQUIRED, never null>",
              "ai_xpath": "<your synthesized XPath expression — REQUIRED, never null>"
            }}
        """

        try:
            response = self.client.chat.completions.create(
                model="deepseek-chat",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": "Please audit these selectors and generate AI optimizations."}
                ]
            )
            result_json = response.choices[0].message.content
            return SelectorSuggestionResponse.model_validate_json(result_json)
        except Exception as e:
            logger.error(f"Selector Audit failed: {e}")
            first_key = list(data.candidates.keys())[0] if data.candidates else "unknown"
            return SelectorSuggestionResponse(
                recommended_key=first_key,
                reason="Fallback: AI audit service unavailable."
            )

    def suggest_pipeline(
        self, 
        df_sample: pd.DataFrame, 
        stats_info: Dict[str, Any], 
        available_ops: List[Dict[str, Any]], 
        available_models: List[str], 
        goal: Optional[str] = None
    ) -> PipelineSuggestion:
        """
        Takes a dataframe sample + stats and asks DeepSeek to suggest a cleaning pipeline.
        """
        if not self.is_configured():
            raise ValueError("DEEPSEEK_API_KEY is not configured in the environment.")

        sample_json = df_sample.to_json(orient='records')
        
        goal_text = f"The user's goal is: {goal}" if goal else "The user has not specified a specific goal, so prioritize a flexible, general-purpose cleaning pipeline."

        # Build annotated ops with param schemas so the AI can't invent params
        annotated_ops = []
        for op in available_ops:
            op_id = op["id"]
            annotated_ops.append({
                "id": op_id,
                "description": op.get("description", ""),
                "params": OP_PARAM_SCHEMA.get(op_id, {})
            })

        system_prompt = f"""
            You are an expert Data Scientist. Your job is to analyze a dataset and recommend a series of cleaning/processing operations.
            
            USER CONTEXT:
            {goal_text}

            AVAILABLE MODELS IN REGISTRY:
            {json.dumps(available_models)}

            AVAILABLE PROCESSING OPERATIONS (use ONLY these, with ONLY the listed params):
            {json.dumps(annotated_ops, indent=2)}

            DATASET STATISTICS:
            {json.dumps(stats_info, indent=2)}

            STRATEGY REQUIREMENTS:
            1. Analyze the statistics and the sample data.
            2. Recommend 3-7 processing steps that prepare the data for machine learning.
            3. If the user's goal is vague, prioritize general-purpose steps (imputing, converting types, deduplication).
            4. If the user's goal is specific, tailor the pipeline and recommend the best models from the 'AVAILABLE MODELS' list.
            5. Provide an 'overall_summary' explaining your high-level strategy.
            6. Return 'suggested_models' representing IDs from the 'AVAILABLE MODELS' list.
            7. For parameters that take column names (like 'column', 'columns', or 'subset'), ALWAYS use a
               comma-separated string (e.g., "Age,Fare") rather than a JSON array.
            8. Use 'clean_numeric_column' for ANY column containing currency values, prices, or numeric strings
               with symbols (e.g. $215,000 £1,200 €500). Do NOT use 'regex_extract' for currency cleaning.
               The 'strip_chars' param accepts a comma-separated string of extra characters to remove
               beyond currency symbols (e.g., strip_chars="per month, sqft").
            9. Use 'regex_extract' ONLY for structured substring extraction from text
               (e.g., extracting a title prefix like "Mr." from a name, or a code from "ITEM-1234").
            10. ONLY use params that are listed in each operation's 'params' schema above.
                Do NOT invent param names. If a param isn't in the schema, don't include it.

            EXAMPLE OUTPUT FORMAT:
            {{
                "overall_summary": "I am converting categorical strings to numbers and imputing missing ages to prepare for classification.",
                "suggested_models": ["logistic_regression", "random_forest"],
                "suggested_steps": [
                    {{ "step": "clean_numeric_column", "params": {{ "column": "price", "strip_chars": "per month" }}, "reasoning": "Remove currency symbols and convert to float." }},
                    {{ "step": "convert_type", "params": {{ "column": "bedrooms", "dtype": "integer" }}, "reasoning": "Cast bedroom count to integer." }},
                    {{ "step": "impute", "params": {{ "column": "Age", "strategy": "median" }}, "reasoning": "Handling missing age values." }}
                ]
            }}

            RESPONSE FORMAT:
            You MUST reply with a JSON object that strictly adheres to the PipelineSuggestion schema.
            """
        
        user_prompt = f"Here is a random sample of the dataset:\n{sample_json}\n\nPlease recommend the optimal cleaning pipeline."
        
        response = self.client.chat.completions.create(
            model="deepseek-chat",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        )
        
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

    def analyze_ml_task(
        self,
        mode: str,
        stats_info: Dict[str, Any],
        target_column: str,
        available_models_info: Optional[Dict[str, Any]] = None,
        current_model_type: Optional[str] = None,
        metrics: Optional[Dict[str, Any]] = None,
        feature_importance: Optional[Dict[str, Any]] = None,
        goal: Optional[str] = None
    ) -> Any:
        """
        Provides ML advice: either recommending a model/params or interpreting results.
        """
        if not self.is_configured():
            raise ValueError("DEEPSEEK_API_KEY is not configured in the environment.")

        goal_text = f"The user's goal is: {goal}" if goal else ""

        if mode in ["recommend", "tune"]:
            # Feedback context: Tell AI about the previous run results if tuning
            feedback_context = ""
            if mode == "tune" and metrics:
                 feedback_context = f"""
                 PREVIOUS PERFORMANCE (FEEDBACK LOOP):
                 The user just ran this model. Here were the results:
                 METRICS: {json.dumps(metrics, indent=2)}
                 FEATURE IMPORTANCE: {json.dumps(feature_importance, indent=2)}
                 
                 Your goal is to IMPROVE these results by adjusting the hyperparameters.
                 """

            system_prompt = f"""
                You are an expert Data Scientist. Analyze the dataset stats and recommend the best ML approach.
                
                USER CONTEXT:
                {goal_text}
                TARGET COLUMN: {target_column}

                AVAILABLE MODELS & THEIR PARAMS:
                {json.dumps(available_models_info, indent=2)}

                DATASET STATISTICS:
                {json.dumps(stats_info, indent=2)}

                {feedback_context}

                REQUIREMENTS:
                1. If mode is 'recommend', pick the single best model_type from the available list.
                2. If mode is 'tune', use the 'current_model_type' provided.
                3. If mode is 'tune' and PREVIOUS PERFORMANCE is provided, conduct an iterative optimization. Explain how you are changing the params to fix previous weaknesses.
                4. Suggest optimal hyperparameters within the 'min/max/options' constraints of each model's manifest.
                5. Provide a clear reasoning for why the model and params were chosen.
                
                RESPONSE FORMAT:
                You MUST reply with a JSON object strictly adhering to the MLAdvisorRecommendation schema.
            """
            user_prompt = f"Please provide {mode} advice for the target column '{target_column}'."
            schema = MLAdvisorRecommendation
        else:
            system_prompt = f"""
                You are an expert Data Scientist. Interpret the results of a trained ML model.
                
                MODEL: {current_model_type}
                TARGET: {target_column}
                METRICS: {json.dumps(metrics, indent=2)}
                FEATURE IMPORTANCE: {json.dumps(feature_importance, indent=2)}

                REQUIREMENTS:
                1. Summarize the model's performance in a clear, narrative way (use key 'performance_summary').
                2. Identify specific strengths and weaknesses based on the metrics (precision vs recall, high MSE, etc).
                3. Explain what the feature importance suggests about the data (use key 'insights').
                4. Suggest actionable next steps to improve the score.
                
                CRITICAL: You MUST use the exact property names: 'performance_summary', 'strengths', 'weaknesses', 'insights'.
                The 'strengths' and 'weaknesses' properties MUST be JSON arrays of strings (e.g., ["Item 1", "Item 2"]).
                
                EXAMPLE OUTPUT:
                {{
                    "performance_summary": "The model performs well overall...",
                    "strengths": ["High accuracy on Class A", "Robust to outliers"],
                    "weaknesses": ["Low recall on Class B"],
                    "insights": "Feature X is the primary driver..."
                }}
                
                RESPONSE FORMAT:
                You MUST reply with a JSON object strictly adhering to the schema.
            """
            user_prompt = "Please interpret these training results."
            schema = MLAdvisorInterpretation

        response = self.client.chat.completions.create(
            model="deepseek-chat",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        )
        
        result_json = response.choices[0].message.content
        return schema.model_validate_json(result_json)