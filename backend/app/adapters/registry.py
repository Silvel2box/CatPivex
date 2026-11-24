"""Maps the EXCHANGE prefix of `EXCHANGE:TICKER` to a DataAdapter."""

import logging
import re

from app.adapters.base import AdapterError, DataAdapter
from app.models import SymbolInfo

log = logging.getLogger(__name__)

SEARCH_LIMIT = 30
SYMBOL_RE = re.compile(r"^([A-Z0-9]+):([A-Z0-9._=^-]+)$")


def parse_symbol(symbol: str) -> tuple[str, str]:
    """'binance:btcusdt' -> ('BINANCE', 'BTCUSDT'). Raises invalid_symbol if malformed."""
    m = SYMBOL_RE.match(symbol.strip().upper())
    if not m:
        raise AdapterError(
            "invalid_symbol", f"Symbol must look like EXCHANGE:TICKER, got {symbol!r}"
        )
    return m.group(1), m.group(2)


class Registry:
    def __init__(self, adapters: dict[str, DataAdapter]):
        self.adapters = adapters

    def resolve(self, symbol: str) -> tuple[DataAdapter, str, str]:
        """Returns (adapter, canonical 'EXCHANGE:TICKER', ticker)."""
        exchange, ticker = parse_symbol(symbol)
        adapter = self.adapters.get(exchange)
        if adapter is None:
            known = ", ".join(sorted(self.adapters))
            raise AdapterError("invalid_symbol", f"Unknown exchange {exchange!r} (known: {known})")
        return adapter, f"{exchange}:{ticker}", ticker

    def search(self, query: str) -> list[SymbolInfo]:
        """Merged results of every adapter (one failing is skipped), best matches first."""
        bare = query.strip().upper().split(":")[-1]
        found: dict[str, SymbolInfo] = {}
        for exchange, adapter in self.adapters.items():
            try:
                results = adapter.search(query)
            except Exception:
                log.exception("Symbol search failed for %s (query %r)", exchange, query)
                continue
            for info in results:
                found.setdefault(info.symbol, info)

        def rank(info: SymbolInfo) -> int:
            ticker = info.symbol.split(":", 1)[-1]
            return 0 if ticker == bare else 1 if ticker.startswith(bare) else 2

        return sorted(found.values(), key=rank)[:SEARCH_LIMIT]
