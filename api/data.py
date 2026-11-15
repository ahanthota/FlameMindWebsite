"""Science data held in memory for the life of the process."""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

DATA_FILES = (
    "chunks.json",
    "embeddings.npy",
    "embeddings_meta.json",
    "investigations.json",
    "habitats.json",
    "gaps.json",
    "insights.json",
)
ANSWER_CACHE_FILE = "answer_cache.json"
DERIVED_CACHE_FILE = "derived_cache.json"

log = logging.getLogger("flamemind.data")


@dataclass
class DataStore:
    chunks: list[dict]
    embeddings: np.ndarray  # float32, unit rows, row i = chunks[i]
    embed_model: str
    investigations: list[dict]
    habitats: list[dict]
    gaps: dict
    insights: list[dict]
    answer_cache: dict[str, dict] = field(default_factory=dict)
    # Derived filter values: {normalized parameter: {investigation_id: [verified values]}}
    derived_cache: dict[str, dict[str, list[dict]]] = field(default_factory=dict)
    derived_cache_path: Path | None = None

    def __post_init__(self) -> None:
        self._derived_lock = threading.Lock()
        if len(self.chunks) != len(self.embeddings):
            raise ValueError(
                f"chunks.json has {len(self.chunks)} rows but embeddings.npy has {len(self.embeddings)}"
            )
        self.by_id = {record["id"]: record for record in self.investigations}

    def derived(self, key: str) -> dict[str, list[dict]]:
        with self._derived_lock:
            return dict(self.derived_cache.get(key, {}))

    def add_derived(self, key: str, values: dict[str, list[dict]]) -> None:
        """Remember values in memory and write the whole cache to disk, if a path is set."""
        with self._derived_lock:
            self.derived_cache.setdefault(key, {}).update(values)
            if self.derived_cache_path is None:
                return
            temporary = self.derived_cache_path.with_suffix(".json.tmp")
            try:
                temporary.write_text(
                    json.dumps(self.derived_cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
                )
                os.replace(temporary, self.derived_cache_path)
            except OSError:
                log.warning("could not write %s; derived values stay in memory only", self.derived_cache_path)

    def acronym(self, investigation_id: str) -> str:
        record = self.by_id.get(investigation_id)
        return (record or {}).get("acronym") or investigation_id

    def habitat(self, value: str | None) -> dict | None:
        """Match a habitat preset by id or name, loosely ("moon base" -> moon_base)."""
        if not value:
            return None
        wanted = _key(value)
        for habitat in self.habitats:
            if wanted in (_key(habitat["id"]), _key(habitat["name"])):
                return habitat
        for habitat in self.habitats:
            if wanted and (wanted in _key(habitat["name"]) or _key(habitat["name"]) in wanted):
                return habitat
        return None


def _key(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


def load_data(data_dir: Path) -> DataStore:
    missing = [name for name in DATA_FILES if not (data_dir / name).is_file()]
    if missing:
        raise FileNotFoundError(f"Missing data files in {data_dir}: {', '.join(missing)}")

    def read(name: str):
        return json.loads((data_dir / name).read_text(encoding="utf-8"))

    meta = read("embeddings_meta.json")
    cache_path = data_dir / ANSWER_CACHE_FILE
    derived_path = data_dir / DERIVED_CACHE_FILE
    return DataStore(
        chunks=read("chunks.json"),
        embeddings=np.load(data_dir / "embeddings.npy").astype(np.float32),
        embed_model=meta.get("model", ""),
        investigations=read("investigations.json"),
        habitats=read("habitats.json"),
        gaps=read("gaps.json"),
        insights=read("insights.json"),
        answer_cache=json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.is_file() else {},
        derived_cache=json.loads(derived_path.read_text(encoding="utf-8")) if derived_path.is_file() else {},
        derived_cache_path=derived_path,
    )
