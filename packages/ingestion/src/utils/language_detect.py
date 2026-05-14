"""Script-level language detection for Tamil/Telugu/English text."""

# Tamil Unicode block: U+0B80–U+0BFF
_TAMIL_LOW = 0x0B80
_TAMIL_HIGH = 0x0BFF
# Telugu Unicode block: U+0C00–U+0C7F
_TELUGU_LOW = 0x0C00
_TELUGU_HIGH = 0x0C7F


def count_scripts(text: str) -> tuple[int, int, int]:
    """Return (tamil_count, telugu_count, latin_count) for the given text."""
    tamil = sum(1 for ch in text if _TAMIL_LOW <= ord(ch) <= _TAMIL_HIGH)
    telugu = sum(1 for ch in text if _TELUGU_LOW <= ord(ch) <= _TELUGU_HIGH)
    latin = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    return tamil, telugu, latin


def detect_dominant_language(text: str) -> str:
    """Return 'ta', 'te', 'en', or 'bilingual' based on character distribution."""
    sample = (text or "").strip()
    if not sample:
        return "en"

    tamil, telugu, latin = count_scripts(sample)
    total = tamil + telugu + latin
    if total == 0:
        return "en"

    tamil_ratio = tamil / total
    telugu_ratio = telugu / total

    if telugu > 0 and tamil == 0 and (latin == 0 or telugu_ratio >= 0.65):
        return "te"

    if tamil_ratio >= 0.65:
        return "ta"

    if telugu_ratio >= 0.65:
        return "te"

    if latin / total >= 0.80:
        return "en"

    if telugu > 0 and tamil > 0:
        return "bilingual"

    return "bilingual"


def is_tamil_char(ch: str) -> bool:
    return _TAMIL_LOW <= ord(ch) <= _TAMIL_HIGH


def is_telugu_char(ch: str) -> bool:
    return _TELUGU_LOW <= ord(ch) <= _TELUGU_HIGH


def has_script_switch(text: str) -> bool:
    """Return True if the text switches between Indic and Latin scripts mid-sentence."""
    prev_script: str | None = None
    switches = 0

    def _script_of(ch: str) -> str | None:
        if is_tamil_char(ch):
            return "ta"
        if is_telugu_char(ch):
            return "te"
        if ch.isascii() and ch.isalpha():
            return "latin"
        return None

    for ch in text:
        cur = _script_of(ch)
        if cur is None:
            continue
        if prev_script is not None and cur != prev_script:
            switches += 1
        prev_script = cur

    return switches >= 2
