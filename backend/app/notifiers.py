"""Alert delivery channels. Browser notifications are not here: the frontend polls
GET /api/alerts/events instead. To add a channel, implement Notifier and add it to
build_notifiers().

- Telegram: POST https://api.telegram.org/bot<token>/sendMessage  json {chat_id, text}
- LINE Messaging API push (not LINE Notify, which has shut down):
  POST https://api.line.me/v2/bot/message/push  header Authorization: Bearer <channel token>
  json {to: <user id>, messages: [{type: "text", text}]}
Both use httpx with a timeout of SEND_TIMEOUT_S; tests pass a client with a mock transport.
"""

from typing import Protocol

import httpx

from app.config import Settings

SEND_TIMEOUT_S = 10.0


class NotifierError(Exception):
    """A send failed. The message must never contain a token (Telegram puts it in the URL,
    and httpx errors quote the URL)."""


class Notifier(Protocol):
    name: str  # "telegram" | "line": the key in AlertEvent.deliveries

    def send(self, text: str) -> None:
        """Delivers `text` or raises NotifierError (HTTP status >= 400, timeout, network)."""
        ...


def build_notifiers(settings: Settings, client: httpx.Client | None = None) -> list[Notifier]:
    """One notifier per channel whose settings are both set; [] if none."""
    raise NotImplementedError


def dispatch(notifiers: list[Notifier], text: str) -> dict[str, str]:
    """Sends through every notifier; one failing never stops the others.
    Returns name -> "ok" | "error: <NotifierError message>"."""
    raise NotImplementedError
