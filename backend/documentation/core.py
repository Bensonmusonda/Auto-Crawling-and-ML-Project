"""
Documentation Registry Service
Scans /app/docs/ for .md files, parses YAML front-matter, and renders
the body to HTML using marko. Results are cached in-process at startup.
"""

import os
import glob
import re
import logging
from typing import Dict, Optional

import yaml
import marko
from marko.ext.gfm import GFM

from .schemas import DocMeta, DocContent

logger = logging.getLogger(__name__)

# Directory where .md files are stored (Docker path; override via DOCS_DIR env var)
DOCS_DIR = os.getenv("DOCS_DIR", "/app/docs")

# ── Front-matter parsing ────────────────────────────────────────────────────

_FM_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _parse_file(path: str) -> Optional[DocContent]:
    """Read a .md file, extract YAML front-matter, and render the body."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()

        # Extract front-matter
        match = _FM_PATTERN.match(raw)
        if not match:
            logger.warning("No YAML front-matter found in %s — skipping", path)
            return None

        fm = yaml.safe_load(match.group(1)) or {}
        body = raw[match.end():]

        slug = fm.get("slug") or os.path.splitext(os.path.basename(path))[0]
        title = fm.get("title", slug.replace("-", " ").title())
        category = fm.get("category", "Guides")
        description = fm.get("description", "")

        md = marko.Markdown(extensions=[GFM])
        html = md(body)

        return DocContent(
            slug=slug,
            title=title,
            category=category,
            description=description,
            html=html,
        )
    except Exception:
        logger.exception("Failed to parse doc file %s", path)
        return None


# ── Registry ────────────────────────────────────────────────────────────────

_registry: Dict[str, DocContent] = {}


def build_registry() -> None:
    """Scan DOCS_DIR and populate the in-process registry."""
    global _registry
    _registry = {}

    if not os.path.isdir(DOCS_DIR):
        logger.warning("DOCS_DIR '%s' does not exist — documentation registry is empty", DOCS_DIR)
        return

    for path in sorted(glob.glob(os.path.join(DOCS_DIR, "*.md"))):
        doc = _parse_file(path)
        if doc:
            _registry[doc.slug] = doc
            logger.info("Registered doc: %s (%s)", doc.slug, doc.category)

    logger.info("Documentation registry built — %d docs loaded", len(_registry))


def get_all_meta() -> list[DocMeta]:
    """Return metadata for all registered docs (no HTML body)."""
    return [
        DocMeta(
            slug=doc.slug,
            title=doc.title,
            category=doc.category,
            description=doc.description,
        )
        for doc in _registry.values()
    ]


def get_doc(slug: str) -> Optional[DocContent]:
    """Return full doc content (with HTML) for a given slug."""
    return _registry.get(slug)
