from fastapi import APIRouter, HTTPException, Query
from typing import Dict
import pandas as pd
import psycopg
from psycopg.rows import dict_row

router = APIRouter(prefix="/api/processed")

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