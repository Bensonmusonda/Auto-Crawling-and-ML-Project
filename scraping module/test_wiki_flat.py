import json
from tasks import run_crawl_task
wiki_flat_config = {
    "start_url": "https://en.wikipedia.org/wiki/List_of_computer_science_awards",
    "crawl_type": "flat",

    "container_selector": "#mw-content-text .mw-parser-output ul li",
    
    "item_selectors": {
        "award_name": "css:a:first-of-type::text",
        "description": "css:::text"
    },
    
    "pagination": {
        "selector": None, 
        "max_pages": 1
    }
}

if __name__ == "__main__":
    result = run_crawl_task.delay(wiki_flat_config)
    print(f"🚀 Wiki Flat Crawl Dispatched! Job ID: {result.id}")
    print("Check your Redis listener to see the items rolling in.")