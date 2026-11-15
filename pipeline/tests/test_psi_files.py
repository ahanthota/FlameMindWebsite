"""Tests for which PSI files are kept locally."""

from __future__ import annotations

from psi_files import local_subdir, should_download, tier_for

_SCIENCE = "/Home/psi-data/PSI-26/Science Documents/PSI-26_Science Documents_SRD_BASS.pdf"
_TABLE = "/Home/psi-data/PSI-26/Experimental table/PSI-26_Experimental table_BASS.csv"
_RAW = "/Home/psi-data/PSI-26/Raw Data/PSI-26_Raw Data_2013_04_09_txt.zip"
_VIDEO = "/Home/psi-data/PSI-26/Raw Data/flame.mp4"


def test_tier_a_matches_the_named_investigations() -> None:
    assert tier_for("PSI-26") == "A"
    assert tier_for("PSI-98") == "A"
    assert tier_for("PSI-20") == "A"
    assert tier_for("PSI-47") == "B"
    assert tier_for("PSI-22") == "B"


def test_small_science_pdf_is_kept() -> None:
    assert should_download(_SCIENCE, "PSI-26_Science Documents_SRD_BASS.pdf", 863_500)


def test_experimental_table_is_kept() -> None:
    assert should_download(_TABLE, "PSI-26_Experimental table_BASS.csv", 4_726)


def test_raw_archive_is_left_on_psi() -> None:
    assert not should_download(_RAW, "PSI-26_Raw Data_2013_04_09_txt.zip", 33_000)


def test_video_is_left_on_psi() -> None:
    assert not should_download(_VIDEO, "flame.mp4", 2_000_000)


def test_file_over_50_mb_is_skipped() -> None:
    assert not should_download(_SCIENCE, "big.pdf", 50 * 1024 * 1024 + 1)


def test_local_folders_follow_the_psi_layout() -> None:
    assert local_subdir(_SCIENCE) == "documents"
    assert local_subdir(_TABLE) == "tables"
    assert local_subdir("/Home/psi-data/PSI-26/metadata/PSI-26_metadata.zip") == "overview"
