# Backend Module

The backend serves as the core orchestration layer for the Data Acquisition & ML Platform. Built with FastAPI, it manages data persistence, task scheduling, and real-time event distribution.

## Key Features

- **Automated Crawling API**: Triggers distributed Scrapy tasks via Celery and monitors progress through Redis Pub/Sub.
- **ML Pipeline Engine**: Orchestrates data processing and machine learning workflows, including feature engineering and model training.
- **Dataset Management**: Handles CSV storage, database integration (PostgreSQL), and dynamic dataset exploration.
- **Real-time Updates**: Uses WebSockets to provide live status updates on crawling and processing tasks.

## Core Services

- **FastAPI**: Main web server hosting the REST API and WebSockets.
- **Celery**: Distributed task queue for long-running scraping and ML jobs.
- **PostgreSQL**: Primary database for storing scraped items, jobs, and processing configs.
- **Redis**: Message broker for Celery and pub/sub for real-time events.

## API Categories

- `/api/crawl`: Endpoints for starting crawls, monitoring job status, and managing target site configurations.
- `/api/process`: Configures and executes ML processing pipelines.
- `/api/datasets`: Utilities for listing datasets, managing CSV files, and retrieving schemas.
- `/api/workflows`: CRUD operations for automated multi-stage processing workflows.

## Development Setup

### Local Prerequisites

- Python 3.10+
- PostgreSQL and Redis instances

### Installation

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the server (with reload):
   ```bash
   uvicorn main:app --reload --port 8000
   ```

Note: Ensure your environment variables are configured in the root `.env` file to connect to the database and broker.
