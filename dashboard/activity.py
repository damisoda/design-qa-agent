"""대시보드 공용 활동 기록. 여러 스레드에서 호출해도 안전하다.
기록은 data/activity.jsonl에 한 줄씩 추가되고, 메모리에도 최근 500개를 둔다."""

import json
import os
import threading
from collections import deque
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
LOG_PATH = os.path.join(DATA_DIR, "activity.jsonl")
_lock = threading.Lock()
_buf = deque(maxlen=500)


def _load():
    if not os.path.exists(LOG_PATH):
        return
    with open(LOG_PATH, encoding="utf-8") as f:
        for line in f:
            try:
                _buf.append(json.loads(line))
            except json.JSONDecodeError:
                continue


def log_activity(kind, message, data=None):
    entry = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "kind": kind,
             "message": message, "data": data or {}}
    with _lock:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        _buf.append(entry)
    return entry


def recent(limit=100):
    with _lock:
        return list(reversed(list(_buf)))[:limit]


_load()
