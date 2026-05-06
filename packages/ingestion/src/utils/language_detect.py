"""Script-level language detection for Tamil/English bilingual text."""

import unicodedata

# Tamil Unicode block: U+0B80–U+0BFF
_TAMIL_LOW = 0x0B80
_TAMIL_HIGH = 0x0BFF


def count_scripts(text: str) -> tuple[int, int]:
    """Return (tamil_count, latin_count) for the given text."""
    tamil = sum(1 for ch in text if _TAMIL_LOW <= ord(ch) <= _TAMIL_HIGH)
    latin = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    return tamil, latin


def detect_dominant_language(text: str) -> str:
    """Return 'ta', 'en', or 'bilingual' based on character distribution."""
    sample = (text or "").strip()
    if not sample:
        return "en"
    tamil, latin = count_scripts(sample)
    total = tamil + latin
    if total == 0:
        return "en"
    tamil_ratio = tamil / total
    if tamil_ratio >= 0.65:
        return "ta"
    if tamil_ratio <= 0.20:
        return "en"
    return "bilingual"


def is_tamil_char(ch: str) -> bool:
    return _TAMIL_LOW <= ord(ch) <= _TAMIL_HIGH


def has_script_switch(text: str) -> bool:
    """Return True if the text switches between Tamil and Latin scripts mid-sentence."""
    prev_tamil: bool | None = None
    switches = 0
    for ch in text:
        if is_tamil_char(ch):
            cur = True
        elif ch.isascii() and ch.isalpha():
            cur = False
        else:
            continue
        if prev_tamil is not None and cur != prev_tamil:
            switches += 1
        prev_tamil = cur
    return switches >= 2
