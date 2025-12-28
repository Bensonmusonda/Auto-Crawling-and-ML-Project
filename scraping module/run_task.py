from tasks import run_crawl_task

test_config = {
	    "start_url": "https://quotes.toscrape.com/",
	    "crawl_type": "flat",
	    "item_selectors": {
	        "quote": ".text",
	        "author": ".small"
	    },
	    "pagination": {
	        "selector": ".next a",
	        "max_pages": 2
	    }
	}

result = run_crawl_task.delay(test_config)
print(f"Task sent! Job ID: {result.id}")