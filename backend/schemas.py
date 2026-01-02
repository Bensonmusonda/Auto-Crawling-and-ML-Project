from pydantic import BaseModel
from typing import Dict, Optional

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