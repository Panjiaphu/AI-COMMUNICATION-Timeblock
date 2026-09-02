from __future__ import annotations

import base64
import hashlib
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import Settings


ENCRYPTION_VERSION = "aes-256-gcm-v1"


class GroupCryptoError(RuntimeError):
    pass


def _decode_configured_key(value: str) -> bytes | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    try:
        decoded = bytes.fromhex(normalized)
        if len(decoded) == 32:
            return decoded
    except ValueError:
        pass
    for candidate in (normalized, normalized + "=" * (-len(normalized) % 4)):
        try:
            decoded = base64.urlsafe_b64decode(candidate.encode("ascii"))
        except (ValueError, UnicodeEncodeError):
            continue
        if len(decoded) == 32:
            return decoded
    return None


class GroupCrypto:
    def __init__(self, settings: Settings):
        configured = _decode_configured_key(settings.group_message_encryption_key or "")
        if configured is None:
            if settings.is_production and settings.group_v3_enabled:
                raise GroupCryptoError("group_message_encryption_not_configured")
            configured = hashlib.sha256(
                f"group-v3-development:{settings.secret_key}".encode("utf-8")
            ).digest()
        self._aes = AESGCM(configured)

    def encrypt(self, payload: bytes, *, aad: str) -> tuple[bytes, bytes, str]:
        nonce = secrets.token_bytes(12)
        ciphertext = self._aes.encrypt(nonce, payload, aad.encode("utf-8"))
        return ciphertext, nonce, ENCRYPTION_VERSION

    def decrypt(
        self,
        ciphertext: bytes,
        nonce: bytes,
        *,
        aad: str,
        version: str,
    ) -> bytes:
        if version != ENCRYPTION_VERSION:
            raise GroupCryptoError("unsupported_group_encryption_version")
        try:
            return self._aes.decrypt(nonce, ciphertext, aad.encode("utf-8"))
        except Exception as exc:
            raise GroupCryptoError("group_decryption_failed") from exc

    def encrypt_text(self, value: str, *, aad: str) -> tuple[bytes, bytes, str]:
        return self.encrypt(value.encode("utf-8"), aad=aad)

    def decrypt_text(
        self,
        ciphertext: bytes,
        nonce: bytes,
        *,
        aad: str,
        version: str,
    ) -> str:
        try:
            return self.decrypt(
                ciphertext,
                nonce,
                aad=aad,
                version=version,
            ).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise GroupCryptoError("group_decryption_failed") from exc
