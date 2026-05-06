"""Parameter replacement for MQL5 / MQL4 Expert Advisor source code.

PROJ-40: Python port of the TypeScript regex logic used by
``src/app/api/mql-converter/export-mt5/route.ts`` (PROJ-33).

The TypeScript version keeps owning the *download* flow (frontend triggers an
already-rendered .mq5 file). This module is for the **deploy** flow — when the
backend itself needs to render an EA from the saved MQL source plus a fresh
parameter override (used by the optimizer-driven deploy in PROJ-38, wired
through PROJ-40's deploy endpoint).

Both implementations MUST stay regex-equivalent. The shared rule:

    (input|extern) <type> <varName> = <oldValue>;
        →
    (input|extern) <type> <varName> = <newValue>;

Only the value between ``=`` and ``;`` is replaced. Whitespace, type, modifiers
and trailing comments stay untouched. A parameter not found in the source is
*recorded* (in ``not_found``) but never causes an error — the caller decides
how to surface that.
"""

from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass
from typing import Iterable, List, Literal, Optional, Tuple, Union

ParamType = Literal["number", "integer", "string", "boolean"]
ParamValue = Union[int, float, str, bool]


@dataclass(frozen=True)
class MqlParameter:
    """A single override sent by the optimizer / UI."""

    mql_input_name: str
    current_value: ParamValue
    type: ParamType


@dataclass(frozen=True)
class ReplacementResult:
    """Outcome of running ``replace_input_defaults`` on one EA source."""

    code: str
    replaced: List[str]
    not_found: List[str]


# ── Public API ──────────────────────────────────────────────────────────────


def replace_input_defaults(
    mql_code: str,
    parameters: Iterable[MqlParameter],
) -> ReplacementResult:
    """Substitute ``input`` / ``extern`` defaults for the given parameters.

    Mirrors the regex used by ``replaceInputDefaults`` in the TS export route.
    """
    code = mql_code
    replaced: List[str] = []
    not_found: List[str] = []

    for param in parameters:
        var_name = re.escape(param.mql_input_name)
        formatted_value = _format_value(param)

        # Match both `input` and `extern` declarations (MQL5 / MQL4):
        #   (input|extern) <type> <varName> = <old_value>;
        pattern = re.compile(
            rf"((?:input|extern)\s+\w+\s+{var_name}\s*=\s*)([^;]+)(;)"
        )

        match = pattern.search(code)
        if match is None:
            not_found.append(param.mql_input_name)
            continue

        old_value = match.group(2).strip()
        # Only count as "replaced" when the rendered value actually differs.
        # Re-running with the same defaults is a no-op for the report.
        new_block = match.group(1) + formatted_value + match.group(3)
        code = code[: match.start()] + new_block + code[match.end():]
        if old_value != formatted_value:
            replaced.append(param.mql_input_name)

    return ReplacementResult(code=code, replaced=replaced, not_found=not_found)


def build_comment_block(
    *,
    conversion_name: Optional[str],
    symbol: str,
    date_from: str,
    date_to: str,
    replaced: List[str],
    not_found: List[str],
    parameters: List[MqlParameter],
    source: str = "MQL Converter",
) -> str:
    """Mirrors ``buildCommentBlock`` — a deterministic header for the rendered EA."""
    export_date = _dt.date.today().isoformat()
    lines: List[str] = [
        "//+------------------------------------------------------------------+",
        "//| Exported by Backtesting Platform                                  |",
        "//+------------------------------------------------------------------+",
    ]

    if conversion_name:
        lines.append(f"// Conversion: {conversion_name}")
    lines.append(f"// Source: {source}")
    lines.append(f"// Symbol: {symbol}")
    lines.append(f"// Backtest period: {date_from} to {date_to}")
    lines.append(f"// Export date: {export_date}")
    lines.append("//")

    if not replaced and not not_found:
        lines.append("// Parameters: unchanged (using original defaults)")
    else:
        if replaced:
            lines.append("// Modified parameters:")
            for name in replaced:
                param = next(
                    (p for p in parameters if p.mql_input_name == name), None
                )
                if param is not None:
                    lines.append(f"//   {name} = {_format_value(param)}")
        if not_found:
            lines.append("//")
            lines.append("// Not found in original MQL (skipped):")
            for name in not_found:
                lines.append(f"//   {name}")

    lines.append("//+------------------------------------------------------------------+")
    lines.append("")
    return "\n".join(lines)


def render_ea(
    *,
    mql_code: str,
    parameters: List[MqlParameter],
    conversion_name: Optional[str],
    symbol: str,
    date_from: str,
    date_to: str,
    source: str = "MT5 Optimizer",
) -> Tuple[str, ReplacementResult]:
    """Convenience wrapper: replace + prepend comment block in one call."""
    result = replace_input_defaults(mql_code, parameters)
    header = build_comment_block(
        conversion_name=conversion_name,
        symbol=symbol,
        date_from=date_from,
        date_to=date_to,
        replaced=result.replaced,
        not_found=result.not_found,
        parameters=parameters,
        source=source,
    )
    return header + result.code, result


# ── Internals ───────────────────────────────────────────────────────────────


def _format_value(param: MqlParameter) -> str:
    """Render a parameter value as it must appear in MQL source.

    Defensive against the value arriving with a type that doesn't match the
    declared `param.type`. In particular, JSON `true` could survive Pydantic
    deserialisation as `1.0` or `1` if a poorly-ordered union ever resolves
    bool → int → float; render the truthy value as `"true"` regardless.
    """
    if param.type == "string":
        # Wrap in double quotes; escape any embedded double quotes.
        text = str(param.current_value).replace('"', '\\"')
        return f'"{text}"'
    if param.type == "integer":
        return str(round(float(param.current_value)))
    if param.type == "boolean":
        val = param.current_value
        # `bool` is a subclass of `int` in Python, so the bool check must run
        # before the numeric branch.
        if isinstance(val, bool):
            return "true" if val else "false"
        if isinstance(val, (int, float)):
            return "true" if val else "false"
        return "true" if str(val).strip().lower() == "true" else "false"
    # type == "number" → float / int as-is
    return str(param.current_value)
