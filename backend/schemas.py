from pydantic import BaseModel
from typing import List, Dict, Optional, Any, Optional

class PaginationConfig(BaseModel):
    selector: str
    max_pages: int = 5

class CrawlRequest(BaseModel):
    job_id: Optional[str] = None
    dataset_name: str
    start_url: str
    crawl_type: str
    item_selectors: Dict[str, str]
    link_selector: Optional[str] = None
    container_selector: Optional[str] = None
    pagination: Optional[PaginationConfig] = None

class PipelineStep(BaseModel):
    step: str
    params: Dict[str, Any]

# Use this name consistently
class PipelineConfig(BaseModel):
    dataset_name: str
    steps: List[PipelineStep]