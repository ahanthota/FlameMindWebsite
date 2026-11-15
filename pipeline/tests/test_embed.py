import json

import numpy as np
import pytest

from embed import (
    build_chunks,
    chunk_document,
    embed_chunks,
    estimate_tokens,
    load_previous,
    normalize,
    summary_chunks,
    text_hash,
    write_outputs,
)
from search import page_label, top_k


def doc(pages, investigation_id="PSI-1"):
    return {
        "investigation_id": investigation_id,
        "file_name": "documents/Report One.pdf",
        "title": "Report One",
        "url": "https://psi.example/PSI-1",
        "doi": "10.1/x",
        "pages": [{"page": number, "text": text} for number, text in pages],
    }


def words(prefix, count):
    """Distinct words that each estimate to one token."""
    return " ".join(prefix + chr(97 + index // 26) + chr(97 + index % 26) for index in range(count))


def test_short_document_is_one_chunk_with_metadata():
    chunks = chunk_document(doc([(1, "Flame spread  over\nfabric.")]))
    assert len(chunks) == 1
    chunk = chunks[0]
    assert chunk["chunk_id"] == "PSI-1:report_one:0"
    assert chunk["text"] == "Flame spread  over\nfabric."
    assert (chunk["page_start"], chunk["page_end"]) == (1, 1)
    assert chunk["doi"] == "10.1/x"


def test_windows_overlap_and_cover_everything():
    chunks = chunk_document(doc([(1, words("w", 25))]), chunk_tokens=12, overlap_tokens=4)
    tokens = [chunk["text"].split() for chunk in chunks]
    assert [len(item) for item in tokens] == [12, 12, 9]
    assert tokens[0][-4:] == tokens[1][:4]
    assert tokens[-1][-1] == "way"


def test_chunk_spanning_pages_records_both_and_keeps_page_text_apart():
    chunks = chunk_document(doc([(1, words("a", 5)), (2, words("b", 5))]), chunk_tokens=40)
    assert len(chunks) == 1
    assert (chunks[0]["page_start"], chunks[0]["page_end"]) == (1, 2)
    assert chunks[0]["text"] == words("a", 5) + "\n\n" + words("b", 5)


def test_empty_pages_make_no_chunks():
    assert chunk_document(doc([(1, "   ")])) == []


RECORD = {
    "id": "PSI-26",
    "name": "Burning and Suppression of Solids",
    "acronym": "BASS",
    "psi_url": "https://psi.example/PSI-26",
    "gravity": "microgravity",
    "objectives": ["Study flames over fabric."],
    "o2_percent_min": 21.0,
    "o2_percent_max": 21.0,
    "flow_cm_s_min": 0.0,
    "flow_cm_s_max": 44.0,
    "fuels": ["cotton-fiberglass"],
    "key_findings": [{"text": "Flames spread fastest at moderate flow.", "evidence": []}],
    "tests": [{}, {}],
}


def test_summary_chunk_holds_objectives_conditions_and_findings():
    chunks = summary_chunks(RECORD)
    assert len(chunks) == 1
    chunk = chunks[0]
    assert chunk["chunk_id"] == "PSI-26:summary"
    assert chunk["page_start"] is None and chunk["file_name"] == "investigations.json"
    assert "Study flames over fabric." in chunk["text"]
    assert "Oxygen 21%" in chunk["text"]
    assert "Flow 0 to 44 cm/s" in chunk["text"]
    assert "Flames spread fastest at moderate flow." in chunk["text"]
    assert "Tests recorded: 2." in chunk["text"]


def test_long_summary_stays_one_chunk_and_trims_findings():
    record = {**RECORD, "key_findings": [{"text": words("f", 50)} for _ in range(30)]}
    chunks = summary_chunks(record, max_tokens=300)
    assert len(chunks) == 1
    text = chunks[0]["text"]
    assert estimate_tokens(text) <= 300 + 20
    assert "Study flames over fabric." in text and "Oxygen 21%" in text
    assert "more finding(s) are listed in investigations.json" in text


def test_build_chunks_reads_processed_and_adds_hashes(tmp_path):
    folder = tmp_path / "processed" / "PSI-1"
    folder.mkdir(parents=True)
    (folder / "report.json").write_text(json.dumps(doc([(1, "text one")])))
    investigations = tmp_path / "investigations.json"
    investigations.write_text(json.dumps([RECORD]))
    chunks = build_chunks(tmp_path / "processed", investigations)
    assert [chunk["chunk_id"] for chunk in chunks] == ["PSI-1:report_one:0", "PSI-26:summary"]
    assert chunks[0]["text_hash"] == text_hash("text one")


class FakeEmbed:
    def __init__(self):
        self.calls = []

    def __call__(self, texts):
        self.calls.append(list(texts))
        return np.asarray([[len(text), 1.0, 0.0] for text in texts], dtype=np.float32)


def chunk(text):
    return {"text": text, "text_hash": text_hash(text)}


def test_embed_batches_and_normalizes():
    embed = FakeEmbed()
    matrix, embedded = embed_chunks([chunk("a"), chunk("bb"), chunk("ccc")], embed, {}, batch_size=2)
    assert embedded == 3
    assert [len(call) for call in embed.calls] == [2, 1]
    assert matrix.dtype == np.float32
    assert np.allclose(np.linalg.norm(matrix, axis=1), 1.0)


def test_unchanged_text_reuses_previous_vector():
    embed = FakeEmbed()
    previous = {text_hash("a"): np.asarray([0.0, 0.0, 1.0], dtype=np.float32)}
    matrix, embedded = embed_chunks([chunk("a"), chunk("new")], embed, previous)
    assert embedded == 1
    assert embed.calls == [["new"]]
    assert np.allclose(matrix[0], [0.0, 0.0, 1.0])


def test_previous_vectors_are_dropped_when_the_model_changes(tmp_path):
    paths = (tmp_path / "chunks.json", tmp_path / "embeddings.npy", tmp_path / "meta.json")
    matrix = normalize(np.asarray([[1.0, 2.0]], dtype=np.float32))
    meta = write_outputs([chunk("a")], matrix, "model-a", *paths)
    assert meta["dimension"] == 2 and meta["count"] == 1 and meta["model"] == "model-a"
    assert np.load(paths[1]).dtype == np.float32
    assert set(load_previous(*paths, "model-a")) == {text_hash("a")}
    assert load_previous(*paths, "model-b") == {}


def test_normalize_leaves_zero_vectors_alone():
    result = normalize(np.asarray([[3.0, 4.0], [0.0, 0.0]]))
    assert np.allclose(result, [[0.6, 0.8], [0.0, 0.0]])


def test_top_k_ranks_by_cosine():
    matrix = normalize(np.asarray([[1, 0], [0, 1], [1, 1]], dtype=np.float32))
    results = top_k(matrix, np.asarray([2.0, 0.1]), k=2)
    assert [index for index, _ in results] == [0, 2]
    assert results[0][1] == pytest.approx(0.9988, abs=1e-3)
    assert top_k(matrix, np.asarray([1.0, 0.0]), k=10)[-1][0] == 1


def test_page_label():
    assert page_label({"page_start": 3, "page_end": 3}) == "p.3"
    assert page_label({"page_start": 3, "page_end": 4}) == "pp.3-4"
    assert page_label({"page_start": None, "page_end": None}) == "structured record"


def test_token_estimate_counts_digits_and_punctuation_one_by_one():
    assert estimate_tokens("flame") == 1
    assert estimate_tokens("microgravity") == 2
    assert estimate_tokens("21.5%") == 5
    assert estimate_tokens("Contents" + "." * 10) == 12


def test_number_tables_and_dot_leaders_make_smaller_chunks():
    text = " ".join(["Contents" + "." * 30] * 20)
    chunks = chunk_document(doc([(1, text)]), chunk_tokens=100, overlap_tokens=10)
    assert len(chunks) == 7
    assert all(estimate_tokens(chunk["text"]) <= 100 for chunk in chunks)
    assert chunks[-1]["text"].endswith("." * 30)
