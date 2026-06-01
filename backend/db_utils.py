"""
db_utils.py — Ownership migrations and optional-auth FastAPI dependency.

On startup this runs once:
  1. Adds is_admin column to users
  2. Adds owner_id FK to scraped_items / crawl_jobs / workflows / model_registry
  3. Creates the admin user if they don't exist
  4. Reassigns any legacy NULL-owner rows to the admin user

Admin account:
  Username: ADMIN_USERNAME env var  (default: "admin")
  Password: ADMIN_PASSWORD env var  (default: "admin123")
"""

import os
import bcrypt
import psycopg
from psycopg.rows import dict_row
from typing import Optional
from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends
from jose import JWTError, jwt
import shutil
import glob

# ── Config ────────────────────────────────────────────────────────────────────
JWT_SECRET    = os.getenv("JWT_SECRET",      "supersecretkey_changeme_in_prod")
JWT_ALGORITHM = "HS256"

DB_HOST     = os.getenv("DB_HOST",     "postgres")
DB_PORT     = os.getenv("DB_PORT",     "5432")
DB_NAME     = os.getenv("DB_NAME",     "scraper_db")
DB_USER     = os.getenv("DB_USER",     "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

# auto_error=False → returns None instead of 401 when no token present
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

# Tables that get an owner_id column
_OWNED_TABLES = (
    "scraped_items",
    "crawl_jobs",
    "workflows",
    "model_registry",
    "processed_items",
    "processing_jobs"
)

CSV_DATASET_DIR = "/app/datasets"

def get_user_dataset_dir(owner_id: Optional[int]) -> str:
    """Returns the scoped directory for a user's CSV files."""
    if owner_id is None:
        return CSV_DATASET_DIR  # fallback to root for anonymous (though unlikely now)
    scoped_path = os.path.join(CSV_DATASET_DIR, f"user_{owner_id}")
    os.makedirs(scoped_path, exist_ok=True)
    return scoped_path


# ── Migration ─────────────────────────────────────────────────────────────────
def run_ownership_migrations():
    """
    Idempotent. Safe to call multiple times.
    """
    try:
        from api_source_router import run_api_source_config_migration

        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:

                # 1. Ensure users table exists (auth_router creates it, but it may not exist yet)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        id         SERIAL PRIMARY KEY,
                        username   TEXT UNIQUE NOT NULL,
                        email      TEXT UNIQUE,
                        hashed_pw  TEXT NOT NULL,
                        is_admin   BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                """)

                # 1b. Add is_admin to existing users tables that may have been created
                #     before this column existed
                cur.execute("""
                    ALTER TABLE users
                    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE
                """)

                # 2. Add owner_id to each owned table (only if the table exists)
                for table in _OWNED_TABLES:
                    cur.execute("""
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = %s
                    """, (table,))
                    if cur.fetchone():
                        cur.execute(f"""
                            ALTER TABLE {table}
                            ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)
                        """)

                # 3. Create / verify admin user
                cur.execute(
                    "SELECT id, is_admin FROM users WHERE username = %s",
                    (ADMIN_USERNAME,)
                )
                admin_row = cur.fetchone()

                if not admin_row:
                    hashed = bcrypt.hashpw(
                        ADMIN_PASSWORD.encode(), bcrypt.gensalt()
                    ).decode()
                    cur.execute("""
                        INSERT INTO users (username, hashed_pw, is_admin)
                        VALUES (%s, %s, TRUE)
                        RETURNING id
                    """, (ADMIN_USERNAME, hashed))
                    admin_row = cur.fetchone()
                else:
                    # Ensure existing admin has the flag
                    cur.execute(
                        "UPDATE users SET is_admin = TRUE WHERE username = %s",
                        (ADMIN_USERNAME,)
                    )

                admin_id = admin_row["id"]

                # 4. Reassign legacy NULL-owner rows → admin
                for table in _OWNED_TABLES:
                    cur.execute("""
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = %s AND column_name = 'owner_id'
                    """, (table,))
                    if cur.fetchone():
                        cur.execute(
                            f"UPDATE {table} SET owner_id = %s WHERE owner_id IS NULL",
                            (admin_id,)
                        )

                conn.commit()
                print(
                    f"[db_utils] Migrations OK — admin='{ADMIN_USERNAME}' (id={admin_id})"
                )

                # 5. File System Migration: Move existing root CSVs to admin folder
                admin_dir = get_user_dataset_dir(admin_id)
                # glob files in root /app/datasets/ but NOT in subfolders
                root_files = glob.glob(os.path.join(CSV_DATASET_DIR, "*.csv"))
                for f in root_files:
                    dest = os.path.join(admin_dir, os.path.basename(f))
                    if not os.path.exists(dest):
                        try:
                            shutil.move(f, dest)
                            print(f"[db_utils] Migrated file to admin scoped dir: {os.path.basename(f)}")
                        except Exception as e:
                            print(f"[db_utils] Failed to migrate {f}: {e}")
            run_api_source_config_migration()
    except Exception as exc:
        # Startup should not crash the server if PG isn't ready yet.
        # The migration will run again on the next lifespan cycle or can be
        # triggered manually via the /auth/me warmup call.
        print(f"[db_utils] Migration warning (non-fatal): {exc}")


_ADMIN_ID_CACHE = None

async def get_admin_id() -> int:
    global _ADMIN_ID_CACHE
    if _ADMIN_ID_CACHE is not None:
        return _ADMIN_ID_CACHE
    try:
        async with await psycopg.AsyncConnection.connect(
            DATABASE_URL, row_factory=dict_row
        ) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id FROM users WHERE is_admin = TRUE ORDER BY id ASC LIMIT 1"
                )
                row = await cur.fetchone()
                if row:
                    _ADMIN_ID_CACHE = row["id"]
                    return _ADMIN_ID_CACHE
    except Exception:
        pass
    # DO NOT fall back to 1 — if the DB isn't ready, raise so the caller knows
    raise RuntimeError("Could not resolve admin ID — database may not be ready")


# ── FastAPI dependency ────────────────────────────────────────────────────────
def get_optional_user(
    token: Optional[str] = Depends(oauth2_scheme),
) -> Optional[dict]:
    """
    Returns the current user dict  {id, username, is_admin}  or None.
    Never raises 401 — every endpoint decides if auth is required.
    """
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            return None
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, username, is_admin FROM users WHERE username = %s",
                    (username,),
                )
                return cur.fetchone()
    except (JWTError, Exception):
        return None
