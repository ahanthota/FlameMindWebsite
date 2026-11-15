from insights import validate_insights

SOURCE = {"file_name": "doc.pdf", "title": "Doc", "url": "https://psi.example/1", "doi": None, "page": 3}
RECORDS = [
    {
        "id": "PSI-1",
        "sources": [{"file_name": "paper.pdf", "doi": "10.1/ABC", "page": 1}],
        "key_findings": [{"text": "A finding.", "evidence": [SOURCE]}],
        "tests": [],
    }
]
HABITATS = {"iss", "moon_base"}


def insight(**overrides):
    item = {
        "id": "low-flow",
        "title": "Low flow",
        "text": "A sourced statement.",
        "category": "suppression",
        "habitats": ["iss"],
        "investigation_ids": ["PSI-1"],
        "sources": [SOURCE],
    }
    item.update(overrides)
    return item


def test_valid_insight_passes():
    errors, warnings = validate_insights([insight()], RECORDS, HABITATS)
    assert errors == [] and warnings == []


def test_doi_match_ignores_case():
    errors, _ = validate_insights([insight(sources=[{"doi": "10.1/abc"}])], RECORDS, HABITATS)
    assert errors == []


def test_insight_needs_a_source():
    errors, _ = validate_insights([insight(sources=[])], RECORDS, HABITATS)
    assert any("sources" in error for error in errors)


def test_source_must_be_cited_by_the_named_investigation():
    errors, _ = validate_insights([insight(sources=[{**SOURCE, "page": 4}])], RECORDS, HABITATS)
    assert any("not cited by PSI-1" in error for error in errors)


def test_unknown_investigation_habitat_and_category_are_errors():
    errors, _ = validate_insights(
        [insight(investigation_ids=["PSI-9"], habitats=["venus"], category="hope")],
        RECORDS,
        HABITATS,
    )
    assert any("category" in error for error in errors)
    errors, _ = validate_insights([insight(investigation_ids=["PSI-9"], habitats=["venus"])], RECORDS, HABITATS)
    assert any("PSI-9 is not in investigations.json" in error for error in errors)
    assert any("unknown habitat 'venus'" in error for error in errors)


def test_duplicate_ids_and_template_examples_are_reported():
    errors, warnings = validate_insights([insight(), insight()], RECORDS, HABITATS)
    assert any("duplicate id" in error for error in errors)
    _, warnings = validate_insights([insight(id="example-one")], RECORDS, HABITATS)
    assert warnings and "template" in warnings[0]
