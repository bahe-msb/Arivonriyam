"""Optional semantic hint extraction for Tamil educational concepts."""

from __future__ import annotations

from typing import TypedDict

from settings import get_pipeline_settings


class ConceptHint(TypedDict):
    tamil: str
    transliteration: str
    english: str


_DEFAULT_HINTS: dict[str, dict[str, object]] = {
    "கூட்டல்": {"transliteration": "koottal", "english": "addition", "aliases": ["கூட்டு"]},
    "கழித்தல்": {"transliteration": "kazhiththal", "english": "subtraction", "aliases": ["கழி"]},
    "பெருக்கல்": {"transliteration": "perukkal", "english": "multiplication", "aliases": ["பெருகல்"]},
    "வகுத்தல்": {"transliteration": "vakuththal", "english": "division", "aliases": ["பகுத்தல்"]},
    "பின்னம்": {"transliteration": "pinnam", "english": "fraction", "aliases": ["பினனம்"]},
    "கோணம்": {"transliteration": "konam", "english": "angle", "aliases": ["கோன"]},
    "செங்கோணம்": {"transliteration": "sengkonam", "english": "right angle", "aliases": ["செஙகோணம்"]},
    "முக்கோணம்": {"transliteration": "mukkonam", "english": "triangle", "aliases": []},
    "வட்டம்": {"transliteration": "vattam", "english": "circle", "aliases": []},
    "இடமதிப்பு": {"transliteration": "idamathippu", "english": "place value", "aliases": []},
    "அளவீடு": {"transliteration": "alaveedu", "english": "measurement", "aliases": ["அளவு"]},
    "ஒளிச்சேர்க்கை": {"transliteration": "olicherkkai", "english": "photosynthesis", "aliases": ["ஒளிசேர்க்கை"]},
    "நீர் சுழற்சி": {"transliteration": "neer suzharchi", "english": "water cycle", "aliases": []},
}


def _merged_hints() -> dict[str, dict[str, object]]:
    extra = get_pipeline_settings().embedding.extra_concept_hints
    merged = dict(_DEFAULT_HINTS)
    for tamil, payload in extra.items():
        if tamil and isinstance(payload, dict):
            merged[str(tamil)] = payload
    return merged


def extract_concept_hints(text: str, limit: int | None = None) -> list[ConceptHint]:
    haystack = text.lower()
    hints: list[ConceptHint] = []
    for tamil, payload in _merged_hints().items():
        aliases = payload.get("aliases", [])
        forms = [tamil, *[str(alias) for alias in aliases if alias]]
        if not any(form.lower() in haystack for form in forms):
            continue
        hints.append(
            {
                "tamil": tamil,
                "transliteration": str(payload.get("transliteration", "")),
                "english": str(payload.get("english", "")),
            }
        )
        if limit is not None and len(hints) >= limit:
            break
    return hints