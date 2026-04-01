import json
import scrapy
import redis
import psycopg
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
        
        # Load tough_sites, playwright_sites, and hybrid_sites from database
        try:
            db_url = (
                f"postgresql://{os.getenv('DB_USER', 'postgres')}:{os.getenv('DB_PASSWORD', 'password')}"
                f"@{os.getenv('DB_HOST', 'postgres')}:{os.getenv('DB_PORT', '5432')}/{os.getenv('DB_NAME', 'scraper_db')}"
            )
            with psycopg.connect(db_url) as conn:
                with conn.cursor() as cur:
                    # Get tough_sites
                    cur.execute("SELECT value FROM app_config WHERE key = 'tough_sites'")
                    row = cur.fetchone()
                    self.tough_sites = row[0] if row else ['amazon.com', 'ebay.com', 'walmart.com']
                    
                    # Get playwright_sites
                    cur.execute("SELECT value FROM app_config WHERE key = 'playwright_sites'")
                    row = cur.fetchone()
                    self.playwright_sites = row[0] if row else []
                    
                    # Get hybrid_sites (ScraperAPI with JS instructions)
                    cur.execute("SELECT value FROM app_config WHERE key = 'hybrid_sites'")
                    row = cur.fetchone()
                    self.hybrid_sites = row[0] if row else []
                    
        except Exception as e:
            self.tough_sites = ['amazon.com', 'ebay.com', 'walmart.com']
            self.playwright_sites = []
            self.hybrid_sites = []
            self.logger.warning(f"[Spider] Could not load config from DB, using defaults: {e}")
    
    # -------------------------
    # Request Helpers
    # -------------------------

    def build_scraperapi_url(self, target_url: str, wait_selector: str = None) -> str:
        """
        Build ScraperAPI URL with optional wait_for_selector.
        
        Args:
            target_url: The URL to scrape
            wait_selector: CSS selector to wait for before returning HTML
        """
        encoded_url = quote_plus(target_url)
        params = [
            f"api_key={self.scraper_api_key}",
            f"url={encoded_url}",
            "render=true"
        ]
        
        # Add wait_for_selector if provided (for hybrid sites)
        if wait_selector:
            params.append(f"wait_for_selector={quote_plus(wait_selector)}")
        
        return "https://api.scraperapi.com/?" + "&".join(params)

    def should_use_scraperapi(self, url: str) -> bool:
        return (
            self.scraper_api_key is not None
            and any(domain in url for domain in self.tough_sites)
        )
    
    def should_use_playwright(self, url: str) -> bool:
        return any(domain in url for domain in self.playwright_sites)
    
    def should_use_hybrid(self, url: str) -> bool:
        """Check if URL should use ScraperAPI with wait_for_selector"""
        return any(domain in url for domain in self.hybrid_sites)

    # -------------------------
    # Start Requests
    # -------------------------

    def start_requests(self):
        for url in self.start_urls:
            
            # Priority: Playwright > Hybrid (ScraperAPI + wait) > ScraperAPI > Regular
            if self.should_use_playwright(url):
                self.logger.warning(f"🎭 Using Playwright for: {url}")
                
                yield scrapy.Request(
                    url,
                    callback=self.parse,
                    dont_filter=True,
                    meta={
                        "playwright": True,
                        "playwright_include_page": True,
                        "playwright_page_methods": [
                            ("wait_for_timeout", 3000),
                            ("wait_for_selector", self.container_selector or "body"),
                        ],
                        "original_url": url,
                        "using_playwright": True,
                        "using_hybrid": False,
                        "using_scraperapi": False
                    },
                    errback=self.errback_playwright
                )
            
            elif self.should_use_hybrid(url):
                # Use ScraperAPI with wait_for_selector
                api_url = self.build_scraperapi_url(
                    url, 
                    wait_selector=self.container_selector
                )

                self.logger.warning(f"🔧 Using Hybrid (ScraperAPI + wait) for: {url}")
                self.logger.warning(f"⏳ Waiting for selector: {self.container_selector}")

                yield scrapy.Request(
                    api_url,
                    callback=self.parse,
                    dont_filter=True,
                    meta={
                        "original_url": url,
                        "using_hybrid": True,
                        "using_scraperapi": False,
                        "using_playwright": False
                    }
                )
                
            elif self.should_use_scraperapi(url):
                # Regular ScraperAPI without wait_for_selector
                api_url = self.build_scraperapi_url(url)

                self.logger.warning(f"🤖 Using ScraperAPI for: {url}")

                yield scrapy.Request(
                    api_url,
                    callback=self.parse,
                    dont_filter=True,
                    meta={
                        "original_url": url,
                        "using_scraperapi": True,
                        "using_hybrid": False,
                        "using_playwright": False
                    }
                )
            else:
                # Regular Scrapy request
                yield scrapy.Request(
                    url,
                    callback=self.parse,
                    meta={
                        "original_url": url,
                        "using_scraperapi": False,
                        "using_hybrid": False,
                        "using_playwright": False
                    }
                )

    # -------------------------
    # Parse
    # -------------------------

    def parse(self, response: Response):
        self.pages_crawled += 1

        original_url = response.meta.get("original_url", response.url)
        using_scraperapi = response.meta.get("using_scraperapi", False)
        using_hybrid = response.meta.get("using_hybrid", False)
        using_playwright = response.meta.get("using_playwright", False)

        self.logger.info(f"=== RESPONSE DEBUG ===")
        self.logger.info(f"URL: {original_url}")
        self.logger.info(f"Actual URL: {response.url}")
        self.logger.info(f"Status: {response.status}")
        self.logger.info(f"Body length: {len(response.body)}")
        self.logger.info(f"Playwright: {using_playwright}, Hybrid: {using_hybrid}, ScraperAPI: {using_scraperapi}")
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
                    if idx % 5 == 0:  # emit every 5 items
                        self.emit_progress()
                self.emit_progress()
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
                    meta=response.meta  # Preserve context
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
        using_hybrid = response.meta.get("using_hybrid", False)
        using_playwright = response.meta.get("using_playwright", False)

        if method == "numeric":
            self.list_pages_count += 1

            base_url = self.config["start_url"].split('?')[0]
            next_url = f"{base_url}?page={self.list_pages_count}"

        else:  # selector-based pagination
            selector = self.pagination.get("selector")
            if not selector:
                return

            next_url = response.css(f"{selector}::attr(href)").get() or \
                       response.css(f"{selector} a::attr(href)").get()

            if not next_url:
                self.logger.info("No next page link found - end of pagination")
                return

            self.list_pages_count += 1

        # Route pagination based on what was used for first request
        if using_playwright:
            yield scrapy.Request(
                next_url,
                callback=self.parse,
                meta={
                    "playwright": True,
                    "playwright_include_page": True,
                    "playwright_page_methods": [
                        ("wait_for_timeout", 3000),
                        ("wait_for_selector", self.container_selector or "body"),
                    ],
                    "original_url": next_url,
                    "using_playwright": True,
                    "using_hybrid": False,
                    "using_scraperapi": False
                },
                errback=self.errback_playwright
            )
        elif using_hybrid:
            # Use ScraperAPI with wait_for_selector for pagination
            api_url = self.build_scraperapi_url(
                next_url,
                wait_selector=self.container_selector
            )

            self.logger.info(f"Following pagination (hybrid) to: {next_url}")

            yield scrapy.Request(
                api_url,
                callback=self.parse,
                meta={
                    "original_url": next_url,
                    "using_hybrid": True,
                    "using_scraperapi": False,
                    "using_playwright": False
                }
            )
        elif using_scraperapi and self.should_use_scraperapi(next_url):
            # Regular ScraperAPI without wait_for_selector
            api_url = self.build_scraperapi_url(next_url)

            self.logger.info(f"Following pagination (ScraperAPI) to: {next_url}")

            yield scrapy.Request(
                api_url,
                callback=self.parse,
                meta={
                    "original_url": next_url,
                    "using_scraperapi": True,
                    "using_hybrid": False,
                    "using_playwright": False
                }
            )
        else:
            # Regular Scrapy follow
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
            
            # Handle XPath
            if sel.startswith('/') or sel.startswith('./'):
                # XPath: check if it already has text() extraction
                if 'text()' not in sel:
                    sel = f"{sel}/text()"
                results = selector.xpath(sel).getall()
            
            # Handle CSS
            else:
                # CSS: auto-append ::text if not present
                if '::text' not in sel and '::attr' not in sel:
                    sel = f"{sel}::text"
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