import scrapy
import json
import logging
from scrapy.http import HtmlResponse

class ValidatorSpider(scrapy.Spider):
    name = "validator"
    
    # More aggressive browser impersonation
    custom_settings = {
        "ROBOTSTXT_OBEY": False,
        "CONCURRENT_REQUESTS": 1,
        "DOWNLOAD_DELAY": 2,
        "RANDOMIZE_DOWNLOAD_DELAY": True,
        
        # Chrome 120 on Windows 10
        "USER_AGENT": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        
        "DEFAULT_REQUEST_HEADERS": {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Cache-Control": "max-age=0",
            "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
        },
        
        # Important for Amazon
        "COOKIES_ENABLED": True,
        "COOKIES_DEBUG": True,
        
        # Retry settings
        "RETRY_TIMES": 3,
        "RETRY_HTTP_CODES": [500, 502, 503, 504, 408, 429, 403],
        
        # Reduce logging noise
        "LOG_LEVEL": "INFO",
    }
    
    def __init__(self, url=None, selectors=None, *args, **kwargs):
        super(ValidatorSpider, self).__init__(*args, **kwargs)
        self.start_urls = [url]
        self.selectors = json.loads(selectors) if selectors else {}
        self.logger.setLevel(logging.INFO)

    def start_requests(self):
        for url in self.start_urls:
            # First, visit the homepage to get cookies
            if 'amazon' in url.lower():
                homepage = self._get_homepage(url)
                yield scrapy.Request(
                    homepage,
                    callback=self.parse_homepage,
                    meta={'target_url': url},
                    dont_filter=True,
                    headers={
                        "Referer": "https://www.google.com/",
                    }
                )
            else:
                # For non-Amazon sites, go directly
                yield scrapy.Request(
                    url, 
                    callback=self.parse, 
                    dont_filter=True,
                    headers={
                        "Referer": "https://www.google.com/",
                    }
                )
    
    def _get_homepage(self, url):
        """Extract homepage from URL"""
        from urllib.parse import urlparse
        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}/"
    
    def parse_homepage(self, response):
        """Visit homepage first to establish session, then visit target"""
        target_url = response.meta['target_url']
        self.logger.info(f"Visited homepage, now requesting: {target_url}")
        
        # Now request the actual page with cookies from homepage
        yield scrapy.Request(
            target_url,
            callback=self.parse,
            dont_filter=True,
            headers={
                "Referer": response.url,
            }
        )

    def parse(self, response):
        results = {}
        
        # Check if we got a bot challenge page
        is_blocked = self._detect_bot_challenge(response)
        
        # Debug: Log what we received
        self.logger.info(f"Response status: {response.status}")
        self.logger.info(f"Response URL: {response.url}")
        self.logger.info(f"HTML length: {len(response.text)}")
        self.logger.info(f"Bot challenge detected: {is_blocked}")
        
        # Extract some common page elements for debugging
        page_title = response.css("title::text").get("").strip()
        self.logger.info(f"Page title: {page_title}")
        
        # If blocked, try to provide helpful debug info
        if is_blocked:
            blocking_info = self._analyze_blocking(response)
            
            for name, selector in self.selectors.items():
                results[name] = {
                    "count": 0,
                    "valid": False,
                    "selector_found": False,
                    "blocked": True,
                    "blocking_type": blocking_info["type"],
                    "debug_info": {
                        "title": page_title,
                        "status": response.status,
                        "url": response.url,
                        "html_snippet": response.text[:2000],
                        "blocking_info": blocking_info,
                        "suggestions": [
                            {
                                "type": "bot_detected",
                                "message": f"Bot challenge detected: {blocking_info['type']}",
                                "recommendation": blocking_info["recommendation"]
                            }
                        ]
                    }
                }
        else:
            # Normal validation
            for name, selector in self.selectors.items():
                try:
                    # Support both CSS and XPath
                    if selector.startswith('//') or selector.startswith('('):
                        matches = response.xpath(selector).getall()
                    else:
                        matches = response.css(selector).getall()
                    
                    # Try to find similar selectors if exact match fails
                    suggestions = []
                    if len(matches) == 0:
                        suggestions = self._find_similar_selectors(response, selector)
                    
                    results[name] = {
                        "count": len(matches),
                        "first_match": matches[0][:200] if matches else None,
                        "all_matches_preview": [m[:100] for m in matches[:3]],
                        "valid": True,
                        "selector_found": len(matches) > 0,
                        "blocked": False,
                        "debug_info": {
                            "title": page_title,
                            "status": response.status,
                            "url": response.url,
                            "html_snippet": response.text[:2000],
                            "suggestions": suggestions
                        }
                    }
                    
                    self.logger.info(f"Selector '{name}' ({selector}): {len(matches)} matches")
                    
                except Exception as e:
                    self.logger.error(f"Error testing selector '{name}': {e}")
                    results[name] = {
                        "valid": False,
                        "error": str(e),
                        "selector_found": False,
                        "blocked": False
                    }
        
        # Yield the results
        yield {
            "type": "validation_result",
            "results": results
        }
    
    def _detect_bot_challenge(self, response):
        """Detect if we're getting a bot challenge page"""
        text = response.text.lower()
        
        # Common bot challenge indicators
        indicators = [
            'gokuprops',  # Amazon WAF
            'captcha',
            'robot check',
            'verify you are human',
            'access denied',
            'security check',
            'unusual traffic',
            'automated access',
            'sorry, we just need to make sure',
            'cloudflare',
            'recaptcha',
            'hcaptcha',
        ]
        
        for indicator in indicators:
            if indicator in text:
                self.logger.warning(f"Bot challenge detected: {indicator}")
                return True
        
        # Check if title is empty or generic (often a sign of challenge page)
        title = response.css("title::text").get("").strip().lower()
        if not title or title in ['', 'attention', 'just a moment', 'please wait']:
            return True
        
        return False
    
    def _analyze_blocking(self, response):
        """Analyze what type of blocking we encountered"""
        text = response.text.lower()
        
        if 'gokuprops' in text or 'aws-waf' in text:
            return {
                "type": "AWS WAF / Amazon Bot Detection",
                "recommendation": "Use Selenium/Playwright with real browser, or use residential proxies",
                "difficulty": "Hard"
            }
        elif 'captcha' in text or 'recaptcha' in text:
            return {
                "type": "CAPTCHA Challenge",
                "recommendation": "Manual solving required or use CAPTCHA solving service",
                "difficulty": "Very Hard"
            }
        elif 'cloudflare' in text:
            return {
                "type": "Cloudflare Challenge",
                "recommendation": "Use cloudscraper library or Selenium",
                "difficulty": "Medium-Hard"
            }
        elif response.status == 403:
            return {
                "type": "403 Forbidden",
                "recommendation": "IP banned or WAF block. Use proxies and better headers",
                "difficulty": "Medium"
            }
        else:
            return {
                "type": "Unknown Block",
                "recommendation": "Check response HTML for clues",
                "difficulty": "Unknown"
            }
    
    def _find_similar_selectors(self, response, original_selector):
        """Try to find why the selector failed and suggest alternatives"""
        suggestions = []
        
        # If it's an ID selector
        if original_selector.startswith('#'):
            id_part = original_selector.split(' ')[0].replace('#', '')
            elements_with_id = response.css(f'#{id_part}').getall()
            if not elements_with_id:
                all_ids = response.css('[id]::attr(id)').getall()
                similar = [i for i in all_ids if id_part.lower() in i.lower()][:5]
                if similar:
                    suggestions.append({
                        "type": "similar_ids",
                        "message": f"ID '{id_part}' not found. Similar IDs on page:",
                        "values": similar
                    })
            else:
                suggestions.append({
                    "type": "partial_match",
                    "message": f"ID '{id_part}' exists, but full selector chain doesn't match",
                    "html": elements_with_id[0][:500] if elements_with_id else None
                })
        
        # If it's a data attribute selector
        elif original_selector.startswith('[data-'):
            attr_name = original_selector.split('=')[0].replace('[', '').replace(']', '')
            all_data_attrs = response.css(f'[{attr_name}]').getall()
            if not all_data_attrs:
                suggestions.append({
                    "type": "attribute_not_found",
                    "message": f"Attribute '{attr_name}' not found on page"
                })
            else:
                suggestions.append({
                    "type": "attribute_exists",
                    "message": f"Attribute '{attr_name}' exists ({len(all_data_attrs)} elements), but value doesn't match"
                })
        
        # If it's a class selector
        elif original_selector.startswith('.'):
            class_part = original_selector.split(' ')[0]
            elements_with_class = response.css(class_part).getall()
            if not elements_with_class:
                suggestions.append({
                    "type": "class_not_found",
                    "message": f"Class '{class_part}' not found on page"
                })
        
        # Check if it's a child selector (>)
        if '>' in original_selector:
            parent_selector = original_selector.split('>')[0].strip()
            parent_matches = response.css(parent_selector).getall()
            if parent_matches:
                suggestions.append({
                    "type": "parent_exists",
                    "message": f"Parent selector '{parent_selector}' exists ({len(parent_matches)} matches), but children don't match",
                    "parent_html": parent_matches[0][:500] if parent_matches else None
                })
            else:
                suggestions.append({
                    "type": "parent_missing",
                    "message": f"Parent selector '{parent_selector}' not found"
                })
        
        return suggestions