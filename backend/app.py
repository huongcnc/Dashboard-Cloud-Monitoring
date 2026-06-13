import json
from fastapi import FastAPI
from collections import deque

from ai_agent import analyze_logs
from parser import parse_syslog

app = FastAPI()


@app.get("/logs")
async def get_logs():
    with open(
        "log/sys.log",
        "r",
        encoding="utf-8",
        errors="ignore"
    ) as f:
        lines = list(deque(f, maxlen=100))

    return {
        "total": len(lines),
        "logs": parse_syslog(lines)
    }


@app.get("/api/alerts")
async def get_alerts():
    with open(
        "log/sys.log",
        "r",
        encoding="utf-8",
        errors="ignore"
    ) as f:
        logs = "".join(list(deque(f, maxlen=100)))

    # analyze_logs now returns a dict directly (already parsed)
    result = await analyze_logs(logs)
    return result