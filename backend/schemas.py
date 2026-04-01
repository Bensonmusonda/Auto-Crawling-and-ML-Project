from pydantic import BaseModel
from typing import List, Dict, Optional, Any

class PaginationConfig(BaseModel):
    method: str = "selector"          # "selector" | "numeric" | "click" | "scroll"
    selector: Optional[str] = None    # CSS selector for next-page link or click target
    max_pages: int = 5
    
    # New fields for dynamic pagination
    click_and_wait: Optional[bool] = False
    wait_selector: Optional[str] = None
    wait_timeout: Optional[int] = 5000
    scroll_pause: Optional[int] = 2000

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

class PipelineConfig(BaseModel):
    dataset_name: str
    steps: List[PipelineStep]
    source: Optional[str] = "csv"

# New schema for site tier configuration
class SiteTierConfig(BaseModel):
    sites: List[str]