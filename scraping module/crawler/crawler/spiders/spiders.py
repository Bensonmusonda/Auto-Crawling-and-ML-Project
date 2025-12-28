import json
import scrapy
import redis
from scrapy.http import Response
from typing import Dict, Any, Optional


class UniversalSpider(scrapy.Spider):
    name = "universal_spider"

    def __init__(self, config: str, *args, **kwargs):
        """
        config: JSON string or path to JSON file
        """
        super().__init__(*args, **kwargs)

        if config.endswith(".json"):
            with open(config, "r") as f:
                self.config: Dict[str, Any] = json.load(f)
        else:
            self.config: Dict[str, Any] = json.loads(config)

        self.job_id: str = self.config["job_id"]
        self.start_urls = [self.config["start_url"]]

        self.crawl_type: str = self.config["crawl_type"]
        self.pagination: Optional[Dict[str, Any]] = self.config.get("pagination")
        self.link_selector: Optional[str] = self.config.get("link_selector")
        self.item_selectors: Dict[str, str] = self.config["item_selectors"]

        self.pages_crawled = 0
        self.items_scraped = 0

    def parse(self, response: Response):
        self.pages_crawled += 1
        self.emit_progress()

        if self.crawl_type == "flat":
            yield from self.parse_items(response)

        elif self.crawl_type == "list-detail":
            yield from self.parse_list(response)

        else:
            raise ValueError(f"Unsupported crawl_type: {self.crawl_type}")

        yield from self.handle_pagination(response)

    def parse_items(self, response: Response):
        item = self.extract_item(response)
        if item:
            self.items_scraped += 1
            yield item

    def parse_list(self, response: Response):
        if not self.link_selector:
            raise ValueError("link_selector required for list-detail crawl")

        links = response.css(self.link_selector)
        for link in links:
            url = link.get() if "::attr" in self.link_selector else link.attrib.get("href")
            if url:
                yield response.follow(url, callback=self.parse_detail)

    def parse_detail(self, response: Response):
        item = self.extract_item(response)
        if item:
            self.items_scraped += 1
            yield item

    def handle_pagination(self, response: Response):
        if not self.pagination:
            return

        selector = self.pagination.get("selector")
        max_pages = self.pagination.get("max_pages")

        if max_pages is not None and self.pages_crawled >= max_pages:
            return

        selection = response.css(selector)
        if not selection:
            return

        if "::attr" in selector:
            next_link = selection.get()
        else:
            next_link = selection.attrib.get("href")

        if next_link:
            yield response.follow(next_link, callback=self.parse)

    def extract_item(self, response: Response) -> Optional[Dict[str, Any]]:
        item = {}
        has_data = False

        for field, selector in self.item_selectors.items():
            value = response.css(selector).get()
            if value:
                item[field] = value.strip()
                has_data = True
            else:
                item[field] = None

        if not has_data:
            return None

        item["job_id"] = self.job_id
        item["source_url"] = response.url
        return item

    def emit_progress(self):
        try:
            r = redis.Redis(host='redis', port=6379, db=0)
            event_data = {
                "job_id": self.job_id,
                "event": "progress",
                "data": {
                    "pages_crawled": self.pages_crawled,
                    "items_scraped": self.items_scraped
                }
            }
            r.publish('crawl_events', json.dumps(event_data))
        except Exception as e:
            self.logger.error(f"Failed to publish to Redis: {e}")

    def closed(self, reason: str):
        self.logger.info(
            f"[{self.job_id}] finished: reason={reason}, "
            f"pages={self.pages_crawled}, items={self.items_scraped}"
        )