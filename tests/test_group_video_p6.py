import pytest

from app.group_video import (
    GroupVideoSession,
    GroupVideoSessionError,
    GroupVideoState,
    acquire_group_video_media,
    apply_group_video_state,
    can_acquire_group_video_media,
    group_video_request_key,
    release_group_video_media,
)


def _session(**changes):
    values = {
        "session_id": "video-session-1",
        "application_room_id": "group-call:room-1",
        "participant_id": "member:alice",
        "generation": "join-1",
    }
    values.update(changes)
    return GroupVideoSession(**values)


def test_media_is_blocked_until_joining_and_join_requires_media():
    session = _session()
    assert not can_acquire_group_video_media(GroupVideoState.INVITED)
    session = apply_group_video_state(session, GroupVideoState.RINGING)
    with pytest.raises(GroupVideoSessionError, match="media_forbidden_in_state"):
        acquire_group_video_media(session)
    session = apply_group_video_state(session, GroupVideoState.JOINING)
    session = acquire_group_video_media(session)
    session = apply_group_video_state(session, GroupVideoState.JOINED)
    assert session.state is GroupVideoState.JOINED
    assert session.media_acquired is True


def test_failure_and_leave_clear_media_for_idempotent_cleanup():
    session = acquire_group_video_media(
        apply_group_video_state(
            apply_group_video_state(_session(), GroupVideoState.RINGING),
            GroupVideoState.JOINING,
        )
    )
    session = apply_group_video_state(session, GroupVideoState.JOIN_FAILED)
    assert session.media_acquired is False
    session = apply_group_video_state(session, GroupVideoState.JOINING)
    session = acquire_group_video_media(session)
    session = apply_group_video_state(session, GroupVideoState.JOINED)
    session = apply_group_video_state(session, GroupVideoState.LEAVING)
    assert session.media_acquired is False
    session = apply_group_video_state(session, GroupVideoState.ENDED)
    assert release_group_video_media(session) == session


def test_reconnect_preserves_media_and_release_is_idempotent():
    session = acquire_group_video_media(
        apply_group_video_state(
            apply_group_video_state(_session(), "ringing"), "joining"
        )
    )
    session = apply_group_video_state(session, "joined")
    session = apply_group_video_state(session, "reconnecting")
    assert session.media_acquired is True
    session = release_group_video_media(session)
    assert session.media_acquired is False
    assert release_group_video_media(session) is session


@pytest.mark.parametrize(
    ("current", "target", "error"),
    [
        (GroupVideoState.ENDED, GroupVideoState.JOINING, "invalid_transition"),
        (GroupVideoState.RINGING, GroupVideoState.JOINED, "invalid_transition"),
        (GroupVideoState.JOINING, GroupVideoState.JOINED, "media_required_before_joined"),
    ],
)
def test_invalid_transition_is_rejected(current, target, error):
    session = _session(state=current)
    with pytest.raises(GroupVideoSessionError, match=error):
        apply_group_video_state(session, target)


def test_request_key_is_scoped_to_application_identity():
    assert group_video_request_key(
        "group-call:room-1", "member:alice", "join-1"
    ) == "group-video:group-call:room-1:member:alice:join-1"
    with pytest.raises(GroupVideoSessionError, match="invalid_application_room_id"):
        _session(application_room_id="provider-room-1")
