"""API settings from the environment.

Model names and the Google Cloud project are never hard-coded. Locally they are
read from the repo-root ``.env``; on Cloud Run they are set on the service.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

API_DIR = Path(__file__).resolve().parent
REPO_ROOT = API_DIR.parent


class ConfigError(RuntimeError):
    """A required setting is missing."""


@dataclass(frozen=True)
class Settings:
    gcp_project: str
    gcp_region: str
    gemini_model: str
    embed_model: str
    web_origin: str
    firebase_project: str
    data_dir: Path


def default_data_dir() -> Path:
    """``/app/data`` inside the image, ``data/`` at the repo root locally."""
    bundled = API_DIR / "data"
    return bundled if bundled.is_dir() else REPO_ROOT / "data"


def load_settings(require_ai: bool = True) -> Settings:
    try:
        from dotenv import load_dotenv

        load_dotenv(API_DIR / ".env")
        load_dotenv(REPO_ROOT / ".env")
    except ImportError:  # python-dotenv is a dev convenience only
        pass
    env = os.environ
    if require_ai:
        missing = [
            name
            for name in ("GCP_PROJECT", "GCP_REGION", "GEMINI_MODEL", "EMBED_MODEL")
            if not env.get(name, "").strip()
        ]
        if missing:
            raise ConfigError(
                f"Missing required environment variables: {', '.join(missing)}. "
                "Set them in the repo-root .env or on the Cloud Run service."
            )
    project = env.get("GCP_PROJECT", "").strip()
    return Settings(
        gcp_project=project,
        gcp_region=env.get("GCP_REGION", "").strip(),
        gemini_model=env.get("GEMINI_MODEL", "").strip(),
        embed_model=env.get("EMBED_MODEL", "").strip(),
        web_origin=env.get("WEB_ORIGIN", "").strip().rstrip("/"),
        firebase_project=env.get("FIREBASE_PROJECT_ID", "").strip() or project,
        data_dir=Path(env["DATA_DIR"]) if env.get("DATA_DIR") else default_data_dir(),
    )
