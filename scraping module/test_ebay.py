import json
import redis
import uuid
from tasks import run_crawl_task

def trigger_ebay_test():
    job_id = f"ebay-cs-{uuid.uuid4().hex[:6]}"
    
    config = {
        "job_id": "2813a814-59e6-4284-93e9-b660d7e6a111",
        "dataset_name": "ebay_test",
        "start_url": "https://www.ebay.com/sch/i.html?_nkw=laptop",
        "crawl_type": "flat",
        "item_selectors": {
            "buy_count": ".su-styled-text",
            "location": ".su-styled-text",
            "price": "./div[contains(@class, 'su-card-container')]/div[contains(@class, 'su-card-container__content')]/div[contains(@class, 'su-card-container__attributes')]/div[contains(@class, 'su-card-container__attributes__primary')]/div[contains(@class, 's-card__attribute-row')]/span[contains(@class, 'su-styled-text')]",
            "product_name": "./div[contains(@class, 'su-card-container')]/div[contains(@class, 'su-card-container__content')]/div[contains(@class, 'su-card-container__header')]/a[contains(@class, 's-card__link')]/div[contains(@class, 's-card__title')]/span[contains(@class, 'su-styled-text')]"
        },
        "container_selector": "li.s-card"
        }

    print(f"🚀 Triggering eBay Crawl. Job ID: {job_id}")
    run_crawl_task.delay(json.dumps(config))

if __name__ == "__main__":
    trigger_ebay_test()