import json
import logging

import httpx
import pytest

from app.config import DEFAULT_CORS_ORIGINS, Settings
from app.notifiers import (
    SEND_TIMEOUT_S,
    LineNotifier,
    NotifierError,
    TelegramNotifier,
    build_notifiers,
    dispatch,
)

TG_TOKEN = "123:ABC"
LINE_TOKEN = "line-token-abc"


def settings(**kw) -> Settings:
    return Settings(db_path="x.db", cors_origins=DEFAULT_CORS_ORIGINS.split(","), **kw)


ALL = settings(
    telegram_bot_token=TG_TOKEN,
    telegram_chat_id="42",
    line_channel_token=LINE_TOKEN,
    line_user_id="U-test",
)


def client_with(handler) -> tuple[httpx.Client, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    return httpx.Client(transport=httpx.MockTransport(record)), seen


def ok(_: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"ok": True})


# --- T5.3 notifiers -------------------------------------------------------------------------


def test_t5_3_telegram_request():
    client, seen = client_with(ok)
    TelegramNotifier(TG_TOKEN, "42", client).send("สวัสดี 🔔")
    [req] = seen
    assert req.method == "POST"
    assert str(req.url) == "https://api.telegram.org/bot123:ABC/sendMessage"
    assert req.headers["content-type"] == "application/json"
    assert json.loads(req.content) == {"chat_id": "42", "text": "สวัสดี 🔔"}
    assert req.extensions["timeout"] == {k: SEND_TIMEOUT_S for k in req.extensions["timeout"]}


def test_t5_3_line_push_request():
    client, seen = client_with(ok)
    LineNotifier(LINE_TOKEN, "U-test", client).send("hi\nnote")
    [req] = seen
    assert req.method == "POST"
    assert str(req.url) == "https://api.line.me/v2/bot/message/push"
    assert req.headers["authorization"] == "Bearer line-token-abc"
    assert req.headers["content-type"] == "application/json"
    assert json.loads(req.content) == {
        "to": "U-test",
        "messages": [{"type": "text", "text": "hi\nnote"}],
    }
    assert req.extensions["timeout"]["read"] == SEND_TIMEOUT_S


@pytest.mark.parametrize(
    "kw, names",
    [
        ({}, []),
        ({"telegram_bot_token": TG_TOKEN}, []),
        ({"telegram_chat_id": "42"}, []),
        ({"line_channel_token": LINE_TOKEN}, []),
        ({"line_user_id": "U-test"}, []),
        ({"telegram_bot_token": TG_TOKEN, "telegram_chat_id": "42"}, ["telegram"]),
        ({"line_channel_token": LINE_TOKEN, "line_user_id": "U-test"}, ["line"]),
        (
            {
                "telegram_bot_token": TG_TOKEN,
                "telegram_chat_id": "42",
                "line_channel_token": LINE_TOKEN,
            },
            ["telegram"],
        ),
    ],
)
def test_t5_3_missing_settings_skip_the_channel(kw, names):
    assert [n.name for n in build_notifiers(settings(**kw))] == names


def test_t5_3_both_channels_through_dispatch():
    client, seen = client_with(ok)
    notifiers = build_notifiers(ALL, client)
    assert [n.name for n in notifiers] == ["telegram", "line"]
    assert dispatch(notifiers, "x") == {"telegram": "ok", "line": "ok"}
    assert [r.url.host for r in seen] == ["api.telegram.org", "api.line.me"]


def failing_telegram(error):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.telegram.org":
            if isinstance(error, Exception):
                raise error
            return error(request)
        return httpx.Response(200, json={})

    return handler


@pytest.mark.parametrize(
    "error, expected",
    [
        (lambda r: httpx.Response(500, text="Internal Server Error"), "error: HTTP 500: "),
        (httpx.ReadTimeout("timed out"), "error: timeout after 10 s"),
        (httpx.ConnectTimeout("timed out"), "error: timeout after 10 s"),
        # httpx errors and API answers may quote the URL, which holds the token
        (
            httpx.ConnectError("Cannot connect to https://api.telegram.org/bot123:ABC/sendMessage"),
            "error: ConnectError: ",
        ),
        (
            lambda r: httpx.Response(401, json={"description": f"Unauthorized {r.url}"}),
            "error: HTTP 401: ",
        ),
    ],
)
def test_t5_3_one_channel_failing_does_not_block_the_other(error, expected, caplog):
    caplog.set_level(logging.DEBUG)
    client, seen = client_with(failing_telegram(error))
    results = dispatch(build_notifiers(ALL, client), "x")
    assert results["line"] == "ok"
    assert results["telegram"].startswith(expected)
    assert [r.url.host for r in seen] == ["api.telegram.org", "api.line.me"]
    assert TG_TOKEN not in results["telegram"]
    assert TG_TOKEN not in caplog.text
    assert "telegram" in caplog.text  # the failure is logged, without the token


def test_t5_3_errors_do_not_chain_the_httpx_exception():
    def boom(_):
        raise httpx.ConnectError("https://api.telegram.org/bot123:ABC/sendMessage")

    client, _ = client_with(boom)
    with pytest.raises(NotifierError) as info:
        TelegramNotifier(TG_TOKEN, "42", client).send("x")
    assert TG_TOKEN not in str(info.value)
    assert info.value.__cause__ is None and info.value.__suppress_context__


def test_t5_3_line_token_absent_from_errors():
    client, _ = client_with(
        lambda r: httpx.Response(400, json={"message": r.headers["authorization"]})
    )
    result = dispatch([LineNotifier(LINE_TOKEN, "U-test", client)], "x")
    assert result["line"].startswith("error: HTTP 400: ")
    assert LINE_TOKEN not in result["line"]


def test_t5_3_unexpected_exception_is_contained():
    class Buggy:
        name = "buggy"

        def send(self, text):
            raise RuntimeError(f"secret {TG_TOKEN}")

    client, _ = client_with(ok)
    results = dispatch([Buggy(), *build_notifiers(ALL, client)], "x")
    assert results == {"buggy": "error: RuntimeError", "telegram": "ok", "line": "ok"}
