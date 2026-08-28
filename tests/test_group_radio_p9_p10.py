import pytest

from app.group_radio.lifecycle import RadioResourceLedger, RadioRoomCapacity
from app.group_radio.retrieval import normalize_history_query


def test_radio_history_query_is_bounded_and_normalized():
    query = normalize_history_query(
        "a" * 32,
        query=" hello ",
        target_language="en",
        state="final",
        limit="150",
        before_id="9",
    )
    assert query.query == "hello"
    assert query.limit == 100
    assert query.before_id == 9
    with pytest.raises(ValueError, match="invalid_history_query"):
        normalize_history_query("a" * 32, query="x" * 201)


def test_radio_resource_ledger_reaches_resource_zero_and_rejects_late_work():
    ledger = RadioResourceLedger("generation-1")
    assert ledger.register("mic", "track-1") is True
    assert ledger.register("tts", "audio-1") is True
    terminated = ledger.terminate()
    assert terminated["resource_zero"] is True
    assert terminated["terminated"] is True
    assert ledger.register("mic", "late-track") is False
    assert ledger.terminate()["resource_zero"] is True


def test_radio_room_capacity_is_idempotent_and_bounded():
    capacity = RadioRoomCapacity(max_rooms=2)
    capacity.acquire("one")
    capacity.acquire("one")
    capacity.acquire("two")
    with pytest.raises(ValueError, match="radio_room_capacity_exceeded"):
        capacity.acquire("three")
    capacity.release("one")
    capacity.acquire("three")
    assert capacity.snapshot()["active_rooms"] == 2
