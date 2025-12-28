import os
import sys
import json
import redis
import scrapy
from celery import Celery
from scrapy.crawler import CrawlerProcess
from scrapy.utils.project import get_project_settings

sys.path.append(os.getcwd())

REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")

from celery_app import app
r = redis.Redis(host=REDIS_HOST, port=6379, db=0)

try:
    from crawler.crawler.spiders.spiders import UniversalSpider
except ImportError:
    from crawler.spiders.spiders import UniversalSpider

@app.task(bind=True)
def run_crawl_task(self, config_input):
    """
    Celery task to run a Scrapy crawl.
    Handles both dict and JSON string inputs for flexibility.
    """
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

    os.environ.setdefault('SCRAPY_SETTINGS_MODULE', 'crawler.crawler.settings')
    settings = get_project_settings()
    
    settings.set('SPIDER_MODULES', ['crawler.crawler.spiders'])
    
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