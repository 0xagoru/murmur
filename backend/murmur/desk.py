"""Live research inputs. Each resident studies one beat with public, keyless data sources."""

import time
from typing import Any, Callable
import httpx
from .store import rows, write, now

UA = {"User-Agent": "murmur-research/1.0 (+https://murmuragents.io)"}


def _get(url: str, timeout: float = 25) -> Any:
    r = httpx.get(url, headers=UA, timeout=timeout, follow_redirects=True)
    r.raise_for_status()
    return r.json()


def _num(v: Any, digits: int = 2) -> float | None:
    try:
        return round(float(v), digits)
    except (TypeError, ValueError):
        return None


def _usd(v: Any) -> str | None:
    n = _num(v, 0)
    if n is None:
        return None
    for unit, size in (("t", 1e12), ("b", 1e9), ("m", 1e6), ("k", 1e3)):
        if abs(n) >= size:
            return f"${n / size:.2f}{unit}"
    return f"${n:.0f}"


def remember(key: str, value: float | None) -> dict[str, float | None]:
    """Store a reading and return how it compares with the town's earlier readings."""
    if value is None:
        return {}
    past = {}
    for label, seconds in (("vs_6h", 6 * 3600), ("vs_1d", 86400), ("vs_7d", 7 * 86400)):
        cutoff = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - seconds))
        old = rows(
            "SELECT value FROM metrics WHERE key=? AND created_at<=? ORDER BY id DESC LIMIT 1",
            (key, cutoff),
        )
        if old and old[0]["value"]:
            past[label + "_pct"] = round((value - old[0]["value"]) / old[0]["value"] * 100, 2)
    write("INSERT INTO metrics(key,value,created_at) VALUES(?,?,?)", (key, value, now()))
    return past


def _cursor(name: str, size: int) -> int:
    saved = rows("SELECT value FROM meta WHERE key=?", ("cursor_" + name,))
    i = int(saved[0]["value"]) if saved else 0
    write("INSERT OR REPLACE INTO meta VALUES(?,?)", ("cursor_" + name, str(i + 1)))
    return i % max(size, 1)


def _pool(p: dict[str, Any]) -> dict[str, Any]:
    a = p["attributes"]
    tx = a.get("transactions", {}).get("h24", {})
    base = p.get("relationships", {}).get("base_token", {}).get("data", {}).get("id", "")
    return {
        "pool": a.get("name"),
        "token": base.removeprefix("bsc_"),
        "price_usd": _num(a.get("base_token_price_usd"), 8),
        "change_1h_pct": _num(a.get("price_change_percentage", {}).get("h1")),
        "change_24h_pct": _num(a.get("price_change_percentage", {}).get("h24")),
        "volume_24h": _usd(a.get("volume_usd", {}).get("h24")),
        "liquidity": _usd(a.get("reserve_in_usd")),
        "volume_to_liquidity": _num(
            float(a.get("volume_usd", {}).get("h24") or 0) / max(float(a.get("reserve_in_usd") or 0), 1)
        ),
        "buys_24h": tx.get("buys"),
        "sells_24h": tx.get("sells"),
        "buyers_24h": tx.get("buyers"),
        "sellers_24h": tx.get("sellers"),
        "created": a.get("pool_created_at"),
        "url": "https://www.geckoterminal.com/bsc/pools/" + a.get("address", ""),
    }


def fees() -> dict[str, Any]:
    data = _get(
        "https://api.llama.fi/overview/fees/bsc?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true",
        60,
    )
    ranked = sorted(
        (p for p in data.get("protocols", []) if p.get("total24h")),
        key=lambda p: -float(p["total24h"]),
    )[:15]
    focus = ranked[_cursor("fees", len(ranked))]
    summary = lambda p: {
        "protocol": p.get("displayName") or p.get("name"),
        "category": p.get("category"),
        "fees_24h": _usd(p.get("total24h")),
        "fees_7d": _usd(p.get("total7d")),
        "fees_30d": _usd(p.get("total30d")),
        "change_1d_pct": _num(p.get("change_1d")),
        "change_7d_pct": _num(p.get("change_7d")),
        "change_1m_pct": _num(p.get("change_1m")),
    }
    total = _num(data.get("total24h"), 0)
    return {
        "topic": "fees · " + (focus.get("displayName") or focus.get("name")),
        "subject": focus.get("slug") or focus.get("name"),
        "facts": {
            "chain_fees_24h": _usd(total),
            "chain_fees_24h_vs_earlier": remember("bsc_fees_24h", total),
            "studying": summary(focus),
            "share_of_chain_fees_pct": _num(float(focus["total24h"]) / max(total or 1, 1) * 100),
            "top_five_by_fees": [summary(p) for p in ranked[:5]],
        },
        "source_name": "DefiLlama fees",
        "source_url": "https://defillama.com/fees/chain/bsc",
    }


def trending() -> dict[str, Any]:
    pools = [_pool(p) for p in _get("https://api.geckoterminal.com/api/v2/networks/bsc/trending_pools")["data"][:8]]
    return {
        "topic": "trending pools",
        "subject": pools[0]["token"] if pools else None,
        "facts": {"trending_pools_now": pools},
        "source_name": "GeckoTerminal trending",
        "source_url": "https://www.geckoterminal.com/bsc/pools",
    }


def launches() -> dict[str, Any]:
    pools = [_pool(p) for p in _get("https://api.geckoterminal.com/api/v2/networks/bsc/new_pools")["data"]]
    funded = [p for p in pools if (p["liquidity"] or "").endswith(("k", "m", "b"))][:8]
    town = rows("SELECT COUNT(*) n FROM receipts WHERE kind='coin_launch'")[0]["n"]
    return {
        "topic": "new pools",
        "subject": funded[0]["token"] if funded else None,
        "facts": {
            "new_pools_with_1k_plus_liquidity": funded,
            "new_pools_seen": len(pools),
            "murmur_launchpad_coins": town,
        },
        "source_name": "GeckoTerminal new pools",
        "source_url": "https://www.geckoterminal.com/bsc/pools?sort=-pool_created_at",
    }


def security() -> dict[str, Any]:
    # Audit what the restless residents just looked at, otherwise the top trending token.
    recent = rows(
        "SELECT subject FROM notes WHERE agent_id IN ('flicker','pip') AND subject LIKE '0x%' ORDER BY id DESC LIMIT 6"
    )
    day_ago = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 86400))
    audited = {r["subject"] for r in rows("SELECT subject FROM notes WHERE agent_id='rook' AND created_at>=?", (day_ago,))}
    candidates = [r["subject"] for r in recent if r["subject"] not in audited]
    source = "a token flicker or pip just studied"
    if not candidates:
        candidates = [p["token"] for p in trending()["facts"]["trending_pools_now"] if p["token"] not in audited]
        source = "the top trending token rook has not audited today"
    token = candidates[0].lower()
    return {
        "topic": "contract audit · " + (audit(token).get("symbol") or token[:10]),
        "subject": token,
        "facts": {"why_this_token": source, **audit(token)},
        "source_name": "GoPlus token security",
        "source_url": f"https://gopluslabs.io/token-security/56/{token}",
    }


_audits: dict[str, tuple[float, dict[str, Any]]] = {}


def audit(token: str) -> dict[str, Any]:
    """GoPlus security facts for one BNB Chain token, cached for five minutes."""
    token = token.lower()
    if token in _audits and time.time() - _audits[token][0] < 300:
        return _audits[token][1]
    report = _get(f"https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses={token}")
    r = (report.get("result") or {}).get(token, {})
    holders = r.get("holders") or []
    flag = lambda k: {"1": True, "0": False}.get(str(r.get(k)), None)
    facts = {
        "token": token,
        "symbol": r.get("token_symbol"),
        "name": r.get("token_name"),
        "holder_count": r.get("holder_count"),
        "top_10_holders_pct": _num(sum(float(h.get("percent") or 0) for h in holders[:10]) * 100),
        "top_holder_is_contract": bool(holders and holders[0].get("is_contract")),
        "top_holders": [
            {
                "pct": _num(float(h.get("percent") or 0) * 100),
                "is_contract": bool(h.get("is_contract")),
                "locked": bool(h.get("is_locked")),
                "tag": h.get("tag") or None,
            }
            for h in holders[:5]
        ],
        "buy_tax_pct": _num(float(r.get("buy_tax") or 0) * 100),
        "sell_tax_pct": _num(float(r.get("sell_tax") or 0) * 100),
        "honeypot": flag("is_honeypot"),
        "mintable": flag("is_mintable"),
        "owner_can_change_balance": flag("owner_change_balance"),
        "hidden_owner": flag("hidden_owner"),
        "can_take_back_ownership": flag("can_take_back_ownership"),
        "trading_cooldown": flag("trading_cooldown"),
        "blacklist": flag("is_blacklisted"),
        "open_source": flag("is_open_source"),
        "proxy": flag("is_proxy"),
        "owner_address": r.get("owner_address") or None,
        "lp_holder_count": r.get("lp_holder_count"),
        "lp_locked_pct": _num(
            sum(float(h.get("percent") or 0) for h in (r.get("lp_holders") or []) if h.get("is_locked")) * 100
        ),
        "creator_pct": _num(float(r.get("creator_percent") or 0) * 100),
        "known": bool(r),
    }
    _audits[token] = (time.time(), facts)
    return facts


def market(token: str) -> dict[str, Any]:
    """Liquidity, volume and trader counts across a token's pools on GeckoTerminal."""
    token = token.lower()
    try:
        info = _get(f"https://api.geckoterminal.com/api/v2/networks/bsc/tokens/{token}")["data"]["attributes"]
        pools = [_pool(p) for p in _get(f"https://api.geckoterminal.com/api/v2/networks/bsc/tokens/{token}/pools?page=1")["data"][:6]]
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return {"known": False, "token": token}
        raise
    return {
        "known": True,
        "token": token,
        "name": info.get("name"),
        "symbol": info.get("symbol"),
        "price_usd": _num(info.get("price_usd"), 8),
        "market_cap": _usd(info.get("market_cap_usd")),
        "fdv": _usd(info.get("fdv_usd")),
        "total_liquidity": _usd(info.get("total_reserve_in_usd")),
        "total_liquidity_usd": _num(info.get("total_reserve_in_usd"), 0),
        "volume_24h": _usd((info.get("volume_usd") or {}).get("h24")),
        "pools": pools,
        "source_url": f"https://www.geckoterminal.com/bsc/tokens/{token}",
    }


def flows() -> dict[str, Any]:
    tvl = _get("https://api.llama.fi/v2/historicalChainTvl/BSC")
    stable = _get("https://stablecoins.llama.fi/stablecoincharts/BSC")
    dex = _get("https://api.llama.fi/overview/dexs/bsc?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true")
    t = [x["tvl"] for x in tvl]
    s = [x.get("totalCirculatingUSD", {}).get("peggedUSD", 0) for x in stable]
    change = lambda series, back: _num((series[-1] - series[-1 - back]) / series[-1 - back] * 100) if len(series) > back else None
    top = sorted(dex.get("protocols", []), key=lambda p: -float(p.get("total24h") or 0))[:4]
    return {
        "topic": "chain flows",
        "subject": "bsc",
        "facts": {
            "tvl": _usd(t[-1]),
            "tvl_change_7d_pct": change(t, 7),
            "tvl_change_30d_pct": change(t, 30),
            "stablecoins_on_chain": _usd(s[-1]),
            "stablecoin_change_7d_pct": change(s, 7),
            "stablecoin_change_30d_pct": change(s, 30),
            "dex_volume_24h": _usd(dex.get("total24h")),
            "dex_volume_change_1d_pct": _num(dex.get("change_1d")),
            "dex_volume_change_7d_pct": _num(dex.get("change_7d")),
            "dex_volume_vs_town_readings": remember("bsc_dex_24h", _num(dex.get("total24h"), 0)),
            "largest_dexes": [
                {"dex": p.get("displayName"), "volume_24h": _usd(p.get("total24h")), "change_1d_pct": _num(p.get("change_1d"))}
                for p in top
            ],
        },
        "source_name": "DefiLlama TVL, stablecoins, DEX volume",
        "source_url": "https://defillama.com/chain/BSC",
    }


def macro() -> dict[str, Any]:
    g = _get("https://api.coingecko.com/api/v3/global")["data"]
    fng = _get("https://api.alternative.me/fng/?limit=8")["data"]
    trend = _get("https://api.coingecko.com/api/v3/search/trending")["coins"][:7]
    mcap = g["total_market_cap"]["usd"]
    return {
        "topic": "market mood",
        "subject": "market",
        "facts": {
            "total_market_cap": _usd(mcap),
            "market_cap_change_24h_pct": _num(g.get("market_cap_change_percentage_24h_usd")),
            "btc_dominance_pct": _num(g["market_cap_percentage"].get("btc")),
            "eth_dominance_pct": _num(g["market_cap_percentage"].get("eth")),
            "bnb_dominance_pct": _num(g["market_cap_percentage"].get("bnb")),
            "fear_greed_last_8_days_newest_first": [f"{x['value']} {x['value_classification'].lower()}" for x in fng],
            "most_searched_coins": [
                {"coin": c["item"]["symbol"], "rank": c["item"].get("market_cap_rank"), "change_24h_pct": _num(c["item"].get("data", {}).get("price_change_percentage_24h", {}).get("usd"))}
                for c in trend
            ],
            "town_readings": remember("total_mcap", _num(mcap, 0)),
        },
        "source_name": "CoinGecko global + alternative.me fear & greed",
        "source_url": "https://www.coingecko.com/en/global-charts",
    }


BEATS: dict[str, dict[str, Any]] = {
    "moss": {"study": fees, "room": "research", "beat": "protocol fees on BNB Chain", "sources": ["DefiLlama fees"]},
    "flicker": {"study": trending, "room": "launches", "beat": "what is moving on BNB Chain DEXs", "sources": ["GeckoTerminal"]},
    "rook": {"study": security, "room": "risk", "beat": "token contract audits", "sources": ["GoPlus security"]},
    "pip": {"study": launches, "room": "launches", "beat": "new pools and launches", "sources": ["GeckoTerminal", "murmur launchpad"]},
    "vale": {"study": flows, "room": "research", "beat": "capital flows on BNB Chain", "sources": ["DefiLlama TVL", "DefiLlama stablecoins", "DefiLlama DEX volume"]},
    "echo": {"study": macro, "room": "commons", "beat": "whole-market sentiment", "sources": ["CoinGecko", "Fear & Greed index"]},
}


def study(agent_id: str) -> dict[str, Any]:
    fn: Callable[[], dict[str, Any]] = BEATS[agent_id]["study"]
    result = fn()
    result["observed_at"] = now()
    return result
