#!/usr/bin/env python3
"""
Simple standalone Scrapy test to verify the spider works.
This bypasses Celery to see if the core spider logic is working.
"""
import sys
import os
import json

# Make sure we can import from crawler
sys.path.insert(0, os.path.join(os.getcwd(), 'crawler'))

from scrapy.crawler import CrawlerProcess
from scrapy.settings import Settings
from crawler.spiders.spiders import UniversalSpider

# Simple test config
test_config = {
    "job_id": "simple-test-001",
    "dataset_name": "simple_test",
    "start_url": "https://quotes.toscrape.com/",
    "crawl_type": "flat",
    "container_selector": ".quote",  # THIS WAS MISSING IN test_flat.py!
    "item_selectors": {
        "quote_text": ".text::text",
        "author": ".author::text",
        "tags": ".tags .tag::text"
    },
    "pagination": {
        "selector": "li.next a",
        "max_pages": 2
    }
}

if __name__ == "__main__":
    print("=== SIMPLE SCRAPY TEST (No Celery, No DB) ===\n")
    print(f"Config: {json.dumps(test_config, indent=2)}\n")
    
    settings = Settings()
    settings.set('LOG_LEVEL', 'DEBUG')
    settings.set('ROBOTSTXT_OBEY', False)
    
    # Use a simple JSON file output instead of database
    settings.set('FEEDS', {
        'test_output.json': {'format': 'json', 'overwrite': True}
    })
    
    try:
        process = CrawlerProcess(settings)
        process.crawl(UniversalSpider, config=json.dumps(test_config))
        process.start()
        
        print("\n=== CRAWL COMPLETE ===")
        print("Check test_output.json for results")
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
