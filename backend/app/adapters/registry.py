"""Maps the EXCHANGE prefix of `EXCHANGE:TICKER` to a DataAdapter."""

import re

from app.adapters.base import AdapterError, DataAdapter
from app.models import SymbolInfo

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
        return [info for adapter in self.adapters.values() for info in adapter.search(query)]
