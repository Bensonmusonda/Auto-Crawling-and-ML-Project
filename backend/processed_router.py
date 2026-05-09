import os
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from typing import Dict, Optional
from db_utils import get_optional_user, get_admin_id
import io
import pandas as pd
import psycopg
from psycopg.rows import dict_row

router = APIRouter(prefix="/api/processed", tags=["processed"])

DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "scraper_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"


@router.get("/{processed_id}/changes-fast")
async def get_changed_rows_fast(processed_id: int) -> Dict:
    """
    Fast approximation of changed rows using precomputed row hashes.
    Much faster than full content comparison — suitable for large datasets.
    """
    try:
        async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
            async with conn.cursor() as cur:
                # Get source name from the processed batch
                await cur.execute(
                    "SELECT DISTINCT source_dataset FROM processed_items WHERE id = %s",
                    (processed_id,)
                )
                source_result = await cur.fetchone()
                if not source_result:
                    raise HTTPException(404, "Processed dataset not found")
                
                source_name = source_result['source_dataset']

                # Count matches/mismatches using hash
                # This assumes processed_items rows correspond 1:1 with scraped_items
                # and were inserted in the same order (or you have a better matching key)
                await cur.execute("""
                    SELECT 
                        COUNT(*) FILTER (WHERE p.row_hash IS NOT NULL AND s.data IS NOT NULL) AS compared,
                        COUNT(*) FILTER (WHERE p.row_hash != md5(s.data::text)) AS changed,
                        COUNT(*) AS total_processed
                    FROM processed_items p
                    JOIN scraped_items s 
                        ON p.source_dataset = s.dataset_name
                    WHERE p.id = %s
                """, (processed_id,))

                stats = await cur.fetchone()

                if not stats or stats['compared'] == 0:
                    return {
                        "status": "no_data",
                        "message": "No comparable rows with hashes found"
                    }

                changed = stats['changed'] or 0
                total = stats['total_processed']

                return {
                    "source_dataset": source_name,
                    "compared_rows": stats['compared'],
                    "changed_rows": changed,
                    "unchanged_rows": stats['compared'] - changed,
                    "total_processed_rows": total,
                    "change_percentage": round((changed / stats['compared'] * 100), 2) if stats['compared'] > 0 else 0.0,
                    "method": "hash-based (fast)",
                    "note": "Assumes 1:1 row correspondence in insertion order"
                }

    except Exception as e:
        raise HTTPException(500, f"Error in fast change detection: {str(e)}")


@router.get("/list")
async def list_processed(
    user: Optional[dict] = Depends(get_optional_user),
):
    if not user:
        return []
        
    owner_id = user["id"]
    is_admin = user.get("is_admin", False)
    
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        async with conn.cursor() as cur:
            if is_admin:
                where_clause = ""
                params = ()
            else:
                where_clause = "WHERE owner_id = %s"
                params = (owner_id,)

            await cur.execute(f"""
                SELECT 
                    MIN(id) AS representative_id,          -- Use for changes/preview links
                    source_dataset,
                    operations_applied,
                    COUNT(*) AS row_count,
                    MIN(processed_at) AS processed_at,
                    MAX(processed_at) AS last_updated
                FROM processed_items
                {where_clause}
                GROUP BY 
                    source_dataset,
                    operations_applied,
                    DATE_TRUNC('minute', processed_at)     -- Group runs within the same minute
                ORDER BY processed_at DESC
            """, params)
            results = await cur.fetchall()
            return results


@router.get("/csv/{source_name}")
async def get_processed_csv(
    source_name: str,
    user: Optional[dict] = Depends(get_optional_user),
):
    if not user:
        raise HTTPException(401, "Authentication required")

    owner_id = user["id"]
    is_admin = user.get("is_admin", False)

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            if is_admin:
                cur.execute(
                    "SELECT data FROM processed_items WHERE source_dataset = %s",
                    (source_name,)
                )
            else:
                cur.execute(
                    "SELECT data FROM processed_items WHERE source_dataset = %s AND owner_id = %s",
                    (source_name, owner_id)
                )
            rows = [r[0] for r in cur.fetchall()]
            if not rows:
                raise HTTPException(404, "Not found")
            
            df = pd.DataFrame(rows)
            output = io.StringIO()
            df.to_csv(output, index=False)
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=processed_{source_name}.csv"}
            )