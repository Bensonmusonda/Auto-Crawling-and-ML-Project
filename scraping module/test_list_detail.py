from tasks import run_crawl_task

list_detail_config = {
  "job_id": "test-list-detail-001",
  "dataset_name": "quotes_authors",
  "start_url": "https://quotes.toscrape.com/",
  "crawl_type": "list-detail",
  "link_selector": ".quote span a",
  "item_selectors": {
    "author_name": "h3.author-title::text",
    "birth_date": ".author-born-date::text",
    "description": ".author-description::text"
  },
  "pagination": {
    "selector": "li.next a",
    "max_pages": 1
  }
}


if __name__ == "__main__":
    result = run_crawl_task.delay(list_detail_config)
    print(f"🚀 List-Detail Crawl Dispatched! Job ID: {result.id}")