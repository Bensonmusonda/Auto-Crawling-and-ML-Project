import requests
import websockets
import json
import asyncio

SERVER_URL = "http://localhost:8000"
start_crawl_endpoint = "/api/crawl"
crawl_events_endpoint = "/websocket/crawl_events"

config = {
    "job_id": "wiki-test-1",
    "start_url": "https://en.wikipedia.org/wiki/Category:Computer_science",
    "crawl_type": "list-detail",
    "item_selectors": {
            "heading": "h1#firstHeading::text",
            "summary": "#mw-content-text > div.mw-parser-output > p:first-of-type::text"
        },
    "link_selector": "div.mw-category-group ul li a",
    "pagination": {
            "selector": "a.category-nextpage",
            "max_pages": 1
        }
    }

def send_request(url, json_config):
    try:
        response = requests.post(url, json=json_config, timeout=5)
        data = response.json()

        print(f"API Response: {data}")
    except requests.exceptions.RequestException as e:
        print(f"HTTP Error: {e}")

async def monitor_crawling(uri):
    try:
        async with websockets.connect(uri) as websocket:
            while True:
                message = await websocket.recv()
                # data = json.loads(message)
                print(f"[CRAW EVENT] {message}")
    except websockets.exceptions.ConnectionClosed:
        print("Connection close by server")

if __name__ == "__main__":
    send_request(f"{SERVER_URL}{start_crawl_endpoint}", config)
    asyncio.run(monitor_crawling(f"ws://localhost:8000{crawl_events_endpoint}"))