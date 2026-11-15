"""Structured records extracted from PSI investigation text.

Unknown values stay null. Enums use the project vocabulary; ``other`` is only
for a stated value that is outside that vocabulary.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Hardware = Literal["CIR", "MDCA", "MSG", "other"]
PlatformName = Literal["ISS", "drop_tower", "parabolic_flight", "sounding_rocket"]
CategoryName = Literal["prevention", "detection", "suppression"]
FuelPhase = Literal["solid", "liquid", "gas"]
GravityName = Literal["microgravity", "normal", "partial", "simulated_partial"]
OutcomeName = Literal["ignited", "no_ignition", "extinguished", "steady", "unknown"]
TierName = Literal["A", "B"]

RANGE_FIELDS: tuple[str, ...] = (
    "o2_percent_min",
    "o2_percent_max",
    "pressure_kpa_min",
    "pressure_kpa_max",
    "pressure_psi_min",
    "pressure_psi_max",
    "flow_cm_s_min",
    "flow_cm_s_max",
)
FINDING_FIELDS: tuple[str, ...] = (
    "ignition_findings",
    "flame_spread_findings",
    "extinction_findings",
    "key_findings",
)


class SourceRef(BaseModel):
    """Page-level citation. ``page`` is the page marker in the supplied text."""

    model_config = ConfigDict(extra="ignore")

    file_name: str
    title: str
    url: str
    doi: str | None = None
    page: int = Field(ge=1)


class Finding(BaseModel):
    """A statement taken from the source text, with the page it came from."""

    model_config = ConfigDict(extra="ignore")

    text: str
    evidence: list[SourceRef]

    @model_validator(mode="after")
    def require_evidence(self) -> Finding:
        if not self.text.strip():
            raise ValueError("finding text is empty")
        if not self.evidence:
            raise ValueError("finding requires page-level evidence")
        return self


class TestCondition(BaseModel):
    """One stated test sample. Ranges and unseen rows are not a test."""

    model_config = ConfigDict(extra="ignore")

    sample_id: str | None = None
    fuel: str | None = None
    sample_geometry: str | None = None
    o2_percent: float | None = None
    pressure_kpa: float | None = None
    pressure_psi: float | None = None
    flow_cm_s: float | None = None
    diluent: str | None = None
    outcome: OutcomeName = "unknown"
    spread_rate_mm_s: float | None = None
    notes: str | None = None
    evidence: list[SourceRef] = Field(default_factory=list)
    reviewed: bool = False
    reviewed_by: str | None = None

    @model_validator(mode="after")
    def numbers_require_evidence(self) -> TestCondition:
        numbers = (
            self.o2_percent,
            self.pressure_kpa,
            self.pressure_psi,
            self.flow_cm_s,
            self.spread_rate_mm_s,
        )
        if any(value is not None for value in numbers) and not self.evidence:
            raise ValueError("test numbers require page-level evidence")
        return self


class TestBatch(BaseModel):
    """Tests read from one group of table rows, one per row."""

    model_config = ConfigDict(extra="ignore")

    tests: list[TestCondition] = Field(default_factory=list)


class Investigation(BaseModel):
    """One PSI investigation. Catalog identity is filled from local metadata."""

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    acronym: str
    tier: TierName
    psi_url: str
    program: str | None = None
    hardware: Hardware | None = None
    platform: list[PlatformName] = Field(default_factory=list)
    years: str | None = None
    objectives: list[str] = Field(default_factory=list)
    approach: str | None = None
    category: list[CategoryName] = Field(default_factory=list)
    fuel_phase: FuelPhase | None = None
    fuels: list[str] = Field(default_factory=list)
    sample_geometry: str | None = None
    sample_size: str | None = None
    o2_percent_min: float | None = None
    o2_percent_max: float | None = None
    pressure_kpa_min: float | None = None
    pressure_kpa_max: float | None = None
    pressure_psi_min: float | None = None
    pressure_psi_max: float | None = None
    flow_cm_s_min: float | None = None
    flow_cm_s_max: float | None = None
    gravity: GravityName | None = None
    diluents: list[str] = Field(default_factory=list)
    variables_varied: list[str] = Field(default_factory=list)
    variables_fixed: list[str] = Field(default_factory=list)
    sensors: list[str] = Field(default_factory=list)
    tests: list[TestCondition] = Field(default_factory=list)
    ignition_findings: list[Finding] = Field(default_factory=list)
    flame_spread_findings: list[Finding] = Field(default_factory=list)
    extinction_findings: list[Finding] = Field(default_factory=list)
    key_findings: list[Finding] = Field(default_factory=list)
    fire_safety_relevance: str = ""
    sources: list[SourceRef] = Field(default_factory=list)
    needs_review: bool = False
    reviewed: bool = False
    reviewed_by: str | None = None

    @model_validator(mode="after")
    def ranges_require_sources(self) -> Investigation:
        if any(getattr(self, name) is not None for name in RANGE_FIELDS) and not self.sources:
            raise ValueError("numeric ranges require page-level sources")
        return self
