import asyncio
import jwt
from fastapi import Header, HTTPException
from .config import PRIVY_ID

_client: jwt.PyJWKClient | None = None


async def user(authorization: str = Header(default="")) -> str:
    global _client
    if not authorization.startswith("Bearer ") or not PRIVY_ID:
        raise HTTPException(401, "sign in to join the conversation")
    token = authorization[7:]
    if len(token) > 8192:
        raise HTTPException(401, "invalid session")
    if _client is None:
        _client = jwt.PyJWKClient(
            f"https://auth.privy.io/api/v1/apps/{PRIVY_ID}/jwks.json"
        )
    try:
        key = await asyncio.to_thread(_client.get_signing_key_from_jwt, token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["ES256"],
            audience=PRIVY_ID,
            issuer="privy.io",
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
        return str(claims["sub"])
    except Exception:
        raise HTTPException(401, "session expired; please sign in again") from None
