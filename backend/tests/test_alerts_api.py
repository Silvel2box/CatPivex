import pytest
from fastapi.testclient import TestClient

from app.adapters.base import AdapterError
from app.adapters.registry import Registry
from app.config import DEFAULT_CORS_ORIGINS, Settings
from app.main import create_app
from app.models import Candle, ErrorResponse
from tests.conftest import NOW, FakeAdapter

BTC = "BINANCE:BTCUSDT"
ETH = "BINANCE:ETHUSDT"


class DownAdapter(FakeAdapter):
    def get_candles(self, *args):
        raise AdapterError("upstream_error", "down")


def make_client(tmp_path, adapters=None, **kw) -> TestClient:
    settings = Settings(
        db_path=tmp_path / "api.db", cors_origins=DEFAULT_CORS_ORIGINS.split(","), **kw
    )
    registry = Registry(adapters or {"BINANCE": FakeAdapter()})
    return TestClient(create_app(settings=settings, registry=registry, clock=lambda: NOW))


@pytest.fixture
def client(tmp_path) -> TestClient:
    return make_client(tmp_path)


def assert_error(resp, status: int, code: str) -> None:
    assert resp.status_code == status, resp.text
    assert ErrorResponse.model_validate(resp.json()).error.code == code


def states(client: TestClient, symbol: str = BTC):
    return client.app.state.db.enabled_alert_states(symbol)


def post(client, **body):
    return client.post("/api/alerts", json={"symbol": BTC, "condition": "gte", "price": 1, **body})


# --- T5.5 CRUD ------------------------------------------------------------------------------


def test_t5_5_crud(client):
    assert client.get("/api/alerts").json() == []
    r = post(client, symbol="binance:btcusdt", condition="crosses_above", price=98500.5, note="n")
    assert r.status_code == 201
    a = r.json()
    assert a == {
        "id": a["id"],
        "symbol": BTC,
        "condition": "crosses_above",
        "price": 98500.5,
        "repeat": False,
        "enabled": True,
        "drawing_id": None,
        "note": "n",
        "created_at": NOW,
        "last_triggered_at": None,
    }
    b = post(client, symbol=ETH, repeat=True).json()
    assert [x["id"] for x in client.get("/api/alerts").json()] == [a["id"], b["id"]]

    r = client.patch(f"/api/alerts/{a['id']}", json={"condition": "lte", "note": ""})
    assert r.status_code == 200
    assert r.json() == {**a, "condition": "lte", "note": ""}
    r = client.patch(f"/api/alerts/{a['id']}", json={"price": 2.5, "repeat": True})
    assert r.json() == {**a, "condition": "lte", "note": "", "price": 2.5, "repeat": True}
    assert client.patch(f"/api/alerts/{a['id']}", json={}).json()["price"] == 2.5
    # symbol / drawing_id cannot change
    r = client.patch(f"/api/alerts/{a['id']}", json={"symbol": ETH, "drawing_id": "h"})
    assert (r.json()["symbol"], r.json()["drawing_id"]) == (BTC, None)

    r = client.delete(f"/api/alerts/{a['id']}")
    assert r.status_code == 204 and r.content == b""
    assert [x["id"] for x in client.get("/api/alerts").json()] == [b["id"]]
    assert_error(client.delete(f"/api/alerts/{a['id']}"), 404, "not_found")
    assert_error(client.patch(f"/api/alerts/{a['id']}", json={"note": "x"}), 404, "not_found")
    assert_error(client.patch("/api/alerts/abc", json={}), 422, "validation_error")


@pytest.mark.parametrize(
    "raw",
    [
        '{"symbol": "BINANCE:BTCUSDT", "condition": "gte", "price": NaN}',
        '{"symbol": "BINANCE:BTCUSDT", "condition": "gte", "price": Infinity}',
        '{"symbol": "BINANCE:BTCUSDT", "condition": "gte", "price": 0}',
        '{"symbol": "BINANCE:BTCUSDT", "condition": "gte", "price": -5}',
        '{"symbol": "BINANCE:BTCUSDT", "condition": "gte", "price": "abc"}',
        '{"symbol": "BINANCE:BTCUSDT", "condition": "gte"}',
        '{"symbol": "BINANCE:BTCUSDT", "condition": "above", "price": 1}',
        '{"symbol": "BINANCE:BTCUSDT", "condition": "gte", "price": 1, "note": "'
        + "x" * 201
        + '"}',
        '{"symbol": "BINANCE:BTCUSDT", "condition": "gte", "price": 1, "drawing_id": ""}',
        '{"condition": "gte", "price": 1}',
    ],
)
def test_t5_5_create_validation(client, raw):
    r = client.post("/api/alerts", content=raw, headers={"content-type": "application/json"})
    assert_error(r, 422, "validation_error")
    assert client.get("/api/alerts").json() == []


def test_t5_5_create_note_at_max_and_symbol_errors(client):
    assert post(client, note="ห" * 200).status_code == 201
    assert_error(post(client, symbol="NOCOLON"), 400, "invalid_symbol")
    assert_error(post(client, symbol="NOPE:XYZ"), 400, "invalid_symbol")


@pytest.mark.parametrize(
    "body",
    [
        '{"price": NaN}',
        '{"price": -Infinity}',
        '{"price": 0}',
        '{"condition": "between"}',
        '{"note": "' + "x" * 201 + '"}',
        '{"enabled": "maybe"}',
    ],
)
def test_t5_5_patch_validation(client, body):
    a = post(client).json()
    headers = {"content-type": "application/json"}
    r = client.patch(f"/api/alerts/{a['id']}", content=body, headers=headers)
    assert_error(r, 422, "validation_error")
    assert client.get("/api/alerts").json() == [a]


# --- T5.5 baseline --------------------------------------------------------------------------


def test_t5_5_baseline_taken_on_post(client):
    post(client)
    [st] = states(client)
    newest = 1_699_999_980  # FakeAdapter: the open 1m candle at NOW, h=2 l=0.5 c=1.5
    assert (st.base_time, st.base_high, st.base_low, st.base_close, st.armed) == (
        newest,
        2,
        0.5,
        1.5,
        True,
    )


def test_t5_5_baseline_is_best_effort(tmp_path):
    client = make_client(tmp_path, {"BINANCE": DownAdapter()})
    assert post(client).status_code == 201
    [st] = states(client)
    assert (st.base_time, st.base_close) == (None, None)


def test_t5_5_reenable_takes_a_fresh_baseline_and_arms(tmp_path):
    client = make_client(tmp_path)
    a = post(client).json()
    db = client.app.state.db
    stale = Candle(time=1, open=9, high=9, low=9, close=9, volume=0)
    db.save_check(a["id"], stale, False)
    assert (
        client.patch(f"/api/alerts/{a['id']}", json={"enabled": False}).json()["enabled"] is False
    )
    assert states(client) == []
    db.save_check(a["id"], stale, False)
    r = client.patch(f"/api/alerts/{a['id']}", json={"enabled": True})
    assert r.json()["enabled"] is True
    [st] = states(client)
    assert (st.base_time, st.base_close, st.armed) == (1_699_999_980, 1.5, True)
    db.save_check(a["id"], stale, False)
    client.patch(f"/api/alerts/{a['id']}", json={"enabled": True, "price": 3})
    [st] = states(client)
    assert (st.base_time, st.armed) == (1, False)  # already enabled: nothing reset


def test_t5_5_reenable_with_source_down_clears_the_stale_baseline(tmp_path):
    client = make_client(tmp_path)
    a = post(client).json()
    client.patch(f"/api/alerts/{a['id']}", json={"enabled": False})
    client.app.state.registry.adapters["BINANCE"] = DownAdapter()
    assert client.patch(f"/api/alerts/{a['id']}", json={"enabled": True}).status_code == 200
    [st] = states(client)
    assert (st.base_time, st.base_close, st.armed) == (None, None, True)


# --- T5.5 events ----------------------------------------------------------------------------


def add_events(client, n: int) -> list[int]:
    a = post(client, repeat=True).json()
    bar = Candle(time=NOW, open=1, high=1, low=1, close=1, volume=0)
    ids = []
    for i in range(n):
        event = {
            "symbol": BTC,
            "condition": "gte",
            "level": 1.0,
            "price": 1.0 + i,
            "time": NOW + i,
            "message": f"m{i}",
            "deliveries": {"telegram": "ok"} if i % 2 else {},
        }
        ids.append(client.app.state.db.save_trigger(a["id"], bar, False, False, event).id)
    return ids


def test_t5_5_events_after_newest_first_and_limit(client):
    assert client.get("/api/alerts/events").json() == []
    ids = add_events(client, 7)
    got = client.get("/api/alerts/events").json()
    assert [e["id"] for e in got] == ids[::-1]
    assert got[0]["message"] == "m6" and got[0]["deliveries"] == {}
    assert got[1]["deliveries"] == {"telegram": "ok"}
    assert [e["id"] for e in client.get(f"/api/alerts/events?after={ids[3]}").json()] == ids[:3:-1]
    assert client.get(f"/api/alerts/events?after={ids[-1]}").json() == []
    assert [e["id"] for e in client.get("/api/alerts/events?limit=2").json()] == ids[:-3:-1]
    after = client.get(f"/api/alerts/events?after={ids[1]}&limit=2").json()
    assert [e["id"] for e in after] == [ids[6], ids[5]]
    assert len(client.get("/api/alerts/events?limit=500").json()) == 7
    for q in ("limit=0", "limit=501", "after=x"):
        assert_error(client.get(f"/api/alerts/events?{q}"), 422, "validation_error")


def test_t5_5_events_outlive_their_alert(client):
    ids = add_events(client, 1)
    alert_id = client.get("/api/alerts").json()[0]["id"]
    client.delete(f"/api/alerts/{alert_id}")
    [e] = client.get("/api/alerts/events").json()
    assert (e["id"], e["alert_id"]) == (ids[0], alert_id)


# --- T5.5 linked alerts ---------------------------------------------------------------------

LINES = [
    {"id": "h1", "type": "hline", "price": 101.5},
    {"id": "h2", "type": "hline", "price": 200},
    {"id": "t1", "type": "trendline", "a": {"time": 1, "price": 5}},
]


def put_drawings(client, drawings, symbol=BTC):
    r = client.put(f"/api/drawings/{symbol}", json={"drawings": drawings})
    assert r.status_code == 200, r.text


def test_t5_5_linked_create_takes_the_line_price(client):
    put_drawings(client, LINES)
    r = post(client, drawing_id="h1", price=999)
    assert r.status_code == 201
    assert (r.json()["price"], r.json()["drawing_id"]) == (101.5, "h1")
    r = post(client, drawing_id="h2")
    assert r.json()["price"] == 200


@pytest.mark.parametrize(
    "drawing_id, symbol",
    [("nope", BTC), ("t1", BTC), ("h3", BTC), ("h1", ETH)],
)
def test_t5_5_linked_create_needs_an_hline_of_that_symbol(client, drawing_id, symbol):
    put_drawings(client, [*LINES, {"id": "h3", "type": "hline", "price": "x"}])
    assert_error(post(client, symbol=symbol, drawing_id=drawing_id), 422, "validation_error")
    assert client.get("/api/alerts").json() == []


def test_t5_5_put_drawings_syncs_linked_alerts(client):
    put_drawings(client, LINES)
    put_drawings(client, [{"id": "h1", "type": "hline", "price": 300}], symbol=ETH)
    h1 = post(client, drawing_id="h1").json()
    post(client, drawing_id="h2")
    solo = post(client, price=101.5).json()
    eth = post(client, symbol=ETH, drawing_id="h1").json()

    put_drawings(client, [{"id": "h1", "type": "hline", "price": 105}, LINES[2]])
    got = {a["id"]: a for a in client.get("/api/alerts").json()}
    assert set(got) == {h1["id"], solo["id"], eth["id"]}  # h2's line is gone
    assert got[h1["id"]]["price"] == 105
    assert got[solo["id"]]["price"] == 101.5
    assert got[eth["id"]]["price"] == 300  # other symbol untouched

    put_drawings(client, [{"id": "h1", "type": "hline", "price": "bad"}])
    assert {a["id"]: a["price"] for a in client.get("/api/alerts").json()}[h1["id"]] == 105

    put_drawings(client, [{"id": "h1", "type": "vline", "time": 5}])  # no longer an hline
    assert {a["id"] for a in client.get("/api/alerts").json()} == {solo["id"], eth["id"]}


def test_t5_5_delete_drawings_deletes_linked_alerts(client):
    put_drawings(client, LINES)
    post(client, drawing_id="h1")
    solo = post(client).json()
    put_drawings(client, [{"id": "h1", "type": "hline", "price": 1}], symbol=ETH)
    eth = post(client, symbol=ETH, drawing_id="h1").json()
    assert client.delete("/api/drawings/binance%3Abtcusdt").status_code == 200
    assert [a["id"] for a in client.get("/api/alerts").json()] == [solo["id"], eth["id"]]


def ray(price, time=1_700_000_000, rid="r1"):
    return {
        "id": rid,
        "type": "hray",
        "color": "#2962ff",
        "width": 1,
        "a": {"time": time, "price": price},
    }


def test_t6_1_alert_linked_to_a_ray_follows_it_and_goes_with_it(client):
    put_drawings(client, [ray(101.5), LINES[0]])
    r = post(client, drawing_id="r1", price=999)
    assert r.status_code == 201
    assert (r.json()["price"], r.json()["drawing_id"]) == (101.5, "r1")
    h1 = post(client, drawing_id="h1").json()

    put_drawings(client, [ray(120.25, time=1_700_000_600), LINES[0]])
    got = {a["drawing_id"]: a["price"] for a in client.get("/api/alerts").json()}
    assert got == {"r1": 120.25, "h1": 101.5}

    put_drawings(client, [{**ray(130), "a": "bad"}, LINES[0]])
    assert {a["drawing_id"]: a["price"] for a in client.get("/api/alerts").json()}["r1"] == 120.25

    put_drawings(client, [LINES[0]])
    assert [a["id"] for a in client.get("/api/alerts").json()] == [h1["id"]]


def test_t6_1_linked_create_rejects_a_malformed_ray(client):
    put_drawings(client, [{**ray(0), "id": "r0"}, {**ray(1), "a": None}])
    for rid in ("r0", "r1"):
        assert_error(post(client, drawing_id=rid), 422, "validation_error")
    assert client.get("/api/alerts").json() == []


def test_t5_5_patch_price_of_linked_alert_is_rejected(client):
    put_drawings(client, LINES)
    a = post(client, drawing_id="h1").json()
    assert_error(client.patch(f"/api/alerts/{a['id']}", json={"price": 5}), 422, "validation_error")
    assert client.get("/api/alerts").json() == [a]
    r = client.patch(f"/api/alerts/{a['id']}", json={"note": "ok", "condition": "crosses"})
    assert r.status_code == 200 and r.json()["price"] == 101.5


# --- test feed / scheduler wiring -----------------------------------------------------------


def test_test_feed_is_absent_by_default(client):
    assert_error(
        client.put("/api/test/price", json={"symbol": "TEST:FOO", "price": 1}), 404, "not_found"
    )
    assert_error(client.get("/api/candles?symbol=TEST:FOO&interval=1m"), 400, "invalid_symbol")


def test_test_feed_sets_the_current_1m_bar(tmp_path):
    client = make_client(tmp_path, test_feed=True)
    for p in (100, 103, 99, 101):
        r = client.put("/api/test/price", json={"symbol": "test:foo", "price": p})
        assert r.status_code == 204 and r.content == b""
    body = client.get("/api/candles?symbol=TEST:FOO&interval=1m").json()
    assert body["delayed"] is False
    assert body["candles"] == [
        {"time": NOW // 60 * 60, "open": 100, "high": 103, "low": 99, "close": 101, "volume": 0}
    ]
    assert_error(client.get("/api/candles?symbol=TEST:FOO&interval=1h"), 400, "invalid_interval")
    assert client.get("/api/symbols/search?q=FOO").json() == []
    assert_error(
        client.put("/api/test/price", json={"symbol": BTC, "price": 1}), 400, "invalid_symbol"
    )
    r = client.put("/api/test/price", json={"symbol": "TEST:FOO", "price": 0})
    assert_error(r, 422, "validation_error")


def test_scheduler_runs_only_when_enabled(tmp_path):
    with make_client(tmp_path) as client:
        assert client.app.state.scheduler is None
    with make_client(tmp_path, alerts_enabled=True, alert_interval_s=2) as client:
        scheduler = client.app.state.scheduler
        assert scheduler.running
        [job] = scheduler.get_jobs()
        assert job.max_instances == 1
        assert job.trigger.interval.total_seconds() == 2
    assert not scheduler.running
