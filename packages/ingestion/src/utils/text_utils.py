"""Tamil-aware text normalization and OCR noise removal utilities."""

import re
import unicodedata

# Virama (pulli) — used in OCR artifact patterns like "்்்"
_VIRAMA = "்"
# Zero-width non-joiner / zero-width joiner
_ZWNJ = "‌"
_ZWJ  = "‍"

# Repeated virama pattern (OCR artifact)
_RE_REPEATED_VIRAMA = re.compile(r"(்){2,}")
# Control chars except tab, newline, carriage return
_RE_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# Form feed
_RE_FORM_FEED = re.compile(r"\f")
# Excessive whitespace (3+ spaces or 3+ newlines)
_RE_EXCESS_SPACE = re.compile(r" {3,}")
_RE_EXCESS_NEWLINE = re.compile(r"\n{3,}")
# Markdown artifacts
_RE_MARKDOWN = re.compile(r"(\*{1,3}|_{1,2}|#{1,6}\s?|`{1,3})")
# Page boilerplate patterns (SCERT, page numbers)
_RE_BOILERPLATE = re.compile(
    r"(SCERT\s*Tamil\s*Nadu|தமிழ்நாடு\s*அரசு\s*பாடநூல்\s*நிறுவனம்"
    r"|\bPage\b\s*\d+|\bபக்கம்\b\s*\d+"
    r"|\d+\s*\|\s*(?:Tamil|Maths|Science|தமிழ்|கணிதம்|அறிவியல்))",
    re.IGNORECASE,
)


def normalize_unicode(text: str) -> str:
    """Apply NFC normalization — critical for Tamil rendering consistency."""
    return unicodedata.normalize("NFC", text)


def remove_ocr_artifacts(text: str) -> str:
    """Remove common Tamil OCR artifacts: repeated viramas, control chars, form feeds."""
    text = _RE_REPEATED_VIRAMA.sub(_VIRAMA, text)
    text = _RE_CONTROL.sub("", text)
    text = _RE_FORM_FEED.sub(" ", text)
    return text


def remove_boilerplate(text: str) -> str:
    """Strip page numbers and publisher headers that repeat across pages."""
    return _RE_BOILERPLATE.sub("", text)


def normalize_whitespace(text: str) -> str:
    """Collapse excessive whitespace while preserving paragraph breaks."""
    text = _RE_EXCESS_SPACE.sub("  ", text)
    text = _RE_EXCESS_NEWLINE.sub("\n\n", text)
    return text.strip()


def remove_markdown_artifacts(text: str) -> str:
    return _RE_MARKDOWN.sub("", text)


def clean(text: str) -> str:
    """Full cleaning pipeline: normalize → remove artifacts → remove boilerplate → whitespace."""
    text = normalize_unicode(text)
    text = remove_ocr_artifacts(text)
    text = remove_boilerplate(text)
    text = remove_markdown_artifacts(text)
    text = normalize_whitespace(text)
    return text


def ocr_garbage_ratio(text: str) -> float:
    """Fraction of characters that are neither Tamil, ASCII-printable, nor common punctuation."""
    if not text:
        return 0.0
    garbage = sum(
        1 for ch in text
        if not (
            0x0B80 <= ord(ch) <= 0x0BFF  # Tamil
            or ch.isascii()               # ASCII (includes digits, punctuation)
            or ch in "।॥‌‍"    # Indic punctuation, ZWJ/ZWNJ
        )
    )
    return garbage / len(text)
