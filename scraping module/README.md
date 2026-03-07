# Scraping Module

The scraping module is a high-performance, distributed data extraction engine built on Scrapy and Celery. It is designed to handle large-scale crawls while providing tools for selector validation.

## Architecture

- **Universal Spider**: A flexible Scrapy spider that consumes dynamic JSON configurations to target specific sites and data points.
- **Celery Workers**: Handles the execution of crawl tasks across a distributed environment.
- **Playwright Integration**: Provides a specialized validator that uses headless browsers to verify CSS/XPath selectors on JavaScript-heavy websites.

## Key Components

- `tasks.py`: Defines the Celery tasks (`run_crawl_task`, `validate_selector`).
- `crawler/`: Contains the Scrapy project, spider definitions, and item pipelines.
- `playwright_validator.py`: Logic for headless browser validation.

## Configuration

The module uses Scrapy settings for bot identification, download delays, and concurrency. These are managed dynamically during task execution based on the request configuration.

## Setup & Testing

### Installation

```bash
cd "scraping module"
pip install -r requirements.txt
playwright install chromium
```

### Running a Test Crawl

You can run individual tests or the main Celery worker to start processing tasks:

```bash
# Start Celery worker
celery -A tasks worker --loglevel=info
```

For manual testing, several `test_*.py` scripts are available to verify spider behavior on different site categories.
