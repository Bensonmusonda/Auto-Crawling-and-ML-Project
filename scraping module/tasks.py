import os
import sys
import json
import redis
from celery import Celery
from config import Config
from celery_app import app

sys.path.append(os.getcwd())

r = redis.Redis(host=Config.REDIS_HOST, port=6379, db=0)

@app.task(bind=True)
def run_crawl_task(self, config_input):
    """
    Celery task to run a Scrapy crawl.
    Uses explicit Scrapy Settings to ensure the PostgresPipeline is active.
    """
    from scrapy.crawler import CrawlerProcess
    from scrapy.settings import Settings
    
    try:
        from crawler.crawler.spiders.spiders import UniversalSpider
    except ImportError:
        from crawler.spiders.spiders import UniversalSpider

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
    
    settings.set('SPIDER_MODULES', ['crawler.crawler.spiders'], priority='cmdline')
    settings.set('ROBOTSTXT_OBEY', True)
    settings.set('LOG_LEVEL', 'INFO', priority='cmdline')

    try:
        process = CrawlerProcess(settings)
        process.crawl(UniversalSpider, config=json.dumps(config_dict))
        process.start() # Blocks until spider finishes
        
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