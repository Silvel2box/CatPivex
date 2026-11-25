"""Alert delivery channels: Telegram and LINE Messaging API push (browser alerts poll events)."""

import logging
from typing import Any, Protocol

import httpx

from app.config import Settings

log = logging.getLogger(__name__)
# httpx logs every request URL at INFO, and Telegram's URL contains the bot token.
logging.getLogger("httpx").setLevel(logging.WARNING)

SEND_TIMEOUT_S = 10.0
TELEGRAM_URL = "https://api.telegram.org/bot{token}/sendMessage"
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"


class NotifierError(Exception):
    """A send failed. The message never contains a token."""


class Notifier(Protocol):
    name: str  # key in AlertEvent.deliveries

    def send(self, text: str) -> None: ...


def _post(
    client: httpx.Client,
    url: str,
    payload: dict[str, Any],
    secret: str,
    headers: dict[str, str] | None = None,
) -> None:
    def scrub(s: str) -> str:
        return s.replace(secret, "***")

    try:
        resp = client.post(url, json=payload, headers=headers, timeout=SEND_TIMEOUT_S)
    except httpx.TimeoutException:
        raise NotifierError(f"timeout after {SEND_TIMEOUT_S:g} s") from None
    except httpx.HTTPError as exc:
        raise NotifierError(scrub(f"{type(exc).__name__}: {exc}")) from None
    if resp.status_code >= 400:
        raise NotifierError(scrub(f"HTTP {resp.status_code}: {resp.text[:200]}"))


class TelegramNotifier:
    name = "telegram"

    def __init__(self, token: str, chat_id: str, client: httpx.Client):
        self._token, self._chat_id, self._client = token, chat_id, client

    def send(self, text: str) -> None:
        url = TELEGRAM_URL.format(token=self._token)
        _post(self._client, url, {"chat_id": self._chat_id, "text": text}, self._token)


class LineNotifier:
    name = "line"

    def __init__(self, token: str, user_id: str, client: httpx.Client):
        self._token, self._user_id, self._client = token, user_id, client

    def send(self, text: str) -> None:
        payload = {"to": self._user_id, "messages": [{"type": "text", "text": text}]}
        headers = {"Authorization": f"Bearer {self._token}"}
        _post(self._client, LINE_PUSH_URL, payload, self._token, headers)


def build_notifiers(settings: Settings, client: httpx.Client | None = None) -> list[Notifier]:
    telegram = settings.telegram_bot_token and settings.telegram_chat_id
    line = settings.line_channel_token and settings.line_user_id
    if not (telegram or line):
        return []
    client = client or httpx.Client(timeout=SEND_TIMEOUT_S)
    out: list[Notifier] = []
    if telegram:
        out.append(TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id, client))
    if line:
        out.append(LineNotifier(settings.line_channel_token, settings.line_user_id, client))
    return out


def dispatch(notifiers: list[Notifier], text: str) -> dict[str, str]:
    results: dict[str, str] = {}
    for n in notifiers:
        try:
            n.send(text)
            results[n.name] = "ok"
        except NotifierError as exc:
            results[n.name] = f"error: {exc}"
        except Exception as exc:  # a bug, not a send failure; the type name is safe to keep
            results[n.name] = f"error: {type(exc).__name__}"
        if results[n.name] != "ok":
            log.warning("Alert delivery via %s failed: %s", n.name, results[n.name])
    return results
