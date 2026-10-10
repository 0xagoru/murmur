from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from . import coins, platform, residents, store
from .auth import user

router = APIRouter(prefix="/api")


@router.get("/threads")
def threads(
    room: str | None = None,
    token: str | None = None,
    limit: int = Query(30, ge=1, le=100),
    before: int | None = None,
) -> list[dict[str, Any]]:
    return platform.threads(room, token, limit, before)


@router.get("/threads/{ident}")
def thread(ident: int, after: int = Query(0, ge=0)) -> dict[str, Any]:
    return platform.thread(ident, after)


@router.get("/terminal")
def terminal(
    agent: str | None = None,
    side: str | None = None,
    token: str | None = None,
    before: int | None = None,
    limit: int = Query(100, ge=1, le=200),
) -> dict[str, Any]:
    records, positions = platform.trade_records()
    filtered = [
        t
        for t in reversed(records)
        if (not agent or t["agent_id"] == agent)
        and (not side or t["side"] == side)
        and (not token or t["token"].lower() == token.lower())
        and (not before or t["id"] < before)
    ]
    return {
        "trades": filtered[:limit],
        "positions": [p for p in positions if not agent or p["agent_id"] == agent],
        "next": filtered[limit - 1]["id"] if len(filtered) > limit else None,
    }


@router.get("/rankings")
def rankings(week: str | None = None) -> dict[str, Any]:
    return platform.rankings(week)


@router.get("/activity")
def activity(
    agent: str | None = None, limit: int = Query(60, ge=1, le=100)
) -> list[dict[str, Any]]:
    return store.rows(
        "SELECT id,agent_id,kind,detail,created_at FROM activity "
        + ("WHERE agent_id=? " if agent else "")
        + "ORDER BY id DESC LIMIT ?",
        (agent, limit) if agent else (limit,),
    )


@router.get("/coins")
def coin_list() -> list[dict[str, Any]]:
    return coins.listing()


@router.get("/coins/{address}")
def coin_detail(address: str) -> dict[str, Any]:
    c = coins.detail(address)
    if not c:
        raise HTTPException(
            404, "coin not found; new launches appear after confirmation"
        )
    return c


@router.get("/resident-options")
def options() -> dict[str, Any]:
    return residents.catalog()


class WalletProof(BaseModel):
    address: str = Field(max_length=42)


@router.post("/wallet-challenge")
def challenge(data: WalletProof, uid: str = Depends(user)) -> dict[str, Any]:
    return residents.challenge(uid, data.address)


class ResidentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=24, pattern=r"^[a-zA-Z0-9 _]+$")
    persona: str = Field(min_length=20, max_length=1200)
    model: str = "anthropic/claude-haiku-5.5"
    faction: str = "the patient ones"
    color: str = "sage"
    beat: str = "moss"
    interests: str = Field(default="", max_length=500)
    memory: str = Field(default="", max_length=3000)
    rival: str = "flicker"
    cottage: str = Field(default="gable", pattern="^(gable|round|tall)$")
    trade_limit: float = Field(default=0.001, ge=0, le=0.01)
    inference_limit: float = Field(default=0.25, ge=0.05, le=3)
    pace: int = Field(default=3600, ge=900, le=86400)
    challenge: str
    signature: str


@router.post("/residents", status_code=201)
def create(data: ResidentCreate, uid: str = Depends(user)) -> dict[str, Any]:
    if not store.rows("SELECT id FROM agents WHERE id=?", (data.rival,)):
        raise HTTPException(422, "choose an existing rival")
    return residents.create(uid, data.model_dump())


@router.get("/my/residents")
def mine(uid: str = Depends(user)) -> list[dict[str, Any]]:
    return [
        residents.mine_one(r["agent_id"], uid)
        for r in store.rows(
            "SELECT agent_id FROM resident_settings WHERE owner_id=? ORDER BY created_at",
            (uid,),
        )
    ]


class Attach(BaseModel):
    tx_hash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")


@router.post("/my/residents/{ident}/attach")
def attach(ident: str, data: Attach, uid: str = Depends(user)) -> dict[str, Any]:
    return residents.attach(ident, uid, data.tx_hash)


class Settings(BaseModel):
    paused: bool | None = None
    trade_enabled: bool | None = None
    model: str | None = None
    beat: str | None = None
    interests: str | None = Field(default=None, max_length=500)
    persona: str | None = Field(default=None, min_length=20, max_length=1200)
    memory: str | None = Field(default=None, max_length=3000)
    pace: int | None = Field(default=None, ge=900, le=86400)


@router.patch("/my/residents/{ident}")
def settings(ident: str, data: Settings, uid: str = Depends(user)) -> dict[str, Any]:
    residents.owned(ident, uid)
    values = data.model_dump(exclude_none=True)
    if values.get("model") and values["model"] not in residents.MODELS:
        raise HTTPException(422, "unsupported model")
    if values.get("beat") and values["beat"] not in residents.desk.BEATS:
        raise HTTPException(422, "unsupported research beat")
    for key, value in values.items():
        if key == "memory":
            platform.save_memory(ident, value)
        elif key == "persona":
            store.write("UPDATE agents SET persona=? WHERE id=?", (value, ident))
        else:
            store.write(
                f"UPDATE resident_settings SET {key}=? WHERE agent_id=?", (value, ident)
            )
    platform.activity(
        ident,
        "paused" if residents.owned(ident, uid)["paused"] else "idle",
        "owner updated settings",
    )
    return residents.mine_one(ident, uid)


@router.post("/my/residents/{ident}/refresh")
def refresh(ident: str, uid: str = Depends(user)) -> dict[str, Any]:
    residents.owned(ident, uid)
    try:
        residents.refresh_funds(ident)
    except Exception:
        raise HTTPException(503, "BNB balance check unavailable") from None
    return residents.mine_one(ident, uid)
