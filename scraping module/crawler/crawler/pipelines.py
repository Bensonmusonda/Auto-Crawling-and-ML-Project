import psycopg
import logging
import os
import urllib.parse
from scrapy.utils.defer import deferred_from_coro
from twisted.internet import defer

DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = urllib.parse.unquote(os.getenv("DB_PASSWORD", "password")) 
# DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

class PostgresPipeline:
    def __init__(self):
        self.connection = None

    def open_spider(self, spider):
        spider.logger.info(f"!!! ATTEMPTING CONNECTION to {DB_HOST}:{DB_PORT}/{DB_NAME} !!!")
        return deferred_from_coro(self._connect_to_db(spider))

    async def _connect_to_db(self, spider):
        """The actual async connection logic."""
        try:
            self.connection = await psycopg.AsyncConnection.connect(
                dbname=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
                host=DB_HOST,
                port=DB_PORT,
                autocommit=False
            )

            async with self.connection.cursor() as cur:
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS scraped_items (
                        id SERIAL PRIMARY KEY,
                        job_id VARCHAR(255),
                        dataset_name VARCHAR(255),
                        url TEXT,
                        data JSONB,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                await self.connection.commit()
            spider.logger.info("✓ Postgres connection established and table ready.")
        except Exception as e:
            spider.logger.error(f"✗ Failed to connect to Postgres: {e}")
            raise e

    def close_spider(self, spider):
        if self.connection:
            spider.logger.info("Closing database connection")
            return deferred_from_coro(self.connection.close())

    def process_item(self, item, spider):
        """
        CRITICAL: This must return a Deferred, not a coroutine
        """
        if self.connection is None:
            spider.logger.error("No database connection. Skipping item.")
            return item
        
        # Convert async to Deferred
        return deferred_from_coro(self._process_item_async(item, spider))
    
    async def _process_item_async(self, item, spider):
        """The actual async processing logic."""
        job_id = item.pop("job_id", "unknown")
        dataset_name = item.pop("dataset_name", "unknown")
        url = item.pop("url", "unknown")
        owner_id = item.pop("owner_id", None)

        try:
            async with self.connection.cursor() as cur:
                await cur.execute(
                    "INSERT INTO scraped_items (job_id, url, dataset_name, data, owner_id) VALUES (%s, %s, %s, %s, %s)",
                    (job_id, url, dataset_name, psycopg.types.json.Jsonb(item), owner_id)
                )
                await self.connection.commit()
            spider.logger.info(f"✓ Saved item to database: {dataset_name}")
        except Exception as e:
            spider.logger.error(f"✗ Error saving to Postgres: {e}")
            if self.connection:
                await self.connection.rollback()
            raise e

        return item

class ValidationPipeline:
    """
    Writes validation results to a temp file specified in settings.
    """
    def __init__(self, result_file):
        self.result_file = result_file

    @classmethod
    def from_crawler(cls, crawler):
        return cls(
            result_file=crawler.settings.get('VALIDATION_RESULT_FILE')
        )

    def process_item(self, item, spider):
        if item.get('type') == 'validation_result' and self.result_file:
            import json
            try:
                with open(self.result_file, 'w') as f:
                    json.dump(item, f)
            except Exception as e:
                spider.logger.error(f"Failed to write validation result: {e}")
        return item