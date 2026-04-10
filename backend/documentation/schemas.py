from pydantic import BaseModel


class DocMeta(BaseModel):
    slug: str
    title: str
    category: str          # e.g. "Technical" | "Guides"
    description: str = ""


class DocContent(DocMeta):
    html: str              # pre-rendered HTML from Markdown
