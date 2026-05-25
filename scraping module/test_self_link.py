import sys
import os
import json

# Make sure we can import from crawler
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'crawler'))

from scrapy.crawler import CrawlerProcess
from scrapy.settings import Settings
from crawler.spiders.spiders import UniversalSpider

# Test config for container-as-link (self link_selector)
# We set container_selector to the <a> links themselves, and link_selector to "self".
self_link_config = {
    "job_id": "self-link-test-001",
    "dataset_name": "self_link_test",
    "start_url": "https://quotes.toscrape.com/",
    "crawl_type": "list-detail",
    "container_selector": ".quote span a",  # The container is the <a> element
    "link_selector": "self",                 # We extract href from the container itself
    "item_selectors": {
        "author_name": "h3.author-title::text",
        "birth_date": ".author-born-date::text"
    },
    "pagination": {
        "selector": "li.next a",
        "max_pages": 1
    }
}

if __name__ == "__main__":
    print("=== STANDALONE SELF-LINK SCRAPY TEST ===\n")
    print(f"Config: {json.dumps(self_link_config, indent=2)}\n")
    
    settings = Settings()
    settings.set('LOG_LEVEL', 'INFO')
    settings.set('ROBOTSTXT_OBEY', False)
    
    # Use a simple JSON file output
    settings.set('FEEDS', {
        'self_link_output.json': {'format': 'json', 'overwrite': True}
    })
    
    try:
        process = CrawlerProcess(settings)
        process.crawl(UniversalSpider, config=json.dumps(self_link_config))
        process.start()
        
        print("\n=== CRAWL COMPLETE ===")
        print("Results stored in self_link_output.json")
        
        # Read and display results
        if os.path.exists('self_link_output.json'):
            with open('self_link_output.json', 'r') as f:
                data = json.load(f)
                print(f"Total items crawled: {len(data)}")
                print("Sample items:")
                print(json.dumps(data[:3], indent=2))
        else:
            print("❌ Output file not found!")
            
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
