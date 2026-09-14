"""Small line-delimited JSON bridge for the BaoStock Python client.

The Node local-data service owns persistence and scheduling.  This process only
keeps one BaoStock login session alive and translates the official Python
client's result sets into JSON objects.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
from typing import Any


def reply(request_id: Any, ok: bool, result: Any = None, error: str | None = None) -> None:
    payload = {"id": request_id, "ok": ok}
    if ok:
        payload["result"] = result
    else:
        payload["error"] = error or "BaoStock 请求失败"
    # Windows may select the GBK console encoding for a pipe.  Keep the
    # line-delimited protocol ASCII-only so Node can decode it identically on
    # every locale; JSON.parse restores the escaped Chinese characters.
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def rows_from_result(result: Any) -> list[dict[str, Any]]:
    fields = list(getattr(result, "fields", []) or [])
    rows: list[dict[str, Any]] = []
    while str(getattr(result, "error_code", "0")) == "0" and result.next():
        values = result.get_row_data()
        rows.append({field: values[index] if index < len(values) else None for index, field in enumerate(fields)})
    error_code = str(getattr(result, "error_code", "0"))
    if error_code != "0":
        raise RuntimeError(str(getattr(result, "error_msg", "BaoStock 返回错误")))
    return rows


class BaoStockSession:
    def __init__(self) -> None:
        try:
            import baostock as bs  # type: ignore
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "未安装 BaoStock Python 包，请执行：python -m pip install -r web/local-data/requirements.txt"
            ) from exc
        self.bs = bs
        with open(os.devnull, "w", encoding="utf-8") as sink:
            with contextlib.redirect_stdout(sink):
                login = bs.login()
        if str(getattr(login, "error_code", "0")) != "0":
            raise RuntimeError(str(getattr(login, "error_msg", "BaoStock 登录失败")))

    def catalog(self) -> list[dict[str, Any]]:
        basic = rows_from_result(self.bs.query_stock_basic())
        merged: dict[str, dict[str, Any]] = {
            str(row.get("code", "")).lower(): dict(row) for row in basic if row.get("code")
        }
        # query_all_stock supplies the currently listed universe and names for
        # symbols whose basic record is incomplete.  It is optional because an
        # older BaoStock build may not expose it consistently.
        try:
            listed = rows_from_result(self.bs.query_all_stock(day=None))
        except Exception:
            listed = []
        for row in listed:
            code = str(row.get("code", "")).lower()
            if not code:
                continue
            current = merged.setdefault(code, {})
            for key, value in row.items():
                if value not in (None, ""):
                    current[key] = value
            current.setdefault("status", "1")
        return list(merged.values())

    def history(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        code = str(request.get("code", "")).strip().lower()
        start_date = str(request.get("startDate", "1990-01-01"))
        end_date = str(request.get("endDate", "2100-01-01"))
        frequency = str(request.get("frequency", "d"))
        adjustflag = str(request.get("adjustflag", "2"))
        fields = str(request.get(
            "fields",
            "date,code,open,high,low,close,preclose,volume,amount,adjustflag,turn,tradestatus,pctChg,isST",
        ))
        if not code or "." not in code:
            raise ValueError("BaoStock 证券代码格式不正确")
        result = self.bs.query_history_k_data_plus(
            code,
            fields,
            start_date=start_date,
            end_date=end_date,
            frequency=frequency,
            adjustflag=adjustflag,
        )
        return rows_from_result(result)

    def trade_dates(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        result = self.bs.query_trade_dates(
            start_date=str(request.get("startDate", "1990-01-01")),
            end_date=str(request.get("endDate", "2100-01-01")),
        )
        return rows_from_result(result)

    def close(self) -> None:
        with open(os.devnull, "w", encoding="utf-8") as sink:
            with contextlib.redirect_stdout(sink):
                self.bs.logout()


def main() -> None:
    session: BaoStockSession | None = None
    for line in sys.stdin:
        request: dict[str, Any] = {}
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if request.get("command") == "shutdown":
                if session:
                    session.close()
                reply(request_id, True, None)
                return
            if session is None:
                session = BaoStockSession()
            command = request.get("command")
            if command == "catalog":
                result = session.catalog()
            elif command == "history":
                result = session.history(request)
            elif command == "trade_dates":
                result = session.trade_dates(request)
            else:
                raise ValueError(f"不支持的 BaoStock 命令：{command}")
            reply(request_id, True, result)
        except Exception as exc:  # keep the long-lived bridge alive for retryable requests
            reply(request.get("id") if isinstance(request, dict) else None, False, error=str(exc))
    if session:
        session.close()


if __name__ == "__main__":
    main()
