"""Offline Cryptographic Security Subsystem (NIST SP 800-63B).

Provides:
- hash_password: NIST SP 800-63B memory-hard password hashing via hashlib.scrypt with random 16-byte salt
- verify_password: Constant-time scrypt password verification with secrets.compare_digest
- create_access_token: Offline HS256 JWT token minting
- decode_access_token: Offline HS256 JWT token verification and decoding
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt

from app.config import get_settings

# Scrypt parameters meeting NIST SP 800-63B recommendations:
# N=16384 (CPU/memory cost), r=8 (block size), p=1 (parallelization)
SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16


def hash_password(password: str) -> str:
    """Hash password using scrypt with a random 16-byte salt.
    Format: {salt_hex}${hash_hex}
    """
    salt = secrets.token_bytes(SALT_BYTES)
    hash_bytes = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        maxmem=0,
    )
    return f"{salt.hex()}${hash_bytes.hex()}"


def verify_password(password: str, hashed: str) -> bool:
    """Verify password against scrypt hash in constant time.
    Gracefully handles exceptions and malformed hashes by returning False.
    """
    try:
        if not hashed or "$" not in hashed:
            return False
        parts = hashed.split("$")
        if len(parts) != 2:
            return False
        salt_hex, expected_hash_hex = parts
        salt = bytes.fromhex(salt_hex)
        expected_hash = bytes.fromhex(expected_hash_hex)
        candidate_hash = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=SCRYPT_N,
            r=SCRYPT_R,
            p=SCRYPT_P,
            maxmem=0,
        )
        return secrets.compare_digest(candidate_hash, expected_hash)
    except Exception:
        return False


def create_access_token(data: dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Mint an offline HS256 JWT access token.
    Payload includes sub, email, org_id, role, exp.
    """
    settings = get_settings()
    to_encode = dict(data)
    if expires_delta is not None:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)

    to_encode["exp"] = expire
    if "aud" not in to_encode:
        to_encode["aud"] = "authenticated"
    if "iss" not in to_encode:
        to_encode["iss"] = "dhrishyam-offline"

    token = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return token


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    """Decode and verify an offline HS256 JWT access token.
    Returns decoded payload or None if invalid or expired.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.algorithm],
            options={"verify_aud": False},
        )
        return payload
    except jwt.PyJWTError:
        return None
