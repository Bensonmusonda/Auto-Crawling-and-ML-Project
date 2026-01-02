import psycopg2
from psycopg2.extras import Json
from config import Config

class PostgresPipeline:
    def __init__(self):
        self.config = Config()
        self.connection = None
        self.cur = None

    def open_spider(self, spider):
        self.connection = psycopg2.connect(
            dbname=self.config.DB_NAME,
            user=self.config.DB_USER,
            password=self.config.DB_PASSWORD,
            host=self.config.DB_HOST,
            port=self.config.DB_PORT
        )
        self.cur = self.connection.cursor()
        
        self.cur.execute("""
            CREATE TABLE IF NOT EXISTS scraped_items (
                id SERIAL PRIMARY KEY,
                job_id VARCHAR(255),
                dataset_name VARCHAR(255),
                url TEXT,
                data JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.connection.commit()

    def close_spider(self, spider):
        if self.cur:
            self.cur.close()
        if self.connection:
            self.connection.close()

    def process_item(self, item, spider):
        job_id = item.pop("job_id", "unknown")
        dataset_name = item.pop("dataset_name", "unknown")
        url = item.pop("url", "unknown")
        
        try:
            self.cur.execute(
                "INSERT INTO scraped_items (job_id, url, dataset_name, data) VALUES (%s, %s, %s, %s)",
                (job_id, url, dataset_name, Json(item))
            )
            self.connection.commit()
        except Exception as e:
            spider.logger.error(f"Error saving to Postgres: {e}")
            self.connection.rollback()
            
        return item