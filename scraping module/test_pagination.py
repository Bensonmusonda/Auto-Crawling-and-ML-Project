from tasks import run_crawl_task

pagination_config = {
      "job_id": "test_flat_quotes_paginated",
      "start_url": "https://quotes.toscrape.com/",
      "crawl_type": "flat",
      "item_selectors": {
        "quote_text": ".quote span.text::text",
        "author": ".quote small.author::text",
        "tags": ".quote .tags a.tag::text"
      },
      "pagination": {
        "selector": "li.next a::attr(href)",
        "max_pages": 5
      }
    }



if __name__ == "__main__":
    result = run_crawl_task.delay(pagination_config)
    print(f"🚀 Paginated Crawl Dispatched! Job ID: {result.id}")