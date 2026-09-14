"""Line-delimited JSON bridge; one persistent TDX socket, no candle requests."""
import contextlib
import json
import os
import re
import sys

from pytdx.hq import TdxHq_API
from pytdx.config.hosts import hq_hosts


def serve():
    api = None
    host_cursor = 0
    configured = os.environ.get('TDX_HQ_HOST')
    hosts = [(configured, int(os.environ.get('TDX_HQ_PORT', '7709')))] if configured else [(item[1], item[2]) for item in hq_hosts]
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            instrument = request.get('instrumentId', '')
            if not re.fullmatch(r'\d{6}\.(SH|SZ)', instrument):
                raise ValueError('当前仅支持沪深股票权息信息')
            # Library diagnostics must never corrupt the JSON channel.
            with contextlib.redirect_stdout(sys.stderr):
                if api is None:
                    for _ in range(min(6, len(hosts))):
                        host, port = hosts[host_cursor % len(hosts)]
                        host_cursor += 1
                        candidate = TdxHq_API(raise_exception=True, auto_retry=False)
                        try:
                            if candidate.connect(host, port, time_out=2):
                                api = candidate
                                break
                        except Exception:
                            pass
                        candidate.disconnect()
                if api is None:
                    raise ConnectionError('暂时无法连接权息数据源，请稍后重试')
                rows = api.get_xdxr_info(1 if instrument.endswith('.SH') else 0, instrument[:6])
                if not isinstance(rows, list):
                    raise ValueError('未收到有效权息数据')
            result = {'id': request.get('id'), 'ok': True, 'result': rows}
        except Exception as error:
            if api is not None:
                with contextlib.suppress(Exception):
                    api.disconnect()
            api = None
            result = {'id': request.get('id'), 'ok': False, 'error': str(error) or '权息数据请求失败'}
        print(json.dumps(result, ensure_ascii=True, allow_nan=False), flush=True)
    if api is not None:
        api.disconnect()


if __name__ == '__main__':
    serve()
