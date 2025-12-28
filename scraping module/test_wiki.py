import json
import redis
import uuid
from tasks import run_crawl_task

def trigger_wiki_test():
    job_id = f"wiki-cs-{uuid.uuid4().hex[:6]}"
    
    config = {
        "job_id": job_id,
        "start_url": "https://en.wikipedia.org/wiki/Category:Computer_science",
        "crawl_type": "list-detail",
        "link_selector": "div.mw-category-group ul li a",
        "item_selectors": {
            "heading": "h1#firstHeading::text",
            "summary": "#mw-content-text > div.mw-parser-output > p:first-of-type::text"
        },
        "pagination": {
            "selector": "a.category-nextpage",
            "max_pages": 1
        }
    }

    print(f"🚀 Triggering Wikipedia Crawl. Job ID: {job_id}")
    run_crawl_task.delay(json.dumps(config))

if __name__ == "__main__":
    trigger_wiki_test()