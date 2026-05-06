"""Shared types, enums, and constants for the ingestion pipeline."""

from enum import Enum
from typing import List, Optional, TypedDict

from pydantic import BaseModel, Field


class ElementType(str, Enum):
    DEFINITION = "definition"
    THEOREM    = "theorem"
    EXAMPLE    = "example"
    EXERCISE   = "exercise"
    FORMULA    = "formula"
    SUMMARY    = "summary"
    TABLE      = "table"
    BODY       = "body"
    DIAGRAM_CAPTION = "diagram_caption"


class DominantLanguage(str, Enum):
    TAMIL    = "ta"
    ENGLISH  = "en"
    BILINGUAL = "bilingual"


class ChunkMeta(BaseModel):
    """Fully validated metadata attached to every LangChain Document."""

    source_file:   str
    subject:       str
    standard:      int = Field(ge=1, le=10)
    chapter_number: int = Field(default=0, ge=0)
    chapter_title:  str = Field(default="")
    page_number:    int = Field(default=0, ge=0)
    element_type:   ElementType = ElementType.BODY
    dominant_language: DominantLanguage = DominantLanguage.TAMIL
    is_math_expression: bool = False
    chunk_index:    int = Field(default=0, ge=0)
    total_chunks_in_chapter: int = Field(default=0, ge=0)
    chunk_hash:     str = ""
    hypothetical_question_tamil:   str = ""
    hypothetical_question_english: str = ""
    keywords:       List[str] = Field(default_factory=list)

    class Config:
        use_enum_values = True


# Per-element-type chunking parameters
class _CfgEntry(TypedDict):
    chunk_size: int
    chunk_overlap: int


CHUNK_CONFIG: dict[str, _CfgEntry] = {
    "body":        {"chunk_size": 512, "chunk_overlap": 64},
    "definition":  {"chunk_size": 256, "chunk_overlap": 0},
    "example":     {"chunk_size": 600, "chunk_overlap": 50},
    "exercise":    {"chunk_size": 400, "chunk_overlap": 0},
    "summary":     {"chunk_size": 512, "chunk_overlap": 32},
    "formula":     {"chunk_size": 128, "chunk_overlap": 0},
    "table":       {"chunk_size": 800, "chunk_overlap": 0},
    "theorem":     {"chunk_size": 300, "chunk_overlap": 0},
    "diagram_caption": {"chunk_size": 150, "chunk_overlap": 0},
}
