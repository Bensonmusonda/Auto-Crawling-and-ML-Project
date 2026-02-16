from tasks import run_crawl_task

pagination_config = {
      "job_id": "test_flat_quotes_paginated",
      "dataset_name": "quotes_paginated",
      "start_url": "https://quotes.toscrape.com/",
      "crawl_type": "flat",
      "container_selector": ".quote",
      "item_selectors": {
        "quote_text": "span.text::text",
        "author": "small.author::text",
        "tags": ".tags a.tag::text"
      },
      "pagination": {
        "selector": "li.next a",
        "max_pages": 5
      }
    }



if __name__ == "__main__":
    result = run_crawl_task.delay(pagination_config)
    print(f"🚀 Paginated Crawl Dispatched! Job ID: {result.id}")