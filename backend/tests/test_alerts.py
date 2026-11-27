import pytest
from fastapi.testclient import TestClient

from app.adapters.registry import Registry
from app.config import DEFAULT_CORS_ORIGINS, Settings
from app.main import create_app
from app.models import AlertCreate, Candle
from app.notifiers import NotifierError
from app.services.alerts import (
    check_interval,
    format_message,
    format_price,
    line_level,
    line_levels,
    next_armed,
    should_fire,
    window_extremes,
)
from tests.conftest import NOW

L = 100.0


def bar(t: int, high: float, low: float, close: float) -> Candle:
    return Candle(time=t, open=close, high=high, low=low, close=close, volume=0)


# --- T5.1 conditions ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "condition, high, low, base_close, armed, expected",
    [
        # crosses_above: base_close < L <= high
        ("crosses_above", 101, 95, 95, True, True),
        ("crosses_above", 100, 95, 95, True, True),  # high exactly at L
        ("crosses_above", 99.9, 95, 95, True, False),
        ("crosses_above", 105, 100, 100, True, False),  # started exactly at L: no side
        ("crosses_above", 105, 101, 101, True, False),  # already above
        ("crosses_above", 105, 95, None, True, False),  # no baseline
        ("crosses_above", 101, 95, 95, False, True),  # armed is ignored
        # crosses_below: base_close > L >= low
        ("crosses_below", 105, 99, 105, True, True),
        ("crosses_below", 105, 100, 105, True, True),  # low exactly at L
        ("crosses_below", 105, 100.1, 105, True, False),
        ("crosses_below", 100, 95, 100, True, False),  # started exactly at L
        ("crosses_below", 99, 95, 99, True, False),  # already below
        ("crosses_below", 105, 95, None, True, False),
        # crosses: either direction
        ("crosses", 101, 95, 95, True, True),
        ("crosses", 105, 99, 105, True, True),
        ("crosses", 100, 100, 100, True, False),
        ("crosses", 99, 95, 98, True, False),
        ("crosses", 120, 80, None, True, False),
        # gte / lte: armed and touching (no baseline needed)
        ("gte", 100, 90, None, True, True),  # exactly at L
        ("gte", 120, 110, 110, True, True),  # already above on the first check
        ("gte", 99.99, 90, 95, True, False),
        ("gte", 120, 110, 110, False, False),  # not armed
        ("lte", 110, 100, None, True, True),
        ("lte", 90, 80, 85, True, True),
        ("lte", 110, 100.01, 105, True, False),
        ("lte", 90, 80, 85, False, False),
    ],
)
def test_t5_1_should_fire(condition, high, low, base_close, armed, expected):
    assert should_fire(condition, L, high, low, base_close, armed) is expected
    assert should_fire(condition, L, high, low, base_close, armed, L) is expected


@pytest.mark.parametrize(
    "condition, level, base_level, high, low, base_close, expected",
    [
        ("crosses_below", 101, 99, 100, 100, 100, True),
        ("crosses", 101, 99, 100, 100, 100, True),
        ("crosses_above", 101, 99, 100, 100, 100, False),
        ("crosses_above", 99, 101, 100, 100, 100, True),
        ("crosses", 99, 101, 100, 100, 100, True),
        ("crosses_below", 99, 101, 100, 100, 100, False),
        ("crosses_below", 101, 99, 101.5, 101.5, 100, False),
        ("crosses_above", 99, 101, 98.5, 98.5, 100, False),
        ("crosses", 101, 100, 100, 100, 100, False),
        ("crosses_below", 101, 99, 100, 100, None, False),
        ("crosses_above", 105, 100, 106, 99, 99, True),
        ("crosses_above", 105, 100, 104, 99, 99, False),
        ("gte", 101, 99, 100, 100, 100, False),
        ("gte", 99, 101, 100, 100, 100, True),
        ("lte", 101, 99, 100, 100, 100, True),
        ("lte", 99, 101, 100, 100, 100, False),
    ],
)
def test_d11_should_fire_on_a_sloped_line(
    condition, level, base_level, high, low, base_close, expected
):
    assert should_fire(condition, level, high, low, base_close, True, base_level) is expected


def test_t5_1_should_fire_unknown_condition():
    with pytest.raises(ValueError):
        should_fire("above", L, 1, 1, 1, True)


@pytest.mark.parametrize(
    "condition, close, armed, fired, expected",
    [
        ("gte", 120, True, True, False),  # fired -> disarmed
        ("gte", 120, False, False, False),  # still in the condition: stays disarmed
        ("gte", 100, False, False, False),  # exactly at L is not the other side
        ("gte", 99, False, False, True),  # left the condition -> re-armed
        ("gte", 99, True, True, False),  # fired by a wick, closed below: fired wins
        ("lte", 80, True, True, False),
        ("lte", 100, False, False, False),
        ("lte", 101, False, False, True),
        ("lte", 90, True, False, True),
        ("crosses", 120, True, True, True),
        ("crosses_above", 120, False, True, True),
        ("crosses_below", 80, False, False, True),
    ],
)
def test_t5_1_next_armed(condition, close, armed, fired, expected):
    assert next_armed(condition, L, close, armed, fired) is expected


T0 = 1_700_000_040  # a 1m bar open time


@pytest.mark.parametrize(
    "candles, base, expected",
    [
        # no baseline: just the newest close
        ([bar(T0, 110, 90, 100), bar(T0 + 60, 130, 70, 101)], (None, None, None, None), (101, 101)),
        # same bar, no new extreme since the last check: only base_close + newest close
        ([bar(T0, 105, 95, 99)], (T0, 105, 95, 98), (99, 98)),
        # same bar, a new high and a new low since the last check
        ([bar(T0, 107, 93, 99)], (T0, 105, 95, 98), (107, 93)),
        # same bar, new high only
        ([bar(T0, 106, 95, 99)], (T0, 105, 95, 98), (106, 98)),
        # newer bars count fully, the same bar only for its new extremes
        (
            [bar(T0, 105, 95, 99), bar(T0 + 60, 102, 97, 100), bar(T0 + 120, 101, 99.5, 100.5)],
            (T0, 105, 95, 98),
            (102, 97),
        ),
        # older bars are ignored
        (
            [bar(T0 - 60, 200, 1, 150), bar(T0, 105, 95, 99), bar(T0 + 60, 101, 98, 100)],
            (T0, 105, 95, 98),
            (101, 98),
        ),
        # base_close outside the bars still widens the range
        ([bar(T0 + 60, 101, 99, 100)], (T0, 90, 80, 85), (101, 85)),
    ],
)
def test_t5_1_window_extremes(candles, base, expected):
    assert window_extremes(candles, *base) == expected


# --- T5.4 check interval --------------------------------------------------------------------


def test_t5_4_check_interval():
    assert check_interval("BINANCE:BTCUSDT") == 30
    assert check_interval("binance:ethusdt") == 30
    for symbol in ("SET:PTT", "US:AAPL", "FX:XAUUSD", "TEST:FOO"):
        assert check_interval(symbol) == 60
    assert check_interval("BINANCE:BTCUSDT", 5) == 5
    assert check_interval("SET:PTT", 2) == 2


# --- message / hline helpers ----------------------------------------------------------------


def test_format_message_thai_time_separators_and_note():
    t = 1_764_054_180  # 2025-11-25 07:03 UTC = 14:03 Bangkok
    msg = format_message("BINANCE:BTCUSDT", "crosses_above", 98500, 98512.3, t, "")
    assert (
        msg
        == "🔔 BINANCE:BTCUSDT crossed above 98,500.00 — now 98,512.30 · 25 Nov 14:03 (Thai time)"
    )
    msg = format_message("FX:USDTHB", "lte", 32.5, 32.4875, t + 86400 * 10, "ซื้อ $")
    assert msg == (
        "🔔 FX:USDTHB is at or below 32.50 — now 32.4875 · 5 Dec 14:03 (Thai time)\nซื้อ $"
    )
    assert "\n" not in format_message("SET:PTT", "gte", 1234567.5, 0.00001234, t, "")
    assert "1,234,567.50" in format_message("SET:PTT", "gte", 1234567.5, 0.00001234, t, "")
    assert "0.00001234" in format_message("SET:PTT", "gte", 1234567.5, 0.00001234, t, "")


def test_d11_format_message_names_the_trend_line():
    t = 1_764_054_180
    msg = format_message("BINANCE:BTCUSDT", "crosses_below", 61800, 61750.5, t, "", trend=True)
    assert msg == (
        "🔔 BINANCE:BTCUSDT crossed below trend line 61,800.00 — now 61,750.50"
        " · 25 Nov 14:03 (Thai time)"
    )


@pytest.mark.parametrize(
    ("value", "text"),
    [
        (59429.724018, "59,429.72"),
        (354.19000244, "354.19"),
        (32.4875, "32.4875"),
        (33.9, "33.90"),
        (1.0, "1.00"),
        (0.5678, "0.5678"),
        (0.5, "0.5"),
        (0.00001234, "0.00001234"),
    ],
)
def test_format_price(value, text):
    assert format_price(value) == text


def test_hline_prices():
    drawings = [
        {"id": "h1", "type": "hline", "price": 101.5},
        {"id": "h2", "type": "hline", "price": 7},
        {"id": "h3", "type": "hline", "price": -1},
        {"id": "h4", "type": "hline", "price": "1"},
        {"id": "h5", "type": "hline", "price": True},
        {"id": "t1", "type": "trendline", "price": 5},
        {"id": "v1", "type": "vline", "time": 5},
        {"type": "hline", "price": 5},
    ]
    expected = {"h1": 101.5, "h2": 7.0, "h3": None, "h4": None, "h5": None, "t1": None}
    assert line_levels(drawings, 0) == expected
    assert line_levels(drawings, 1_800_000_000) == expected


def test_hline_prices_hray():
    a = {"time": 1_700_000_000}
    drawings = [
        {"id": "r1", "type": "hray", "a": {**a, "price": 101.5}},
        {"id": "r2", "type": "hray", "a": {**a, "price": 7}, "price": 999},
        {"id": "r3", "type": "hray", "a": {**a, "price": 0}},
        {"id": "r4", "type": "hray", "a": {**a, "price": True}},
        {"id": "r5", "type": "hray", "a": {**a, "price": float("inf")}},
        {"id": "r6", "type": "hray", "a": [1, 2]},
        {"id": "r7", "type": "hray", "price": 5},
        {"id": "r8", "type": "hray", "a": {"time": 1}},
        {"id": "t1", "type": "trendline", "a": {**a, "price": 5}},
    ]
    assert line_levels(drawings, 1_700_000_000) == {
        "r1": 101.5,
        "r2": 7.0,
        "r3": None,
        "r4": None,
        "r5": None,
        "r6": None,
        "r7": None,
        "r8": None,
        "t1": None,
    }


def trend(a_time, a_price, b_time, b_price, tid="t1") -> dict:
    return {
        "id": tid,
        "type": "trendline",
        "color": "#2962ff",
        "width": 1,
        "a": {"time": a_time, "price": a_price},
        "b": {"time": b_time, "price": b_price},
    }


@pytest.mark.parametrize(
    "line, at, expected",
    [
        (trend(1000, 100, 2000, 200), 1000, 100),
        (trend(1000, 100, 2000, 200), 2000, 200),
        (trend(1000, 100, 2000, 200), 1500, 150),
        (trend(1000, 100, 2000, 200), 3500, 350),
        (trend(1000, 100, 2000, 200), 500, 50),
        (trend(2000, 200, 1000, 100), 3500, 350),
        (trend(1000, 200, 2000, 100), 2500, 50),
        (trend(1000, 200, 2000, 100), 500, 250),
        (trend(1000, 200, 2000, 100), 3000, None),
        (trend(1000, 200, 2000, 100), 3500, None),
        (trend(1000, 100, 2000, 200), 0, None),
        (trend(1000, 100, 1000, 200), 1000, None),
        (trend(1000, 100, 1000, 100), 1000, None),
        (trend(0, 1e308, 1, -1e308), 2, None),
        (trend(1000, 100, 2000, float("nan")), 1500, None),
        ({**trend(1000, 100, 2000, 200), "b": None}, 1500, None),
        ({**trend(1000, 100, 2000, 200), "b": {"time": 2000}}, 1500, None),
        ({**trend(1000, 100, 2000, 200), "b": {"time": True, "price": 2}}, 1500, None),
        ({**trend(1000, 100, 2000, 200), "a": {"time": 1000, "price": "1"}}, 1500, None),
        ({**trend(1000, 100, 2000, 200), "b": {"time": 10**400, "price": 2}}, 1500, None),
    ],
)
def test_d11_trend_line_level(line, at, expected):
    got = line_level(line, at)
    assert got == (None if expected is None else pytest.approx(expected))


def test_d11_line_levels_mixes_types_at_one_time():
    drawings = [
        trend(1000, 100, 2000, 200),
        trend(1000, 100, 1000, 200, tid="t2"),
        {"id": "h1", "type": "hline", "price": 50},
        {"id": "r1", "type": "hray", "a": {"time": 9999, "price": 60}},
        {
            "id": "f1",
            "type": "fib",
            "a": {"time": 1000, "price": 1},
            "b": {"time": 2000, "price": 2},
        },
    ]
    assert line_levels(drawings, 3000) == {"t1": 300.0, "t2": None, "h1": 50.0, "r1": 60.0}


# --- T5.2 trigger (fake feed + fake clock, several checks) ----------------------------------

M0 = NOW // 60 * 60 + 600  # start of a minute, after NOW


class Clock:
    def __init__(self, now: float):
        self.now = now

    def __call__(self) -> float:
        return self.now


class Recording:
    name = "fake"

    def __init__(self, on_send=None):
        self.texts: list[str] = []
        self.on_send = on_send

    def send(self, text: str) -> None:
        self.texts.append(text)
        if self.on_send:
            self.on_send()


class Feed:
    """The TEST feed app: set prices, run checks, read events."""

    def __init__(self, tmp_path, notifier=None):
        self.clock = Clock(M0)
        settings = Settings(
            db_path=tmp_path / "a.db",
            cors_origins=DEFAULT_CORS_ORIGINS.split(","),
            test_feed=True,
        )
        self.app = create_app(settings=settings, registry=Registry({}), clock=self.clock)
        self.client = TestClient(self.app)
        self.checker = self.app.state.alert_checker
        self.notifier = notifier or Recording()
        self.checker.notifiers = [self.notifier]

    def price(self, *prices: float, at: float | None = None) -> None:
        if at is not None:
            self.clock.now = at
        for p in prices:
            r = self.client.put("/api/test/price", json={"symbol": "TEST:FOO", "price": p})
            assert r.status_code == 204, r.text

    def create(self, **body) -> dict:
        r = self.client.post("/api/alerts", json={"symbol": "TEST:FOO", **body})
        assert r.status_code == 201, r.text
        return r.json()

    def check(self, at: float) -> int:
        self.clock.now = at
        return len(self.checker.check_symbol("TEST:FOO"))

    def alert(self, alert_id: int) -> dict:
        return next(a for a in self.client.get("/api/alerts").json() if a["id"] == alert_id)

    def events(self) -> list[dict]:
        return self.client.get("/api/alerts/events").json()


def test_t5_2_once_fires_records_time_and_disables(tmp_path):
    f = Feed(tmp_path)
    f.price(95, at=M0 + 5)
    a = f.create(condition="crosses_above", price=100, note="take profit")
    assert f.check(M0 + 30) == 0
    f.price(99, 101, at=M0 + 40)
    assert f.check(M0 + 45) == 1

    [event] = f.events()
    assert event == {
        "id": event["id"],
        "alert_id": a["id"],
        "symbol": "TEST:FOO",
        "condition": "crosses_above",
        "level": 100.0,
        "price": 101.0,
        "time": M0 + 45,
        "message": f.notifier.texts[0],
        "deliveries": {"fake": "ok"},
    }
    assert "TEST:FOO crossed above 100.00 — now 101.00" in event["message"]
    assert event["message"].endswith("\ntake profit")
    alert = f.alert(a["id"])
    assert alert["enabled"] is False
    assert alert["last_triggered_at"] == M0 + 45

    f.price(90, 110, at=M0 + 70)  # crosses again, but the alert is off
    assert f.check(M0 + 80) == 0
    assert len(f.events()) == 1


def test_t5_2_repeat_crosses_fires_again_only_after_reentering(tmp_path):
    f = Feed(tmp_path)
    f.price(95, at=M0 + 5)
    a = f.create(condition="crosses_above", price=100, repeat=True)
    f.price(101, at=M0 + 20)
    assert f.check(M0 + 30) == 1
    f.price(102, at=M0 + 50)
    assert f.check(M0 + 60) == 0  # still above: no new crossing
    f.price(99, at=M0 + 80)
    assert f.check(M0 + 90) == 0  # below again
    f.price(100.5, at=M0 + 110)
    assert f.check(M0 + 120) == 1
    assert f.alert(a["id"])["enabled"] is True
    assert [e["time"] for e in f.events()] == [M0 + 120, M0 + 30]


def test_t5_2_repeat_gte_fires_once_per_visit(tmp_path):
    f = Feed(tmp_path)
    f.price(105, at=M0 + 5)
    f.create(condition="gte", price=100, repeat=True)
    assert f.check(M0 + 10) == 1  # already above: fires on the first check
    f.price(106, at=M0 + 30)
    assert f.check(M0 + 40) == 0  # still above: disarmed
    f.price(100, at=M0 + 70)
    assert f.check(M0 + 80) == 0  # exactly at L is not "left"
    f.price(99, at=M0 + 100)
    assert f.check(M0 + 110) == 0  # left: re-armed, but below
    f.price(100, at=M0 + 130)
    assert f.check(M0 + 140) == 1  # back exactly at L


def test_t5_2_wick_between_checks_counts_but_old_high_of_same_bar_does_not(tmp_path):
    f = Feed(tmp_path)
    f.price(98, 105, 98, at=M0 + 5)  # bar high 105 before the alert exists
    f.create(condition="crosses_above", price=103)
    assert f.check(M0 + 20) == 0  # same bar, no new high since the baseline
    f.price(104, 98, at=M0 + 25)  # a wick within the old high
    assert f.check(M0 + 30) == 0
    f.price(106, 98, at=M0 + 35)  # new high above the level, closed back below
    assert f.check(M0 + 40) == 1


def test_t5_2_lte_on_another_symbol_is_not_mixed_up(tmp_path):
    f = Feed(tmp_path)
    f.price(120, at=M0 + 5)
    r = f.client.put("/api/test/price", json={"symbol": "TEST:BAR", "price": 50})
    assert r.status_code == 204
    f.client.post("/api/alerts", json={"symbol": "TEST:BAR", "condition": "lte", "price": 60})
    f.create(condition="lte", price=100)
    assert f.check(M0 + 10) == 0  # TEST:FOO is at 120
    assert len(f.checker.check_symbol("TEST:BAR")) == 1


def test_t5_2_check_writes_only_state_columns(tmp_path):
    f = Feed(tmp_path)
    f.price(95, at=M0 + 5)
    a = f.create(condition="crosses_above", price=100, repeat=True)

    def edit_during_send():
        r = f.client.patch(f"/api/alerts/{a['id']}", json={"note": "edited", "price": 150})
        assert r.status_code == 200

    f.notifier.on_send = edit_during_send
    f.price(101, at=M0 + 20)
    assert f.check(M0 + 30) == 1
    alert = f.alert(a["id"])
    assert (alert["note"], alert["price"], alert["enabled"]) == ("edited", 150.0, True)
    assert alert["last_triggered_at"] == M0 + 30


def test_t5_2_alert_deleted_mid_check_records_no_event(tmp_path):
    f = Feed(tmp_path)
    f.price(95, at=M0 + 5)
    a = f.create(condition="crosses_above", price=100)
    f.notifier.on_send = lambda: f.client.delete(f"/api/alerts/{a['id']}")
    f.price(101, at=M0 + 20)
    assert f.check(M0 + 30) == 0
    assert f.events() == []
    assert f.client.get("/api/alerts").json() == []


def test_t5_2_failing_notifier_still_records_event(tmp_path):
    class Broken:
        name = "telegram"

        def send(self, text):
            raise NotifierError("HTTP 500: nope")

    f = Feed(tmp_path, notifier=Broken())
    f.price(95, at=M0 + 5)
    f.create(condition="crosses", price=100)
    f.price(101, at=M0 + 20)
    assert f.check(M0 + 30) == 1
    assert f.events()[0]["deliveries"] == {"telegram": "error: HTTP 500: nope"}


def test_t5_2_no_channels_gives_empty_deliveries(tmp_path):
    f = Feed(tmp_path)
    f.checker.notifiers = []
    f.price(95, at=M0 + 5)
    f.create(condition="crosses", price=100)
    f.price(101, at=M0 + 20)
    assert f.check(M0 + 30) == 1
    assert f.events()[0]["deliveries"] == {}


def test_t5_2_tick_follows_the_interval_and_isolates_failures(tmp_path):
    f = Feed(tmp_path)
    f.price(95, at=M0 + 5)
    f.create(condition="crosses_above", price=100, repeat=True)
    # an alert on an exchange that is not configured: its check fails every time
    nope = AlertCreate(symbol="NOPE:XYZ", condition="gte", price=1)
    f.app.state.db.create_alert(nope, M0, None)
    checked: list[str] = []
    real = f.checker.check_symbol

    def spy(symbol):
        checked.append(symbol)
        return real(symbol)

    f.checker.check_symbol = spy
    f.clock.now = M0 + 10
    f.checker.tick()
    assert checked == ["NOPE:XYZ", "TEST:FOO"]
    f.price(101, at=M0 + 40)
    f.checker.tick()  # 30 s later: TEST:* waits 60 s
    assert checked == ["NOPE:XYZ", "TEST:FOO"]
    assert f.events() == []
    f.clock.now = M0 + 70
    f.checker.tick()
    assert checked[2:] == ["NOPE:XYZ", "TEST:FOO"]
    assert len(f.events()) == 1

    f.checker.interval_override = 5
    f.clock.now = M0 + 75
    f.checker.tick()
    assert len(checked) == 6


# --- D11 trend line alerts (TEST feed + fake clock) -----------------------------------------


def put_lines(f: Feed, *drawings: dict) -> None:
    r = f.client.put("/api/drawings/TEST:FOO", json={"drawings": list(drawings)})
    assert r.status_code == 200, r.text


def rising(dy: float = 0) -> dict:
    return trend(M0, 90 + dy, M0 + 600, 110 + dy)


def test_d11_rising_line_through_a_flat_price_fires_once_and_disables(tmp_path):
    f = Feed(tmp_path)
    f.price(95, at=M0 + 5)
    put_lines(f, rising())
    a = f.create(condition="crosses_below", price=1, drawing_id="t1", note="n")
    assert a["price"] == pytest.approx(90 + 5 / 30)
    assert f.check(M0 + 30) == 0
    assert f.alert(a["id"])["price"] == pytest.approx(91)
    assert f.check(M0 + 120) == 0
    assert f.alert(a["id"])["price"] == pytest.approx(94)
    assert f.check(M0 + 160) == 1
    [event] = f.events()
    assert event["level"] == pytest.approx(90 + 160 / 30)
    assert event["price"] == 95
    assert "TEST:FOO crossed below trend line 95.3333 — now 95.00" in event["message"]
    assert event["message"].endswith("\nn")
    alert = f.alert(a["id"])
    assert alert["enabled"] is False
    assert alert["price"] == pytest.approx(90 + 160 / 30)
    f.price(80, 120, at=M0 + 170)
    assert f.check(M0 + 190) == 0
    assert len(f.events()) == 1


def test_d11_checker_uses_the_line_at_the_base_time_for_the_side(tmp_path):
    f = Feed(tmp_path)
    f.price(100, at=M0 + 5)
    put_lines(f, trend(M0, 110, M0 + 600, 90))
    f.create(condition="crosses", price=1, drawing_id="t1", repeat=True)
    f.price(98.5, at=M0 + 320)
    assert f.check(M0 + 330) == 0
    assert f.events() == []
    f.price(100, at=M0 + 340)
    assert f.check(M0 + 350) == 1
    [event] = f.events()
    assert event["level"] == pytest.approx(110 - 350 / 30)
    assert "crossed trend line 98.3333 — now 100.00" in event["message"]


def test_d11_line_moved_between_checks_is_followed(tmp_path):
    f = Feed(tmp_path)
    f.price(95, at=M0 + 5)
    put_lines(f, rising())
    a = f.create(condition="crosses", price=1, drawing_id="t1", repeat=True)
    assert f.check(M0 + 30) == 0
    f.clock.now = M0 + 40
    put_lines(f, rising(dy=10))
    assert f.alert(a["id"])["price"] == pytest.approx(100 + 40 / 30)
    assert f.check(M0 + 50) == 0
    f.price(103, at=M0 + 55)
    assert f.check(M0 + 60) == 1
    [event] = f.events()
    assert event["level"] == pytest.approx(102)
    assert "crossed trend line 102.00" in event["message"]


def test_d11_line_deleted_or_broken_between_checks(tmp_path):
    f = Feed(tmp_path)
    f.price(95, at=M0 + 5)
    put_lines(f, rising(), trend(M0, 90, M0 + 600, 110, tid="t2"))
    a = f.create(condition="crosses_below", price=1, drawing_id="t1", repeat=True)
    b = f.create(condition="crosses_below", price=1, drawing_id="t2", repeat=True)
    db = f.app.state.db
    before = {s.alert.id: s for s in db.enabled_alert_states("TEST:FOO")}

    f.clock.now = M0 + 10
    put_lines(f, trend(M0, 90, M0, 110, tid="t2"))
    assert [x["id"] for x in f.client.get("/api/alerts").json()] == [b["id"]]
    assert f.alert(b["id"])["price"] == pytest.approx(90 + 5 / 30)
    f.price(80, at=M0 + 190)
    assert f.check(M0 + 200) == 0
    db.set_drawings("TEST:FOO", [])
    assert f.check(M0 + 260) == 0
    [st] = db.enabled_alert_states("TEST:FOO")
    assert st == before[b["id"]]
    assert f.events() == []
    assert a["id"] in before


def test_d11_hline_alert_ignores_time_and_keeps_its_price(tmp_path):
    f = Feed(tmp_path)
    f.price(95, at=M0 + 5)
    put_lines(f, {"id": "h1", "type": "hline", "price": 100})
    a = f.create(condition="crosses_above", price=1, drawing_id="h1")
    assert f.check(M0 + 300) == 0
    assert f.alert(a["id"])["price"] == 100
    f.price(101, at=M0 + 310)
    assert f.check(M0 + 320) == 1
    [event] = f.events()
    assert event["level"] == 100
    assert "crossed above 100.00 — now 101.00" in event["message"]
    assert "trend" not in event["message"]
