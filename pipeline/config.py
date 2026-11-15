"""Load pipeline settings from the environment.

Model names and the Google Cloud project are never hard-coded. Copy
``.env.example`` to ``.env`` at the repo root and set every variable.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict

REQUIRED_ENV_VARS: tuple[str, ...] = (
    "GCP_PROJECT",
    "GCP_REGION",
    "GEMINI_MODEL",
    "EMBED_MODEL",
)

_PIPELINE_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _PIPELINE_DIR.parent


class ConfigError(RuntimeError):
    """Raised when a required pipeline setting is missing or blank."""


class Settings(BaseModel):
    """Vertex AI settings for extraction and embedding."""

    model_config = ConfigDict(frozen=True)

    gcp_project: str
    gcp_region: str
    gemini_model: str
    embed_model: str


def load_dotenv_files() -> None:
    """Fill unset variables from ``pipeline/.env``, then the repo-root ``.env``.

    Variables already set in the process environment are left alone.
    """
    load_dotenv(_PIPELINE_DIR / ".env")
    load_dotenv(_REPO_ROOT / ".env")


def settings_from_environ(environ: Mapping[str, str]) -> Settings:
    """Build settings from a mapping. Blank values count as missing."""
    missing = [name for name in REQUIRED_ENV_VARS if not environ.get(name, "").strip()]
    if missing:
        listed = ", ".join(missing)
        raise ConfigError(
            f"Missing required environment variables: {listed}. "
            "Copy .env.example to .env at the repo root and set "
            "GCP_PROJECT, GCP_REGION, GEMINI_MODEL, and EMBED_MODEL."
        )
    return Settings(
        gcp_project=environ["GCP_PROJECT"].strip(),
        gcp_region=environ["GCP_REGION"].strip(),
        gemini_model=environ["GEMINI_MODEL"].strip(),
        embed_model=environ["EMBED_MODEL"].strip(),
    )


def load_settings() -> Settings:
    """Load ``.env`` files and return settings, or raise ``ConfigError``."""
    load_dotenv_files()
    return settings_from_environ(os.environ)


if __name__ == "__main__":
    load_settings()
    print("Pipeline config ok.")
