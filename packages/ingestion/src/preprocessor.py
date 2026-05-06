"""Pre-processing stage: OCR noise removal, structural tagging, language detection.

Applied to Unstructured elements *before* chunking.
"""

import re
import logging
from typing import Any

from utils.text_utils import clean, ocr_garbage_ratio
from utils.language_detect import detect_dominant_language
from utils.math_utils import is_math_expression, is_example_start, is_solution_start
from schema import ElementType, DominantLanguage

logger = logging.getLogger(__name__)

# Structural signal patterns — ordered by specificity
_SIGNALS: list[tuple[re.Pattern, ElementType]] = [
    (re.compile(r"^(வரையறை|Definition|என்றால்\s*என்ன)", re.IGNORECASE), ElementType.DEFINITION),
    (re.compile(r"^(தேற்றம்|Theorem)\b", re.IGNORECASE),               ElementType.THEOREM),
    (re.compile(r"^(எடுத்துக்காட்டு|Example|Ex\.)\s*[\d\.:]+", re.IGNORECASE), ElementType.EXAMPLE),
    (re.compile(r"^(பயிற்சி|Exercise)\b|\bEx(ercise)?\s*\d+", re.IGNORECASE), ElementType.EXERCISE),
    (re.compile(r"^(சுருக்கம்|Summary|முக்கிய\s*கருத்துகள்)", re.IGNORECASE), ElementType.SUMMARY),
]

_RE_FORMULA = re.compile(r"[=\+\-\×\÷\d\(\)\[\]√π]{3,}.*=")


def _detect_element_type(text: str, unstructured_type: str) -> ElementType:
    """Map Unstructured element type + text content to our ElementType enum."""
    if unstructured_type == "Table":
        return ElementType.TABLE
    stripped = text.strip()
    for pattern, etype in _SIGNALS:
        if pattern.match(stripped):
            return etype
    if is_math_expression(stripped) or _RE_FORMULA.search(stripped):
        return ElementType.FORMULA
    if is_example_start(stripped) or is_solution_start(stripped):
        return ElementType.EXAMPLE
    return ElementType.BODY


class TextPreprocessor:
    """Cleans and structurally tags Unstructured elements before chunking."""

    def __init__(self, garbage_threshold: float = 0.40):
        self._garbage_threshold = garbage_threshold

    def preprocess_element(self, element: Any) -> dict | None:
        """
        Process one Unstructured element.

        Returns a dict with cleaned text and tags, or None if element should
        be discarded (too short, too much OCR garbage).

        Args:
            element: An Unstructured document element.

        Returns:
            Processed element dict or None.
        """
        raw_text: str = getattr(element, "text", "") or ""
        etype_name: str = type(element).__name__
        meta = getattr(element, "metadata", None)
        page = getattr(meta, "page_number", 0) or 0

        # Always preserve Tables — clean but never discard
        if etype_name == "Table":
            html = getattr(meta, "text_as_html", None)
            return {
                "text": html or raw_text,
                "element_type": ElementType.TABLE,
                "dominant_language": DominantLanguage.BILINGUAL,
                "is_math_expression": False,
                "page_number": page,
                "unstructured_type": etype_name,
                "orig": element,
            }

        cleaned = clean(raw_text)

        if len(cleaned.strip()) < 20:
            return None
        if ocr_garbage_ratio(cleaned) > self._garbage_threshold:
            logger.debug("Discarding high-garbage element: %.0f%% garbage",
                         ocr_garbage_ratio(cleaned) * 100)
            return None

        element_type = _detect_element_type(cleaned, etype_name)
        lang_code = detect_dominant_language(cleaned)
        lang = DominantLanguage(lang_code) if lang_code in DominantLanguage._value2member_map_ else DominantLanguage.BILINGUAL
        any_math = is_math_expression(cleaned) or element_type == ElementType.FORMULA

        return {
            "text": cleaned,
            "element_type": element_type,
            "dominant_language": lang,
            "is_math_expression": any_math,
            "page_number": page,
            "unstructured_type": etype_name,
            "orig": element,
        }

    def preprocess(self, elements: list[Any]) -> list[dict]:
        """
        Process a list of Unstructured elements.

        Args:
            elements: Raw output from partition_pdf.

        Returns:
            List of cleaned, tagged element dicts.
        """
        result = []
        for el in elements:
            processed = self.preprocess_element(el)
            if processed is not None:
                result.append(processed)
        logger.info("Preprocessor: %d → %d elements (%.0f%% retained)",
                    len(elements), len(result), 100 * len(result) / max(len(elements), 1))
        return result
