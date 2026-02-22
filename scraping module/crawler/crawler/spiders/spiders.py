import json
import scrapy
import redis
from scrapy.http import Response
from typing import Dict, Any
from urllib.parse import quote_plus
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
        self.start_urls = [self.config["start_url"].strip()]
        self.crawl_type = self.config["crawl_type"]
        self.pagination = self.config.get("pagination")
        self.link_selector = self.config.get("link_selector")
        self.item_selectors = self.config["item_selectors"]
        self.container_selector = self.config.get("container_selector")

        self.r = redis.Redis(host=REDIS_HOST, port=6379, db=0)

        self.pages_crawled = 0
        self.items_scraped = 0

        # ScraperAPI config
        self.scraper_api_key = os.getenv("SCRAPERAPI_KEY")
        self.tough_sites = ['amazon.com', 'ebay.com', 'walmart.com']

    # -------------------------
    # Request Helpers
    # -------------------------

    def build_scraperapi_url(self, target_url: str) -> str:
        encoded_url = quote_plus(target_url)
        return (
            f"https://api.scraperapi.com/"
            f"?api_key={self.scraper_api_key}"
            f"&url={encoded_url}"
            f"&render=true"
        )

    def should_use_scraperapi(self, url: str) -> bool:
        return (
            self.scraper_api_key is not None
            and any(domain in url for domain in self.tough_sites)
        )

    # -------------------------
    # Start Requests
    # -------------------------

    def start_requests(self):
        for url in self.start_urls:

            if self.should_use_scraperapi(url):
                api_url = self.build_scraperapi_url(url)

                self.logger.warning(f"🤖 Using ScraperAPI for: {url}")

                yield scrapy.Request(
                    api_url,
                    callback=self.parse,
                    dont_filter=True,
                    meta={
                        "original_url": url,
                        "using_scraperapi": True
                    }
                )
            else:
                yield scrapy.Request(
                    url,
                    callback=self.parse,
                    meta={
                        "original_url": url,
                        "using_scraperapi": False
                    }
                )

    # -------------------------
    # Parse
    # -------------------------

    def parse(self, response: Response):
        self.pages_crawled += 1

        original_url = response.meta.get("original_url", response.url)
        using_scraperapi = response.meta.get("using_scraperapi", False)

        self.logger.info(f"=== RESPONSE DEBUG ===")
        self.logger.info(f"URL: {original_url}")
        self.logger.info(f"Proxy URL: {response.url}")
        self.logger.info(f"Status: {response.status}")
        self.logger.info(f"Body length: {len(response.body)}")
        self.logger.info(f"======================")

        if self.crawl_type == "flat":
            if self.container_selector:
                containers = response.css(self.container_selector)
                self.logger.info(
                    f"=== Found {len(containers)} containers using selector '{self.container_selector}'"
                )

                for idx, container in enumerate(containers):
                    item = self.extract_item(container, original_url)
                    self.logger.debug(f"=== Extracted item {idx+1}")
                    self.items_scraped += 1
                    yield item
            else:
                yield self.extract_item(response, original_url)

        elif self.crawl_type == "list-detail":
            yield from self.parse_list(response)

        yield from self.handle_pagination(response)

    # -------------------------
    # List / Detail
    # -------------------------

    def parse_list(self, response: Response):
        if not self.link_selector:
            return

        links = response.css(self.link_selector)
        for link in links:
            url = link.attrib.get("href") or link.css("::attr(href)").get()
            if url:
                yield response.follow(
                    url,
                    callback=self.parse_detail,
                    meta=response.meta  # Preserve scraperapi context
                )

    def parse_detail(self, response: Response):
        self.pages_crawled += 1

        original_url = response.meta.get("original_url", response.url)

        item = self.extract_item(response, original_url)
        if item:
            self.items_scraped += 1
            yield item

        self.emit_progress()

    # -------------------------
    # Pagination
    # -------------------------

    def handle_pagination(self, response: Response):
        if not self.pagination:
            return

        if not hasattr(self, 'list_pages_count'):
            self.list_pages_count = 1

        max_pages = self.pagination.get("max_pages", 5)
        if self.list_pages_count >= max_pages:
            return

        method = self.pagination.get("method", "selector")
        using_scraperapi = response.meta.get("using_scraperapi", False)

        if method == "numeric":
            self.list_pages_count += 1

            base_url = self.config["start_url"].split('?')[0]
            next_url = f"{base_url}?page={self.list_pages_count}"

        else:
            selector = self.pagination.get("selector")
            if not selector:
                return

            next_url = response.css(f"{selector}::attr(href)").get() or \
                       response.css(f"{selector} a::attr(href)").get()

            if not next_url:
                return

            self.list_pages_count += 1

        # Route pagination through ScraperAPI if necessary
        if using_scraperapi and self.should_use_scraperapi(next_url):
            api_url = self.build_scraperapi_url(next_url)

            yield scrapy.Request(
                api_url,
                callback=self.parse,
                meta={
                    "original_url": next_url,
                    "using_scraperapi": True
                }
            )
        else:
            yield response.follow(
                next_url,
                callback=self.parse,
                meta=response.meta
            )

    # -------------------------
    # Item Extraction
    # -------------------------

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
            "url": url  # Now stores real source URL
        })

        return item

    # -------------------------
    # Progress Events
    # -------------------------

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

    def errback_playwright(self, failure):
        self.logger.error(f"❌ PLAYWRIGHT ERROR: {failure.value}")
        self.logger.error(f"Full traceback: {failure.getTraceback()}")