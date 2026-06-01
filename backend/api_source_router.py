import numpy as np
import os
import json
import httpx
import pandas as pd
import psycopg
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, Dict, List, Any, Literal
from db_utils import get_optional_user, get_user_dataset_dir

router = APIRouter(prefix="/api/api-sources", tags=["api-sources"])

DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

MAX_ROWS = 50_000
MAX_PAGES = 200

# ─── Migration ─────────────────────────────────────────────────────────────────
# Called once from run_ownership_migrations() in db_utils.py — safe to call
# repeatedly because of IF NOT EXISTS.

def run_api_source_config_migration():
    import psycopg as _psycopg
    conn_str = DATABASE_URL.replace("postgresql+asyncpg", "postgresql")
    with _psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS api_source_configs (
                    id          SERIAL PRIMARY KEY,
                    owner_id    INTEGER,
                    name        VARCHAR(100) NOT NULL,
                    description TEXT,
                    config      JSONB NOT NULL,
                    created_at  TIMESTAMPTZ DEFAULT NOW(),
                    updated_at  TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_api_source_configs_owner
                ON api_source_configs (owner_id)
            """)
        conn.commit()

# ─── Schemas ───────────────────────────────────────────────────────────────────

class PaginationConfig(BaseModel):
    mode: Literal["none", "page", "offset", "cursor", "link"] = "none"
    page_param: Optional[str] = "page"
    offset_param: Optional[str] = "offset"
    limit_param: Optional[str] = "limit"
    page_size: Optional[int] = 100   # Optional so null/missing from frontend falls back to default
    start_page: Optional[int] = 1
    cursor_path: Optional[str] = None
    cursor_param: Optional[str] = "cursor"
    max_rows: Optional[int] = None

    @property
    def effective_page_size(self) -> int:
        return self.page_size or 100

    @property
    def effective_start_page(self) -> int:
        return self.start_page or 1


class PreviewRequest(BaseModel):
    url: str
    method: Literal["GET", "POST"] = "GET"
    headers: Dict[str, str] = Field(default_factory=dict)
    body: Optional[Dict[str, Any]] = None


class FetchRequest(BaseModel):
    url: str
    method: Literal["GET", "POST"] = "GET"
    headers: Dict[str, str] = Field(default_factory=dict)
    body: Optional[Dict[str, Any]] = None
    dataset_name: str
    json_path: Optional[str] = None
    columns: Optional[List[str]] = None
    pagination: PaginationConfig = Field(default_factory=PaginationConfig)


class SaveConfigRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    # The config blob — stores everything except auth header values
    config: Dict[str, Any]


# ─── Helpers ───────────────────────────────────────────────────────────────────

def resolve_json_path(data: Any, path: str) -> Any:
    if not path:
        return data
    current = data
    try:
        for key in path.split('.'):
            if isinstance(current, dict):
                current = current[key]
            elif isinstance(current, list):
                current = current[int(key)]
            else:
                return None
        return current
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def is_columnar(data: Any) -> bool:
    if not isinstance(data, dict) or not data:
        return False
    values = list(data.values())
    if not all(isinstance(v, list) for v in values):
        return False
    lengths = {len(v) for v in values}
    return len(lengths) == 1


def build_dataframe(target: Any) -> pd.DataFrame:
    if isinstance(target, list):
        if not target:
            raise ValueError("Target array is empty.")
        return pd.json_normalize(target)
    if is_columnar(target):
        return pd.DataFrame(target)
    if isinstance(target, dict):
        return pd.json_normalize([target])
    raise ValueError(
        "Target must be an array of objects, an object of parallel arrays, or a single object."
    )


async def _do_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    headers: Dict,
    body: Optional[Dict],
    params: Optional[Dict] = None,
    timeout: float = 30.0,
) -> tuple[Any, dict]:
    try:
        if method == "POST":
            resp = await client.post(url, headers=headers, json=body, params=params, timeout=timeout)
        else:
            resp = await client.get(url, headers=headers, params=params, timeout=timeout)
        resp.raise_for_status()
        return resp.json(), dict(resp.headers)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"API returned {e.response.status_code}: {e.response.text[:200]}"
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"Request failed: {str(e)}")


def _extract_link_next(link_header: str) -> Optional[str]:
    if not link_header:
        return None
    for part in link_header.split(','):
        parts = [p.strip() for p in part.split(';')]
        if len(parts) == 2 and parts[1] == 'rel="next"':
            return parts[0].strip('<>')
    return None


def _blank_auth_header_values(headers: Dict[str, str]) -> Dict[str, str]:
    """
    Returns a copy of headers with values for known auth keys blanked out.
    The key names are preserved so the user knows what to re-fill on reload.
    """
    AUTH_KEYS = {'authorization', 'x-api-key', 'api-key', 'x-auth-token', 'token'}
    return {
        k: ('') if k.lower() in AUTH_KEYS else v
        for k, v in headers.items()
    }


# ─── Data endpoints ────────────────────────────────────────────────────────────

@router.post("/preview")
async def preview_api(req: PreviewRequest):
    async with httpx.AsyncClient() as client:
        data, _ = await _do_request(
            client, req.method, req.url, req.headers, req.body, timeout=15.0
        )
    return data


@router.post("/fetch")
async def fetch_and_save_api(
    req: FetchRequest,
    user: Optional[dict] = Depends(get_optional_user)
):
    owner_id = user["id"] if user else None
    row_cap = min(req.pagination.max_rows or MAX_ROWS, MAX_ROWS)
    pg = req.pagination

    frames: List[pd.DataFrame] = []
    total_rows = 0

    async with httpx.AsyncClient() as client:

        if pg.mode == "none":
            raw, _ = await _do_request(client, req.method, req.url, req.headers, req.body)
            target = resolve_json_path(raw, req.json_path) if req.json_path else raw
            frames.append(build_dataframe(target))

        elif pg.mode == "page":
            page = pg.effective_start_page
            for _ in range(MAX_PAGES):
                params = {pg.page_param: page, pg.limit_param: pg.effective_page_size}
                raw, _ = await _do_request(client, req.method, req.url, req.headers, req.body, params=params)
                target = resolve_json_path(raw, req.json_path) if req.json_path else raw
                if not target or (isinstance(target, list) and len(target) == 0):
                    break
                df = build_dataframe(target)
                frames.append(df)
                total_rows += len(df)
                if total_rows >= row_cap or len(df) < pg.effective_page_size:
                    break
                page += 1

        elif pg.mode == "offset":
            offset = 0
            for _ in range(MAX_PAGES):
                params = {pg.offset_param: offset, pg.limit_param: pg.effective_page_size}
                raw, _ = await _do_request(client, req.method, req.url, req.headers, req.body, params=params)
                target = resolve_json_path(raw, req.json_path) if req.json_path else raw
                if not target or (isinstance(target, list) and len(target) == 0):
                    break
                df = build_dataframe(target)
                frames.append(df)
                total_rows += len(df)
                if total_rows >= row_cap or len(df) < pg.effective_page_size:
                    break
                offset += pg.page_size

        elif pg.mode == "cursor":
            if not pg.cursor_path:
                raise HTTPException(status_code=400, detail="cursor_path is required for cursor pagination.")
            cursor = None
            for _ in range(MAX_PAGES):
                params = {}
                if cursor:
                    params[pg.cursor_param] = cursor
                raw, _ = await _do_request(client, req.method, req.url, req.headers, req.body, params=params)
                target = resolve_json_path(raw, req.json_path) if req.json_path else raw
                if not target or (isinstance(target, list) and len(target) == 0):
                    break
                df = build_dataframe(target)
                frames.append(df)
                total_rows += len(df)
                next_cursor = resolve_json_path(raw, pg.cursor_path)
                if not next_cursor or total_rows >= row_cap:
                    break
                cursor = next_cursor

        elif pg.mode == "link":
            next_url: Optional[str] = req.url
            for _ in range(MAX_PAGES):
                if not next_url:
                    break
                raw, resp_headers = await _do_request(client, req.method, next_url, req.headers, req.body)
                target = resolve_json_path(raw, req.json_path) if req.json_path else raw
                if not target or (isinstance(target, list) and len(target) == 0):
                    break
                df = build_dataframe(target)
                frames.append(df)
                total_rows += len(df)
                next_url = _extract_link_next(resp_headers.get("link", ""))
                if total_rows >= row_cap:
                    break

    if not frames:
        raise HTTPException(status_code=400, detail="API returned no data for the given configuration.")

    try:
        df = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
        if len(df) > row_cap:
            df = df.iloc[:row_cap]
        if req.columns:
            valid = [c for c in req.columns if c in df.columns]
            if valid:
                df = df[valid]
        df = df.replace([np.nan, np.inf, -np.inf], None)
        records = df.to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data normalization failed: {str(e)}")

    try:
        target_dir = get_user_dataset_dir(owner_id)
        csv_path = os.path.join(target_dir, f"{req.dataset_name}.csv")
        df.to_csv(csv_path, index=False, encoding="utf-8-sig")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save CSV: {str(e)}")

    try:
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            async with conn.cursor() as cur:
                if user and user.get("is_admin"):
                    await cur.execute(
                        "DELETE FROM scraped_items WHERE dataset_name = %s", (req.dataset_name,)
                    )
                else:
                    await cur.execute(
                        "DELETE FROM scraped_items WHERE dataset_name = %s AND owner_id = %s",
                        (req.dataset_name, owner_id)
                    )
                for record in records:
                    await cur.execute(
                        "INSERT INTO scraped_items (dataset_name, data, owner_id) VALUES (%s, %s, %s)",
                        (req.dataset_name, json.dumps(record), owner_id)
                    )
                await conn.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database insertion failed: {str(e)}")

    return {
        "status": "success",
        "dataset_name": req.dataset_name,
        "row_count": len(records),
        "columns": list(df.columns),
        "csv_path": csv_path,
        "pages_fetched": len(frames),
        "capped": total_rows >= row_cap,
    }


# ─── Config persistence endpoints ─────────────────────────────────────────────

@router.get("/configs")
async def list_configs(user: Optional[dict] = Depends(get_optional_user)):
    """Returns all saved configs belonging to the current user, newest first."""
    owner_id = user["id"] if user else None
    try:
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                await cur.execute(
                    """
                    SELECT id, name, description, config, created_at, updated_at
                    FROM api_source_configs
                    WHERE owner_id IS NOT DISTINCT FROM %s
                    ORDER BY updated_at DESC
                    """,
                    (owner_id,)
                )
                rows = await cur.fetchall()
        # Serialize datetimes for JSON
        return [
            {
                **row,
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
            }
            for row in rows
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load configs: {str(e)}")


@router.post("/configs")
async def save_config(
    req: SaveConfigRequest,
    user: Optional[dict] = Depends(get_optional_user)
):
    """
    Saves a new config. Auth header values are blanked server-side before
    storing so secrets are never persisted to the database.
    """
    owner_id = user["id"] if user else None

    # Blank auth values in the headers field of the stored config blob
    config_to_store = dict(req.config)
    if "headers" in config_to_store and isinstance(config_to_store["headers"], dict):
        config_to_store["headers"] = _blank_auth_header_values(config_to_store["headers"])

    try:
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                await cur.execute(
                    """
                    INSERT INTO api_source_configs (owner_id, name, description, config)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id, name, description, config, created_at, updated_at
                    """,
                    (owner_id, req.name, req.description, json.dumps(config_to_store))
                )
                row = await cur.fetchone()
            await conn.commit()
        return {
            **row,
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save config: {str(e)}")


@router.delete("/configs/{config_id}")
async def delete_config(
    config_id: int,
    user: Optional[dict] = Depends(get_optional_user)
):
    """Deletes a config. Users can only delete their own configs."""
    owner_id = user["id"] if user else None
    try:
        async with await psycopg.AsyncConnection.connect(DATABASE_URL) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    DELETE FROM api_source_configs
                    WHERE id = %s AND owner_id IS NOT DISTINCT FROM %s
                    """,
                    (config_id, owner_id)
                )
                deleted = cur.rowcount
            await conn.commit()
        if deleted == 0:
            raise HTTPException(status_code=404, detail="Config not found or not yours to delete.")
        return {"status": "deleted", "id": config_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete config: {str(e)}")