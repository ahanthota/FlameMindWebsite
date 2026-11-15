"""Firebase ID token verification. Sign-in is optional; a bad token is an error, not a guest."""

from __future__ import annotations

from typing import Protocol


class AuthError(Exception):
    """The bearer token is missing its value, expired, or not ours."""


class Verifier(Protocol):
    def verify(self, token: str) -> str:
        """Return the uid, or raise AuthError."""


def firebase_app(project: str):
    import firebase_admin

    try:
        return firebase_admin.get_app()
    except ValueError:
        return firebase_admin.initialize_app(options={"projectId": project} if project else None)


class FirebaseVerifier:
    def __init__(self, project: str) -> None:
        self._project = project

    def verify(self, token: str) -> str:
        from firebase_admin import auth

        try:
            decoded = auth.verify_id_token(token, app=firebase_app(self._project))
        except Exception as exc:  # firebase raises several unrelated types
            raise AuthError("Invalid or expired sign-in token.") from exc
        return decoded["uid"]


def bearer_token(header: str | None) -> str | None:
    """None when there is no Authorization header. AuthError when it is malformed."""
    if not header or not header.strip():
        return None
    scheme, _, token = header.strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthError("Authorization header must be 'Bearer <Firebase ID token>'.")
    return token.strip()
