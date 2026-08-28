from __future__ import annotations

import pytest

from app.handoff.group_media import (
    GROUP_CALL_MEDIA_PROVIDER_REQUIRED,
    GroupMediaProviderContractError,
    parse_group_media_provider_contract,
    require_ready_group_media_provider,
)


def _manifest(**overrides):
    payload = {
        "contract_version": "1",
        "state": "gated",
        "provider": "unconfigured",
        "error_code": GROUP_CALL_MEDIA_PROVIDER_REQUIRED,
        "media_modes": ["audio", "video"],
        "token_transport": "server_memory_only",
        "authorization": "timeblock_membership",
    }
    payload.update(overrides)
    return payload


def test_gated_manifest_is_parseable_but_not_ready():
    contract = parse_group_media_provider_contract(_manifest())
    assert contract.provider == "unconfigured"
    assert contract.media_modes == ("audio", "video")
    assert not contract.ready
    with pytest.raises(GroupMediaProviderContractError, match=GROUP_CALL_MEDIA_PROVIDER_REQUIRED):
        require_ready_group_media_provider(_manifest())


def test_ready_manifest_requires_no_error_and_preserves_transport_boundary():
    contract = require_ready_group_media_provider(
        _manifest(state="ready", provider="approved-sfu", error_code=None)
    )
    assert contract.ready
    assert contract.token_transport == "server_memory_only"
    assert contract.authorization == "timeblock_membership"


@pytest.mark.parametrize(
    "overrides,error",
    [
        ({"contract_version": "2"}, "contract_mismatch"),
        ({"state": "gated", "error_code": None}, "gated_media_provider_error_code_required"),
        ({"state": "ready", "error_code": "provider_down"}, "ready_media_provider_has_error"),
        ({"media_modes": ["audio", "audio"]}, "invalid_media_provider_modes"),
        ({"token_transport": "url"}, "invalid_media_provider_token_transport"),
        ({"authorization": "client_role"}, "invalid_media_provider_authorization"),
    ],
)
def test_manifest_rejects_unsafe_or_ambiguous_values(overrides, error):
    with pytest.raises(GroupMediaProviderContractError, match=error):
        parse_group_media_provider_contract(_manifest(**overrides))
