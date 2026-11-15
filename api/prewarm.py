"""Answer the demo questions once and store the results for the API to serve.

    python prewarm.py                 # reads docs/demo_questions.txt
    python prewarm.py --only-missing  # keep answers already cached

Writes data/answer_cache.json, keyed by normalized question + use case (none:
the demo questions are asked as a new guest chat). The API loads the file at
startup, so re-run this and rebuild the image after the data or prompts change.
Insufficient-evidence replies are not cached.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ai.llm import VertexLLM
from chat import cache_key, run_turn
from config import REPO_ROOT, load_settings
from data import ANSWER_CACHE_FILE, load_data

DEFAULT_QUESTIONS = REPO_ROOT / "docs" / "demo_questions.txt"


def read_questions(path: Path) -> list[str]:
    lines = (line.strip() for line in path.read_text(encoding="utf-8").splitlines())
    return [line for line in lines if line and not line.startswith("#")]


def main() -> None:
    parser = argparse.ArgumentParser(description="Pre-warm the demo answer cache.")
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    parser.add_argument("--only-missing", action="store_true")
    args = parser.parse_args()

    settings = load_settings()
    data = load_data(settings.data_dir)
    previous = data.answer_cache if args.only_missing else {}
    data.answer_cache = {}  # never answer from the old cache while rebuilding it
    llm = VertexLLM(settings.gcp_project, settings.gcp_region, settings.gemini_model, settings.embed_model)

    cache: dict[str, dict] = {}
    for question in read_questions(args.questions):
        key = cache_key(question, None)
        if key in previous:
            cache[key] = previous[key]
            print(f"kept     {question}")
            continue
        turn = run_turn(llm, data, question, [], None)
        if turn.message["insufficient_evidence"]:
            print(f"SKIPPED  {question}  (insufficient evidence)")
            continue
        cache[key] = {
            "question": question,
            "message": turn.message,
            "use_case": turn.use_case,
            "use_case_complete": turn.use_case_complete,
        }
        answer = turn.message["answer"]
        print(
            f"cached   {question}  ({len(answer['relevant_data'])} data, "
            f"{len(answer['suggestions'])} suggestions, {answer['confidence']})"
        )

    out = settings.data_dir / ANSWER_CACHE_FILE
    out.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(cache)} answer(s) to {out}")


if __name__ == "__main__":
    main()
