"""Tests for required pipeline settings."""

from __future__ import annotations

import pytest

from config import REQUIRED_ENV_VARS, ConfigError, settings_from_environ

_COMPLETE = {
    "GCP_PROJECT": "example-project",
    "GCP_REGION": "us-central1",
    "GEMINI_MODEL": "example-gemini",
    "EMBED_MODEL": "example-embed",
}


def test_missing_env_names_every_absent_variable() -> None:
    with pytest.raises(ConfigError) as exc_info:
        settings_from_environ({})
    message = str(exc_info.value)
    for name in REQUIRED_ENV_VARS:
        assert name in message


def test_blank_values_count_as_missing() -> None:
    blank = {name: "   " for name in REQUIRED_ENV_VARS}
    with pytest.raises(ConfigError) as exc_info:
        settings_from_environ(blank)
    assert "GCP_PROJECT" in str(exc_info.value)


def test_settings_load_when_all_present() -> None:
    settings = settings_from_environ(_COMPLETE)
    assert settings.gcp_project == "example-project"
    assert settings.gcp_region == "us-central1"
    assert settings.gemini_model == "example-gemini"
    assert settings.embed_model == "example-embed"
