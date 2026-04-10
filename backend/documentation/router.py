"""
FastAPI router for the documentation module.

Endpoints:
  GET /api/docs         → list of all doc metadata
  GET /api/docs/{slug}  → full doc content (HTML) for a single slug
"""

from fastapi import APIRouter, HTTPException
from .core import get_all_meta, get_doc, build_registry
from .schemas import DocMeta, DocContent

router = APIRouter(prefix="/api/docs", tags=["Documentation"])


@router.get("", response_model=list[DocMeta])
async def list_docs():
    """Return metadata for all registered documentation pages."""
    return get_all_meta()


@router.get("/{slug}", response_model=DocContent)
async def get_doc_by_slug(slug: str):
    """Return full content (pre-rendered HTML) for a single documentation page."""
    if slug == "refresh":
        # Handle the special case where someone calls /api/docs/refresh
        build_registry()
        return {"slug": "refresh", "title": "Refresh", "category": "System", "description": "Docs refreshed", "html": "Docs refreshed."}
        
    doc = get_doc(slug)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Document '{slug}' not found")
    return doc

@router.post("/refresh")
async def refresh_docs():
    """Re-scan the DOCS_DIR and rebuild the in-memory documentation registry."""
    from .core import build_registry
    build_registry()
    return {"status": "success", "message": "Documentation registry rebuilt"}
