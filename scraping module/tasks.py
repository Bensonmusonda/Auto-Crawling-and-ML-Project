import os
import sys
import json
import redis
from celery_app import app

sys.path.append(os.getcwd())

REDIS_HOST = os.getenv("REDIS_HOST", "redis")

r = redis.Redis(host=REDIS_HOST, port=6379, db=0)


@app.task(bind=True)
def run_crawl_task(self, config_input):
    from scrapy.crawler import CrawlerProcess
    from scrapy.settings import Settings
    from crawler.crawler.spiders.spiders import UniversalSpider

    config_dict = (
        json.loads(config_input)
        if isinstance(config_input, str)
        else config_input
    )

    job_id = self.request.id
    config_dict["job_id"] = job_id

    print(f"[TASK START] {job_id}")

    r.publish("crawl_events", json.dumps({
        "job_id": job_id,
        "event": "started",
        "url": config_dict.get("start_url")
    }))

    settings = Settings()

    settings.set("BOT_NAME", "crawler")
    settings.set("SPIDER_MODULES", ["crawler.crawler.spiders"])
    settings.set("NEWSPIDER_MODULE", "crawler.crawler.spiders")
    settings.set("DOWNLOAD_TIMEOUT", 70)
    settings.set("DEFAULT_REQUEST_HEADERS", {})
    settings.set("ITEM_PIPELINES", {
        "crawler.crawler.pipelines.PostgresPipeline": 300,
    })
    settings.set("ROBOTSTXT_OBEY", False)
    settings.set("CONCURRENT_REQUESTS", 1)
    settings.set("DOWNLOAD_DELAY", 3)
    settings.set(
        "USER_AGENT",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    )
    settings.set("LOG_LEVEL", "DEBUG")
    settings.set(
        "TWISTED_REACTOR",
        "twisted.internet.asyncioreactor.AsyncioSelectorReactor"
    )
    settings.set("FEED_EXPORT_ENCODING", "utf-8")
    settings.set("HTTPERROR_ALLOWED_CODES", [400, 403, 429, 503])

    try:
        process = CrawlerProcess(settings)
        crawler = process.create_crawler(UniversalSpider)
        process.crawl(crawler, config=json.dumps(config_dict))
        process.start()

        stats = crawler.stats.get_stats() if crawler.stats else {}

        print("[CRAWL COMPLETE]")
        print(f"Items scraped: {stats.get('item_scraped_count', 0)}")
        print(f"Pages crawled: {stats.get('response_received_count', 0)}")

        r.publish("crawl_events", json.dumps({
            "job_id": job_id,
            "event": "done",
            "status": "success"
        }))

        return f"Job {job_id} completed successfully"

    except Exception as e:
        r.publish("crawl_events", json.dumps({
            "job_id": job_id,
            "event": "error",
            "message": str(e)
        }))
        print(f"[TASK ERROR] {e}")
        raise


@app.task(bind=True, name="tasks.validate_selector")
def validate_selector(self, url, selector):
    from scrapy.crawler import CrawlerProcess
    from scrapy.settings import Settings
    from crawler.crawler.spiders.validator_spider import ValidatorSpider
    import tempfile

    settings = Settings()
    settings.set("LOG_LEVEL", "ERROR")

    fd, path = tempfile.mkstemp()

    settings.set("FEEDS", {
        path: {"format": "json"}
    })

    try:
        process = CrawlerProcess(settings)
        process.crawl(
            ValidatorSpider,
            url=url,
            selectors=json.dumps({"target": selector})
        )
        process.start()

        with os.fdopen(fd, "r") as tmp:
            content = tmp.read()
            data = json.loads(content) if content.strip() else []

        os.remove(path)

        for item in data:
            if item.get("type") == "validation_result":
                return item["results"]["target"]

        return {"valid": False, "error": "No result returned from spider"}

    except Exception as e:
        return {"valid": False, "error": str(e)}


@app.task(bind=True, name="tasks.validate_selector_playwright")
def validate_selector_playwright_task(self, url: str, selector: str):
    from playwright_validator import validate_selector_with_playwright

    try:
        return validate_selector_with_playwright(url, selector)
    except Exception as e:
        return {
            "count": 0,
            "valid": False,
            "error": str(e),
            "selector_found": False,
            "blocked": False,
        }