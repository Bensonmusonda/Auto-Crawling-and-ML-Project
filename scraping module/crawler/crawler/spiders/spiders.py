import json
import scrapy
import redis
from scrapy.http import Response
from typing import Dict, Any, Optional
import os

REDIS_HOST = os.getenv("REDIS_HOST", "redis")

class UniversalSpider(scrapy.Spider):
    name = "universal_spider"

    def __init__(self, config: str, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if config.endswith(".json"):
            with open(config, "r") as f:
                self.config = json.load(f)
        else:
            self.config = json.loads(config)

        self.job_id = self.config["job_id"]
        self.dataset_name = self.config["dataset_name"]
        self.start_urls = [self.config["start_url"]]
        self.crawl_type = self.config["crawl_type"]
        self.pagination = self.config.get("pagination")
        self.link_selector = self.config.get("link_selector")
        self.item_selectors = self.config["item_selectors"]
        self.container_selector = self.config.get("container_selector")

        self.r = redis.Redis(host=REDIS_HOST, port=6379, db=0)

        self.pages_crawled = 0
        self.items_scraped = 0

    def parse(self, response: Response):
        self.pages_crawled += 1
        self.emit_progress()

        # Debug: inspect the response
        self.logger.info(f"=== RESPONSE DEBUG ===")
        self.logger.info(f"URL: {response.url}")
        self.logger.info(f"Status: {response.status}")
        self.logger.info(f"Body length: {len(response.body)}")
        self.logger.info(f"First 500 chars: {response.text[:500]}")
        self.logger.info(f"======================")

        self.logger.info(f"=== PARSE DEBUG: crawl_type={self.crawl_type}, container_selector={self.container_selector}")
        
        if self.crawl_type == "flat":
            if self.container_selector:
                containers = response.css(self.container_selector)
                self.logger.info(f"=== Found {len(containers)} containers using selector '{self.container_selector}'")
                for idx, container in enumerate(containers):
                    item = self.extract_item(container, response.url)
                    self.logger.debug(f"=== Extracted item {idx+1}: {item}")
                    self.items_scraped += 1
                    yield item
            else:
                yield self.extract_item(response, response.url)

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
        
        item = self.extract_item(response, response.url)
        if item:
            self.items_scraped += 1
            yield item
        self.emit_progress()

    def handle_pagination(self, response: Response):
        if not self.pagination:
            return

        if not hasattr(self, 'list_pages_count'):
            self.list_pages_count = 1

        max_pages = self.pagination.get("max_pages", 5)
        if self.list_pages_count >= max_pages:
            return

        method = self.pagination.get("method", "selector")

        if method == "numeric":
            self.list_pages_count += 1
            
            base_url = self.config["start_url"].split('?')[0]
            next_url = f"{base_url}?page={self.list_pages_count}"
            yield response.follow(next_url, callback=self.parse)

        else:
            selector = self.pagination.get("selector")
            if selector:
                next_page = response.css(f"{selector}::attr(href)").get() or \
                            response.css(f"{selector} a::attr(href)").get()
                if next_page:
                    self.list_pages_count += 1
                    yield response.follow(next_page, callback=self.parse)

    def extract_item(self, selector, url: str) -> Dict[str, Any]:
        item = {}
        for field, sel in self.item_selectors.items():
            
            if sel.startswith('/') or sel.startswith('./'):
                results = selector.xpath(sel).getall()
            else:
                results = selector.css(sel).getall()
            
            if results:
                cleaned = [r.strip() for r in results if r.strip()]
                
                separator = ", " if field in ["tags", "platforms", "genre"] else " "
                item[field] = separator.join(cleaned)
            else:
                item[field] = None

        item.update({
            "job_id": self.job_id,
            "dataset_name": self.dataset_name,
            "url": url
        })
        return item

    def emit_progress(self):
        try:
            event_data = {
                "job_id": self.job_id,
                "dataset_name": self.dataset_name,
                "event": "progress",
                "data": {
                    "pages_crawled": self.pages_crawled,
                    "items_scraped": self.items_scraped
                }
            }
            self.r.publish('crawl_events', json.dumps(event_data))
        except Exception as e:
            self.logger.error(f"Redis publish failed: {e}")