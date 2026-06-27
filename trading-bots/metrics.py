"""
Lightweight metrics HTTP server (port 9090).

Endpoints:
  GET /metrics          — JSON snapshot of all bots
  GET /metrics/<key>    — single bot snapshot
  GET /health           — liveness probe
"""

from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING, Dict

from aiohttp import web

if TYPE_CHECKING:
    from bots.base_bot import BaseBot


# ── Registry ──────────────────────────────────────────────────────────────────

_registry: Dict[str, "BaseBot"] = {}


def register(key: str, bot: "BaseBot") -> None:
    _registry[key] = bot


# ── Handlers ──────────────────────────────────────────────────────────────────

async def _all_metrics(request: web.Request) -> web.Response:
    payload = {
        "timestamp": int(time.time() * 1000),
        "bots":      {k: b.get_metrics() for k, b in _registry.items()},
    }
    return _json(payload)


async def _single_metric(request: web.Request) -> web.Response:
    key = request.match_info["key"]
    bot = _registry.get(key)
    if bot is None:
        return web.Response(status=404, text=json.dumps({"error": "not found"}),
                            content_type="application/json")
    return _json(bot.get_metrics())


async def _health(_request: web.Request) -> web.Response:
    return _json({"status": "ok", "bots": len(_registry)})


def _json(data: dict) -> web.Response:
    return web.Response(
        text=json.dumps(data),
        content_type="application/json",
        headers={"Access-Control-Allow-Origin": "*"},
    )


# ── Server bootstrap ──────────────────────────────────────────────────────────

async def start(host: str = "0.0.0.0", port: int = 9090) -> None:
    app = web.Application()
    app.router.add_get("/health",        _health)
    app.router.add_get("/metrics",       _all_metrics)
    app.router.add_get("/metrics/{key}", _single_metric)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    print(f"[metrics] server listening on {host}:{port}")
