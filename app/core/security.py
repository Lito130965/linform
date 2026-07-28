"""Password and token primitives, stdlib only.

Passwords are slow-hashed (PBKDF2-HMAC-SHA256, OWASP-tier iteration count) so a
stolen database does not hand over the passwords. Session and API tokens are
already high-entropy random strings, so they are stored as a plain SHA-256
digest — no salt or slow KDF needed, and the lookup stays a single indexed
query. In both cases only a digest is ever persisted; the clear value exists
only in transit.
"""

import hashlib
import hmac
import secrets

# OWASP's 2023 floor for PBKDF2-HMAC-SHA256. High enough to sting an offline
# cracker, cheap enough that an interactive login stays well under a second.
_PBKDF2_ITERATIONS = 600_000
_SALT_BYTES = 16


def hash_password(password: str) -> str:
    """Return a self-describing `pbkdf2_sha256$iters$salt$hash` string."""
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of a clear password against a stored hash."""
    try:
        algo, iters, salt_hex, digest_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iters)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def generate_token() -> str:
    """A fresh opaque secret for a session or API key (~256 bits)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256 digest a high-entropy token is stored and looked up by."""
    return hashlib.sha256(token.encode()).hexdigest()
