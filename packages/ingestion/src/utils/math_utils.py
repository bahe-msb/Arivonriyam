"""Math expression detection and Tamil operator spelling for embedding quality."""

import re

# Matches lines with digits/operators and optional Tamil numerals
_RE_MATH_LINE = re.compile(
    r"^[\d\s\+\-\×\÷\=\(\)\[\]\{\}\^\.\,௦-௯0-9"
    r"×÷√π−²³≤≥≠∞]+$"
)

# Worked example start markers (Tamil + English)
_RE_EXAMPLE_START = re.compile(
    r"^(எடுத்துக்காட்டு|Example|Ex\.)\s*[\d\.:]+",
    re.IGNORECASE,
)
_RE_SOLUTION_START = re.compile(
    r"^(தீர்வு|Solution|Ans\.?)\s*[:.]?",
    re.IGNORECASE,
)

# Operator → Tamil name mapping (for embedding quality on math chunks)
_OPERATOR_MAP: dict[str, str] = {
    "+":  "கூட்டல்",
    "-":  "கழித்தல்",
    "×":  "பெருக்கல்",
    "÷":  "வகுத்தல்",
    "=":  "சமம்",
    "²":  "வர்க்கம்",
    "³":  "கியூப்",
    "√":  "வர்க்கமூலம்",
    "∞":  "முடிவிலி",
}


def is_math_expression(line: str) -> bool:
    """Return True if the line is a pure mathematical expression."""
    stripped = line.strip()
    return bool(_RE_MATH_LINE.match(stripped)) and len(stripped) >= 3


def is_example_start(line: str) -> bool:
    return bool(_RE_EXAMPLE_START.match(line.strip()))


def is_solution_start(line: str) -> bool:
    return bool(_RE_SOLUTION_START.match(line.strip()))


def spell_operators_in_tamil(text: str) -> str:
    """Replace math operators with Tamil names to improve embedding on formula chunks."""
    for op, name in _OPERATOR_MAP.items():
        text = text.replace(op, f" {name} ")
    return re.sub(r" {2,}", " ", text).strip()
