import scrapy
import json

class ValidatorSpider(scrapy.Spider):
    name = "validator"
    
    custom_settings = {
        "ROBOTSTXT_OBEY": False,
        "USER_AGENT": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "DEFAULT_REQUEST_HEADERS": {
           "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
           "Accept-Language": "en-US,en;q=0.9",
           "Accept-Encoding": "gzip, deflate, br",
           "Upgrade-Insecure-Requests": "1",
        }
    }
    
    def __init__(self, url=None, selectors=None, *args, **kwargs):
        super(ValidatorSpider, self).__init__(*args, **kwargs)
        self.start_urls = [url]
        # selectors should be passed as a JSON string key-value pair
        self.selectors = json.loads(selectors) if selectors else {}

    def start_requests(self):
        for url in self.start_urls:
            yield scrapy.Request(url, callback=self.parse, dont_filter=True)

    def parse(self, response):
        results = {}
        for name, selector in self.selectors.items():
            try:
                # Support both CSS and XPath
                if selector.startswith('//') or selector.startswith('('):
                    matches = response.xpath(selector).getall()
                else:
                    matches = response.css(selector).getall()
                
                results[name] = {
                    "count": len(matches),
                    "first_match": matches[0] if matches else None,
                    "valid": True,
                    "debug_title": response.css("title::text").get("").strip(),
                    "debug_status": response.status,
                    "debug_html": response.text[:1000] # First 1000 chars to identify the page
                }
            except Exception as e:
                results[name] = {
                    "valid": False,
                    "error": str(e)
                }
        
        # We need to output this somewhere the caller can read it.
        # For a simple run, we can print to stdout or return as item.
        yield {
            "type": "validation_result",
            "results": results
        }
