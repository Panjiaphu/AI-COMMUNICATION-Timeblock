"""Provider-neutral Group Audio readiness contract.

Timeblock remains the authorization/data authority. AI-COMMUNICATION may
parse this manifest before a future provider-backed media session, but this
module deliberately does not import an SFU SDK or acquire browser media.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


GROUP_CALL_MEDIA_PROVIDER_REQUIRED = "GROUP_CALL_MEDIA_PROVIDER_REQUIRED"
GROUP_CALL_MEDIA_PROVIDER_CONTRACT_VERSION = "1"
SUPPORTED_MEDIA_MODES = frozenset({"audio", "video"})
REQUIRED_TOKEN_TRANSPORT = "server_memory_only"
REQUIRED_AUTHORIZATION = "timeblock_membership"
_STATES = frozenset({"gated", "ready"})


class GroupMediaProviderContractError(ValueError):
    """Raised when the Timeblock provider manifest is unsafe or incomplete."""


@dataclass(frozen=True, slots=True)
class GroupMediaProviderContract:
    contract_version: str
    state: str
    provider: str
    error_code: str | None
    media_modes: tuple[str, ...]
    token_transport: str
    authorization: str

    @property
    def ready(self) -> bool:
        return self.state == "ready" and self.error_code is None


def _text(payload: Mapping[str, object], key: str, *, maximum: int = 128) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise GroupMediaProviderContractError(f"missing_{key}")
    value = value.strip()
    if not value or len(value) > maximum:
        raise GroupMediaProviderContractError(f"invalid_{key}")
    return value


def parse_group_media_provider_contract(
    payload: Mapping[str, object],
) -> GroupMediaProviderContract:
    """Validate a capability manifest without trusting provider identifiers."""

    if not isinstance(payload, Mapping):
        raise GroupMediaProviderContractError("invalid_media_provider_contract")
    version = _text(payload, "contract_version")
    if version != GROUP_CALL_MEDIA_PROVIDER_CONTRACT_VERSION:
        raise GroupMediaProviderContractError("media_provider_contract_mismatch")
    state = _text(payload, "state")
    if state not in _STATES:
        raise GroupMediaProviderContractError("invalid_media_provider_state")
    provider = _text(payload, "provider")
    token_transport = _text(payload, "token_transport")
    if token_transport != REQUIRED_TOKEN_TRANSPORT:
        raise GroupMediaProviderContractError("invalid_media_provider_token_transport")
    authorization = _text(payload, "authorization")
    if authorization != REQUIRED_AUTHORIZATION:
        raise GroupMediaProviderContractError("invalid_media_provider_authorization")
    modes = payload.get("media_modes")
    if not isinstance(modes, (list, tuple)) or not modes:
        raise GroupMediaProviderContractError("invalid_media_provider_modes")
    normalized_modes = tuple(str(item) for item in modes)
    if (
        len(set(normalized_modes)) != len(normalized_modes)
        or any(item not in SUPPORTED_MEDIA_MODES for item in normalized_modes)
    ):
        raise GroupMediaProviderContractError("invalid_media_provider_modes")
    error_code = payload.get("error_code")
    if error_code is not None and (
        not isinstance(error_code, str) or not error_code.strip()
    ):
        raise GroupMediaProviderContractError("invalid_media_provider_error_code")
    if state == "gated" and error_code != GROUP_CALL_MEDIA_PROVIDER_REQUIRED:
        raise GroupMediaProviderContractError("gated_media_provider_error_code_required")
    if state == "ready" and error_code is not None:
        raise GroupMediaProviderContractError("ready_media_provider_has_error")
    return GroupMediaProviderContract(
        contract_version=version,
        state=state,
        provider=provider,
        error_code=error_code,
        media_modes=normalized_modes,
        token_transport=token_transport,
        authorization=authorization,
    )


def require_ready_group_media_provider(
    payload: Mapping[str, object],
) -> GroupMediaProviderContract:
    """Fail closed until an owner-approved provider is advertised as ready."""

    contract = parse_group_media_provider_contract(payload)
    if not contract.ready:
        raise GroupMediaProviderContractError(
            contract.error_code or GROUP_CALL_MEDIA_PROVIDER_REQUIRED
        )
    return contract
