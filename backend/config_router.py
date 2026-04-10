# config_router.py - Updated version with Playwright support

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/config", tags=["config"])


class ValidationRequest(BaseModel):
    url: str
    selector: str
    force_playwright: bool = False  # Optional: force use of Playwright


@router.post("/validate")
async def validate_selector(request: ValidationRequest):
    """
    Runs a dry-run validation of the selector against the target URL.
    
    Automatically uses Playwright for sites known to require JavaScript rendering
    (Amazon, dynamic SPAs, etc.) or when force_playwright=True.
    """
    try:
        from tasks import celery_app
        
        # Determine which validator to use
        use_playwright = request.force_playwright or _should_use_playwright(request.url)
        
        if use_playwright:
            # Use Playwright for JavaScript-heavy sites
            task = celery_app.send_task(
                'tasks.validate_selector_playwright',
                args=[request.url, request.selector],
                queue='celery'
            )
        else:
            # Use regular Scrapy for static sites
            task = celery_app.send_task(
                'tasks.validate_selector',
                args=[request.url, request.selector],
                queue='celery'
            )
        
        # Wait for result with longer timeout for Playwright
        timeout = 30 if use_playwright else 10
        result = task.get(timeout=timeout)
        
        # Add metadata about which method was used
        result['_validation_method'] = 'playwright' if use_playwright else 'scrapy'
        
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _should_use_playwright(url: str) -> bool:
    """
    Determine if a URL should use Playwright based on domain.
    
    Add domains here that are known to:
    - Require JavaScript rendering
    - Use heavy bot detection
    - Serve different content to bots
    """
    url_lower = url.lower()
    
    # Sites that definitely need Playwright
    playwright_domains = [
        'amazon.com',
        'amazon.co.uk',
        'amazon.de',
        'walmart.com',
        'target.com',
        'ebay.com',
        'linkedin.com',
        'facebook.com',
        'twitter.com',
        'instagram.com',
        'reddit.com',  # Modern Reddit is React-based
        'zillow.com',
        'indeed.com',
        'glassdoor.com',
    ]
    
    # Check if any domain matches
    for domain in playwright_domains:
        if domain in url_lower:
            return True
    
    # Check for common SPA frameworks in URL
    spa_indicators = [
        '/app/',
        '/dashboard/',
        '/#/',  # Hash-based routing
    ]
    
    for indicator in spa_indicators:
        if indicator in url_lower:
            return True
    
    return False


@router.get("/validation-methods")
async def get_validation_methods():
    """
    Returns information about available validation methods.
    """
    return {
        "methods": [
            {
                "name": "scrapy",
                "description": "Fast validation for static HTML sites",
                "pros": ["Fast", "Low resource usage"],
                "cons": ["No JavaScript support", "May trigger bot detection"],
                "best_for": ["Static sites", "News sites", "Blogs", "Documentation"]
            },
            {
                "name": "playwright",
                "description": "Real browser validation for dynamic sites",
                "pros": ["JavaScript execution", "Bypasses most bot detection", "Accurate rendering"],
                "cons": ["Slower", "Higher resource usage"],
                "best_for": ["E-commerce", "SPAs", "Sites with bot detection"]
            }
        ],
        "auto_playwright_domains": [
            "amazon.com", "walmart.com", "target.com", "ebay.com",
            "linkedin.com", "facebook.com", "twitter.com"
        ]
    }


@router.post("/validate-batch")
async def validate_batch(requests: list[ValidationRequest]):
    """
    Validate multiple selectors in batch.
    Useful when testing alternative selectors.
    """
    from tasks import celery_app
    
    results = []
    
    for req in requests:
        try:
            use_playwright = req.force_playwright or _should_use_playwright(req.url)
            
            task = celery_app.send_task(
                'tasks.validate_selector_playwright' if use_playwright else 'tasks.validate_selector',
                args=[req.url, req.selector],
                queue='celery'
            )
            
            # Don't wait here - collect task IDs
            results.append({
                "selector": req.selector,
                "task_id": task.id,
                "method": "playwright" if use_playwright else "scrapy"
            })
        except Exception as e:
            results.append({
                "selector": req.selector,
                "error": str(e)
            })
    
    return {
        "submitted": len(results),
        "tasks": results,
        "note": "Use /validate-batch-results/{task_id} to get results"
    }


@router.get("/validate-batch-results/{task_id}")
async def get_batch_result(task_id: str):
    """
    Get results for a batch validation task.
    """
    from tasks import celery_app
    from celery.result import AsyncResult
    
    task = AsyncResult(task_id, app=celery_app)
    
    if task.ready():
        return {
            "task_id": task_id,
            "status": "completed",
            "result": task.result
        }
    else:
        return {
            "task_id": task_id,
            "status": "pending"
        }