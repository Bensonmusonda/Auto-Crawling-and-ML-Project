from tasks import run_crawl_task

flat_config = {
  "job_id": "test-flat-001",
  "start_url": "https://quotes.toscrape.com/",
  "crawl_type": "flat",
  "item_selectors": {
    "quote_text": ".quote .text::text",
    "author": ".quote .author::text",
    "tags": ".quote .tags .tag::text"
  },
  "pagination": {
    "selector": "li.next a",
    "max_pages": 2
  }
}


if __name__ == "__main__":
    result = run_crawl_task.delay(flat_config)
    print(f"🚀 Flat Crawl Dispatched! Job ID: {result.id}")