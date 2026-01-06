import os
from pathlib import Path
from dotenv import load_dotenv

# BASE_DIR = Path(__file__).resolve().parent

# status = load_dotenv(dotenv_path=BASE_DIR / ".env")
class Config:
    REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
    DB_NAME = os.getenv("DB_NAME", "scraper_db")
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "password")
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "5432")

    @property
    def DATABASE_URL(self):
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"