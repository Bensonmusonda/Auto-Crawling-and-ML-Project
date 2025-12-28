import json
from tasks import run_crawl_task

quotes_config = {
    "start_url": "https://quotes.toscrape.com/",
    "crawl_type": "flat",
    "container_selector": ".quote",
    
    "item_selectors": {
        "text": ".text::text",
        "author": ".author::text",
        "tags": ".tags .tag::text"
    },
    
    "pagination": {
        "selector": "li.next a", 
        "max_pages": 3 
    }
}

if __name__ == "__main__":
    result = run_crawl_task.delay(quotes_config)
    print(f"🚀 Quotes Pagination Crawl Dispatched!")
    print(f"Job ID: {result.id}")
    print(f"Targeting: {quotes_config['start_url']} (Max 3 pages)")