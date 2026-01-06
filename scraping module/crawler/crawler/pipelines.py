import psycopg
import logging
import os
from scrapy.utils.defer import deferred_from_coro

DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

class PostgresPipeline:
    def __init__(self):
        self.connection = None

    def open_spider(self, spider):
        spider.logger.info("!!! ATTEMPTING CONNECTION !!!")
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
            spider.logger.info("Postgres connection established.")
        except Exception as e:
            spider.logger.error(f"Failed to connect to Postgres: {e}")

    def close_spider(self, spider):
        if self.connection:
            return deferred_from_coro(self.connection.close())

    async def process_item(self, item, spider):
        if self.connection is None:
            spider.logger.error("No database connection. Skipping item.")
            return item

        job_id = item.pop("job_id", "unknown")
        dataset_name = item.pop("dataset_name", "unknown")
        url = item.pop("url", "unknown")
        
        try:
            async with self.connection.cursor() as cur:
                await cur.execute(
                    "INSERT INTO scraped_items (job_id, url, dataset_name, data) VALUES (%s, %s, %s, %s)",
                    (job_id, url, dataset_name, psycopg.types.json.Jsonb(item))
                )
                await self.connection.commit()
        except Exception as e:
            spider.logger.error(f"Error saving to Postgres: {e}")
            if self.connection:
                await self.connection.rollback()
            
        return item