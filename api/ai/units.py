"""Unit conversion for filter ranges and derived values. Pure, no I/O.

Each unit maps to (dimension, factor, offset): base = value * factor + offset.
"""

from __future__ import annotations

import re

_UNITS: dict[str, tuple[str, float, float]] = {}


def _add(dimension: str, factor: float, *names: str, offset: float = 0.0) -> None:
    for name in names:
        _UNITS[name] = (dimension, factor, offset)


# pressure, base psi
_add("pressure", 1.0, "psi", "psia", "lbf/in2", "lb/in2")
_add("pressure", 0.1450377, "kpa")
_add("pressure", 0.0001450377, "pa")
_add("pressure", 145.0377, "mpa")
_add("pressure", 14.69595, "atm", "atmosphere", "atmospheres")
_add("pressure", 14.50377, "bar")
_add("pressure", 0.01450377, "mbar", "hpa")
_add("pressure", 0.01933678, "torr", "mmhg")
# speed, base cm/s
_add("speed", 1.0, "cm/s")
_add("speed", 0.1, "mm/s")
_add("speed", 100.0, "m/s")
_add("speed", 2.54, "in/s")
_add("speed", 30.48, "ft/s")
_add("speed", 0.508, "ft/min", "fpm")
# fraction, base percent
_add("fraction", 1.0, "%", "vol%", "%o2", "mol%")
_add("fraction", 100.0, "fraction", "molefraction", "volumefraction", "molarfraction")
# length, base mm
_add("length", 1.0, "mm")
_add("length", 10.0, "cm")
_add("length", 1000.0, "m")
_add("length", 0.001, "um", "micron", "microns")
_add("length", 25.4, "in", "inch", "inches")
_add("length", 0.0254, "mil", "mils")
_add("length", 304.8, "ft")
# temperature, base K
_add("temperature", 1.0, "k")
_add("temperature", 1.0, "c", "degc", offset=273.15)
_add("temperature", 5.0 / 9.0, "f", "degf", offset=273.15 - 32.0 * 5.0 / 9.0)
# time, base s
_add("time", 1.0, "s")
_add("time", 0.001, "ms")
_add("time", 60.0, "min")
_add("time", 3600.0, "h", "hr")
# mass, base g
_add("mass", 1.0, "g")
_add("mass", 0.001, "mg")
_add("mass", 1000.0, "kg")
# heat flux, base kW/m2
_add("heat_flux", 1.0, "kw/m2")
_add("heat_flux", 0.001, "w/m2")
_add("heat_flux", 10.0, "w/cm2")
# power, base W
_add("power", 1.0, "w")
_add("power", 1000.0, "kw")
_add("power", 0.001, "mw")

_WORDS = {
    "percent": "%", "pct": "%",
    "seconds": "s", "second": "s", "sec": "s", "secs": "s",
    "minutes": "min", "minute": "min", "hours": "h", "hour": "h",
    "millimeters": "mm", "millimeter": "mm", "millimetres": "mm", "millimetre": "mm",
    "centimeters": "cm", "centimeter": "cm", "centimetres": "cm", "centimetre": "cm",
    "meters": "m", "meter": "m", "metres": "m", "metre": "m",
    "micrometers": "um", "micrometer": "um", "micrometres": "um", "micrometre": "um",
    "kilopascals": "kpa", "kilopascal": "kpa", "pascals": "pa", "pascal": "pa",
    "kelvin": "k", "celsius": "c", "fahrenheit": "f",
    "grams": "g", "gram": "g", "milligrams": "mg", "kilograms": "kg",
    "watts": "w", "watt": "w", "kilowatts": "kw",
    "feet": "ft", "foot": "ft",
}


def normalize_unit(unit: str | None) -> str:
    """'cm per second' -> 'cm/s', 'kW/m²' -> 'kw/m2', '°C' -> 'c', 'µm' -> 'um'."""
    text = (unit or "").lower().strip()
    for old, new in (("µ", "u"), ("μ", "u"), ("²", "2"), ("^", ""), ("°", ""), (" per ", "/"), ("deg ", "deg")):
        text = text.replace(old, new)
    parts = re.split(r"(/)", text)
    parts = ["".join(_WORDS.get(word, word) for word in part.split()) for part in parts]
    return "".join(parts)


def dimension(unit: str | None) -> str | None:
    entry = _UNITS.get(normalize_unit(unit))
    return entry[0] if entry else None


def convert(value: float, from_unit: str | None, to_unit: str | None) -> float | None:
    """Value in ``to_unit``, or None when the units are not comparable."""
    source, target = normalize_unit(from_unit), normalize_unit(to_unit)
    if source == target:
        return float(value)
    a, b = _UNITS.get(source), _UNITS.get(target)
    if a is None or b is None or a[0] != b[0]:
        return None
    return (value * a[1] + a[2] - b[2]) / b[1]
