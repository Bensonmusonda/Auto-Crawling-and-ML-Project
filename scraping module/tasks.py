import os
import sys
import json
import redis
from celery import Celery
from celery_app import app

sys.path.append(os.getcwd())

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

r = redis.Redis(host=REDIS_HOST, port=6379, db=0)
@app.task(bind=True)
def run_crawl_task(self, config_input):
    """
    Celery task to run a Scrapy crawl.
    Uses explicit Scrapy Settings to ensure the PostgresPipeline is active.
    """
    from scrapy.crawler import CrawlerProcess
    from scrapy.settings import Settings
    
    from crawler.crawler.spiders.spiders import UniversalSpider

    # Parse input config
    if isinstance(config_input, str):
        config_dict = json.loads(config_input)
    else:
        config_dict = config_input

    job_id = self.request.id
    config_dict["job_id"] = job_id
    
    print(f"--- Starting Task: {job_id} ---")
    
    r.publish('crawl_events', json.dumps({
        "job_id": job_id, 
        "event": "started",
        "url": config_dict.get("start_url")
    }))

    settings = Settings()
    
    settings.setmodule('crawler.crawler.settings', priority='project')
    
    settings.set('ITEM_PIPELINES', {
        'crawler.crawler.pipelines.PostgresPipeline': 300,
    }, priority='cmdline')

    settings.set('ROBOTSTXT_OBEY', True)
    settings.set('DOWNLOAD_DELAY', 1) 
    settings.set('AUTOTHROTTLE_ENABLED', True) 
    settings.set('CONCURRENT_REQUESTS', 4)
    settings.set('SCHEDULER_DISK_QUEUE', 'scrapy.squeues.PickleFifoDiskQueue')
    
    settings.set('SPIDER_MODULES', ['crawler.crawler.spiders'], priority='cmdline')
    settings.set('ROBOTSTXT_OBEY', True)
    settings.set('LOG_LEVEL', 'INFO', priority='cmdline')

    settings.set('TWISTED_REACTOR', 'twisted.internet.asyncioreactor.AsyncioSelectorReactor', priority='cmdline')

    try:
        process = CrawlerProcess(settings)
        process.crawl(UniversalSpider, config=json.dumps(config_dict))
        process.start()
        
        r.publish('crawl_events', json.dumps({
            "job_id": job_id, 
            "event": "done",
            "status": "success"
        }))
        return f"Job {job_id} completed successfully"

    except Exception as e:
        r.publish('crawl_events', json.dumps({
            "job_id": job_id, 
            "event": "error",
            "message": str(e)
        }))
        print(f"Task Failed: {str(e)}")
        raise e



@app.task(bind=True, name='tasks.validate_selector')
def validate_selector(self, url, selector):
    """
    Runs the ValidatorSpider to check a selector.
    """
    from scrapy.crawler import CrawlerProcess
    from scrapy.settings import Settings
    from crawler.crawler.spiders.validator_spider import ValidatorSpider
    import json
    import multiprocessing

    # Simple queue-based result capture since Scrapy is async and runs in reactor
    # We can't return directly from the spider easily without a little plumbing
    # or using a dedicated item pipeline that writes to a known location/db.
    # For a lightweight check, we can use a fresh process or just rely on the logging/result?
    
    # Better approach for single-task execution in Celery:
    # Use scrapy.crawler.CrawlerRunner if we were in async, but here we are in a worker process.
    # CrawlerProcess captures the signal. 
    
    settings = Settings()
    settings.set('LOG_LEVEL', 'ERROR')
    # Use a specific pipeline or just capture items?
    # Let's just use a trick: capture items in a list attached to the spider instance?
    # Or write to a temp file.
    
    results = []
    
    class ResultCollectorPipeline:
        def process_item(self, item, spider):
            results.append(item)
            return item

    settings.set('ITEM_PIPELINES', {
        # We need to register this class somehow, or just defined it in a module?
        # Simpler: just use a list that the spider populates? 
        # But pipeline is safer.
    })
    
    # Actually, the spider yields the result. We can use a custom CrawlerProcess/Signal?
    # For simplicity in this env, let's use a thread-safe approach or just a shared dict if using threads.
    # But CrawlerProcess blocks.
    
    # Let's try to just run it and grab the output from the spider instance if possible?
    # No, spider instance is created inside the process.
    
    # Let's use the `scrapy.crawler.CrawlerRunner` approach inside a helper?
    # OR: just return the spider's stats?
    
    # Let's stick to the Plan B: "Dry Run" relies on specific spider logic.
    # We will pass a mutable list to the spider start args? No.
    
    # Let's rewrite ValidatorSpider to write to a temp file for this task?
    # yes, safest.
    
    import tempfile
    fd, path = tempfile.mkstemp()
    
    settings.set('FEEDS', {
        path: {'format': 'json'}
    })
    
    try:
        process = CrawlerProcess(settings)
        process.crawl(ValidatorSpider, url=url, selectors=json.dumps({"target": selector}))
        process.start()
        
        # Read the file
        with os.fdopen(fd, 'r') as tmp:
            content = tmp.read()
            data = json.loads(content) if content.strip() else []
            
        os.remove(path)
        
        # data should contain the items yielded.
        # We yielded {"type": "validation_result", "results": ...}
        
        for item in data:
            if item.get("type") == "validation_result":
                return item["results"]["target"]
                
        return {"valid": False, "error": "No result returned from spider"}

    except Exception as e:
        return {"valid": False, "error": str(e)}


@app.task(bind=True, name='tasks.validate_selector_playwright')
def validate_selector_playwright_task(self, url: str, selector: str):
    """
    Celery task wrapper for Playwright validation.
    Uses real browser to bypass bot detection (Amazon, etc.)
    """
    from playwright_validator import validate_selector_with_playwright
    
    try:
        result = validate_selector_with_playwright(url, selector)
        return result
    except Exception as e:
        return {
            "count": 0,
            "valid": False,
            "error": str(e),
            "selector_found": False,
            "blocked": False,
        }
