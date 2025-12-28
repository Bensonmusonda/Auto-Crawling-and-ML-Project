import json
import scrapy
import redis
from scrapy.http import Response
from typing import Dict, Any, Optional

class UniversalSpider(scrapy.Spider):
    name = "universal_spider"

    def __init__(self, config: str, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Robust JSON loading
        if config.endswith(".json"):
            with open(config, "r") as f:
                self.config = json.load(f)
        else:
            self.config = json.loads(config)

        self.job_id = self.config["job_id"]
        self.start_urls = [self.config["start_url"]]
        self.crawl_type = self.config["crawl_type"]
        self.pagination = self.config.get("pagination")
        self.link_selector = self.config.get("link_selector")
        self.item_selectors = self.config["item_selectors"]
        self.container_selector = self.config.get("container_selector")

        self.r = redis.Redis(host='redis', port=6379, db=0)
        self.pages_crawled = 0
        self.items_scraped = 0

    def parse(self, response: Response):
        self.pages_crawled += 1
        self.emit_progress()

        if self.crawl_type == "flat":
            if self.container_selector:
                for container in response.css(self.container_selector):
                    yield from self.parse_items(container)
            else:
                yield from self.parse_items(response)

        elif self.crawl_type == "list-detail":
            yield from self.parse_list(response)

        yield from self.handle_pagination(response)

    def parse_list(self, response: Response):
        if not self.link_selector:
            return
        
        links = response.css(self.link_selector)
        for link in links:
            url = link.attrib.get("href") or link.css("::attr(href)").get()
            if url:
                yield response.follow(url, callback=self.parse_detail)

    def parse_detail(self, response: Response):
        self.pages_crawled += 1
        item = self.extract_item(response)
        if item:
            self.items_scraped += 1
            yield item
        self.emit_progress()

    def extract_item(self, selector) -> Dict[str, Any]:
        item = {}
        for field, sel in self.item_selectors.items():
            results = selector.css(sel).getall()
            if results:
                item[field] = " ".join([r.strip() for r in results if r.strip()])
            else:
                item[field] = None

        item["job_id"] = self.job_id
        item["source_url"] = getattr(selector, 'url', 'N/A')
        return item

    def emit_progress(self):
        try:
            event_data = {
                "job_id": self.job_id,
                "event": "progress",
                "data": {
                    "pages_crawled": self.pages_crawled,
                    "items_scraped": self.items_scraped
                }
            }
            self.r.publish('crawl_events', json.dumps(event_data))
        except Exception as e:
            self.logger.error(f"Redis publish failed: {e}")