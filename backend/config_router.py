from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import subprocess
import json
import os

router = APIRouter(prefix="/api/config", tags=["config"])

class ValidationRequest(BaseModel):
    url: str
    selector: str

@router.post("/validate")
async def validate_selector(request: ValidationRequest):
    """
    Runs a dry-run validation of the selector against the target URL
    using the dedicated ValidatorSpider.
    """
    try:
        # We need to run the spider in a way that we can capture the output.
        # Since this is a "dry run", we can use subprocess to run 'scrapy crawl' 
        # inside the scraping container context, OR assuming this backend 
        # has access to the scraping code (it does via volume mount in dev).
        
        # Construct the command
        # We pass selectors as a JSON string: {"target": "selector"}
        selectors_json = json.dumps({"target": request.selector})
        
        # NOTE: In production, you'd use a queue. For "real-time" dev tool, 
        # subprocess is acceptable if concurrency is low.
        
        # We need to locate where the scrapy project is.
        # Based on file list, it's in `../scraping module` relative to backend?
        # Or `/app/` inside docker. Let's assume standard docker path structure.
        # The backend dockerfile copies `backend/` to `/app`. 
        # Wait, the worker has the scraping code. The backend might NOT have the scrapy modules installed?
        # Let's check requirements.txt of backend.
        
        # If backend cannot run scrapy, we must delegate to Celery.
        # Let's assume we use Celery for everything to be safe.
        
        from main import celery_app
        
        task = celery_app.send_task(
            'tasks.validate_selector',
            args=[request.url, request.selector],
            queue='celery' # or default queue
        )
        
        # Wait for result (sync wait for "real-time" feel, verifying timeout)
        # This blocks the async worker, so in high scale we'd return a job ID.
        # For this dev tool, we want immediate response.
        
        result = task.get(timeout=10) # 10s timeout
        
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
