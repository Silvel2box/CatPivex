import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config
from app.adapters.registry import Registry
from app.models import ErrorResponse
from tests.conftest import Recorder, binance_with, make_app


def assert_error(resp, status: int, code: str) -> None:
    assert resp.status_code == status
    body = resp.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
    ErrorResponse.model_validate(body)


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200 and resp.json() == {"status": "ok"}


@pytest.mark.parametrize("interval", ["1m", "5m", "15m", "1h", "4h", "1D", "1W"])
def test_T1_2_all_intervals_accepted(client, interval):
    resp = client.get(
        "/api/candles", params={"symbol": "BINANCE:BTCUSDT", "interval": interval, "limit": 3}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "BINANCE:BTCUSDT" and body["interval"] == interval
    assert body["delayed"] is False and body["warning"] is None
    assert len(body["candles"]) == 3
    assert set(body["candles"][0]) == {"time", "open", "high", "low", "close", "volume"}


@pytest.mark.parametrize("interval", ["2h", "1d", "1w", "", "1M"])
def test_T1_2_bad_interval_is_400(client, interval):
    resp = client.get("/api/candles", params={"symbol": "BINANCE:BTCUSDT", "interval": interval})
    assert_error(resp, 400, "invalid_interval")


@pytest.mark.parametrize("symbol", ["BTCUSDT", "BINANCE:", ":BTC", "BINANCE:BTC USDT", "NYSE:IBM"])
def test_T1_2_bad_symbol_is_400(client, symbol):
    resp = client.get("/api/candles", params={"symbol": symbol, "interval": "1h"})
    assert_error(resp, 400, "invalid_symbol")


def test_T1_2_unknown_symbol_from_binance_is_400(tmp_path):
    rec = Recorder(httpx.Response(400, json={"code": -1121, "msg": "Invalid symbol."}))
    client = TestClient(make_app(tmp_path, Registry({"BINANCE": binance_with(rec, [])})))
    resp = client.get("/api/candles", params={"symbol": "BINANCE:NOPEUSDT", "interval": "1h"})
    assert_error(resp, 400, "invalid_symbol")


def test_upstream_failure_is_502_after_retries(tmp_path):
    rec = Recorder(httpx.Response(503))
    client = TestClient(make_app(tmp_path, Registry({"BINANCE": binance_with(rec, [])})))
    resp = client.get("/api/candles", params={"symbol": "BINANCE:BTCUSDT", "interval": "1h"})
    assert_error(resp, 502, "upstream_error")
    assert len(rec.requests) == 3


@pytest.mark.parametrize(
    "params",
    [
        {"interval": "1h"},  # missing symbol
        {"symbol": "BINANCE:BTCUSDT", "interval": "1h", "limit": 0},
        {"symbol": "BINANCE:BTCUSDT", "interval": "1h", "limit": 1001},
        {"symbol": "BINANCE:BTCUSDT", "interval": "1h", "end": "abc"},
    ],
)
def test_validation_errors_are_422(client, params):
    assert_error(client.get("/api/candles", params=params), 422, "validation_error")


def test_unknown_route_is_404(client):
    assert_error(client.get("/api/nope"), 404, "not_found")


def test_unhandled_error_is_500_with_cors(tmp_path, fake):
    def boom(*args):
        raise RuntimeError("secret details")

    fake.get_candles = boom
    client = TestClient(make_app(tmp_path, Registry({"BINANCE": fake})))
    resp = client.get(
        "/api/candles",
        params={"symbol": "BINANCE:BTCUSDT", "interval": "1h"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert_error(resp, 500, "internal_error")
    assert "secret" not in resp.text
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_symbol_search_endpoint(tmp_path):
    info = {
        "symbols": [
            {"symbol": "BTCUSDT", "baseAsset": "BTC", "quoteAsset": "USDT", "status": "TRADING"}
        ]
    }
    rec = Recorder(httpx.Response(200, json=info))
    client = TestClient(make_app(tmp_path, Registry({"BINANCE": binance_with(rec, [])})))
    resp = client.get("/api/symbols/search", params={"q": "btc"})
    assert resp.status_code == 200
    assert resp.json() == [
        {
            "symbol": "BINANCE:BTCUSDT",
            "name": "BTC / USDT",
            "exchange": "BINANCE",
            "type": "crypto",
            "realtime": True,
        }
    ]


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_T1_6_cors_allows_frontend_origin(client, origin):
    pre = client.options(
        "/api/candles",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )
    assert pre.status_code == 200
    assert pre.headers["access-control-allow-origin"] == origin
    get = client.get("/api/health", headers={"Origin": origin})
    assert get.headers["access-control-allow-origin"] == origin


def test_T1_6_cors_rejects_other_origin(client):
    evil = "http://evil.example"
    pre = client.options(
        "/api/candles", headers={"Origin": evil, "Access-Control-Request-Method": "GET"}
    )
    assert "access-control-allow-origin" not in pre.headers
    get = client.get("/api/health", headers={"Origin": evil})
    assert "access-control-allow-origin" not in get.headers


def test_T1_7_bind_address_is_localhost_only():
    assert config.HOST == "127.0.0.1"
    package_json = Path(__file__).resolve().parents[2] / "package.json"
    scripts = json.loads(package_json.read_text(encoding="utf-8"))["scripts"]
    assert "--host 127.0.0.1" in scripts["dev:api"]
    assert "0.0.0.0" not in scripts["dev:api"]


def test_settings_from_env_file_and_environ(tmp_path):
    env = tmp_path / ".env"
    env.write_text(
        "# comment\nCATPIVEX_DB_PATH=data/x.db\nCATPIVEX_CORS_ORIGINS=http://a:1, http://b:2\n",
        encoding="utf-8",
    )
    s = config.load_settings(env_file=env, environ={})
    assert s.db_path == config.BACKEND_DIR / "data" / "x.db"
    assert s.cors_origins == ["http://a:1", "http://b:2"]
    s = config.load_settings(env_file=env, environ={"CATPIVEX_CORS_ORIGINS": "http://c:3"})
    assert s.cors_origins == ["http://c:3"]
    s = config.load_settings(env_file=tmp_path / "missing.env", environ={})
    assert s.db_path == config.BACKEND_DIR / "catpivex.db"
    assert s.cors_origins == ["http://localhost:5173", "http://127.0.0.1:5173"]
