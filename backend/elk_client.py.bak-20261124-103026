"""Small Elasticsearch client for live logs and Kibana Security alerts."""

import os
from typing import Any

import httpx


ELASTICSEARCH_URL = os.getenv("ELASTICSEARCH_URL", "https://192.168.48.10:9200").rstrip("/")
ELASTICSEARCH_USERNAME = os.getenv("ELASTICSEARCH_USERNAME", "elastic")
ELASTICSEARCH_PASSWORD = os.getenv("ELASTICSEARCH_PASSWORD", "")
ELASTICSEARCH_VERIFY_TLS = os.getenv("ELASTICSEARCH_VERIFY_TLS", "false").lower() in {"1", "true", "yes"}
ELASTICSEARCH_TIMEOUT = float(os.getenv("ELASTICSEARCH_TIMEOUT", "10"))
ELASTIC_LOG_INDEX = os.getenv("ELASTIC_LOG_INDEX", "filebeat-*")
ELASTIC_ALERT_INDEX = os.getenv("ELASTIC_ALERT_INDEX", ".alerts-security.alerts-default")


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=ELASTICSEARCH_URL,
        auth=(ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD),
        verify=ELASTICSEARCH_VERIFY_TLS,
        timeout=ELASTICSEARCH_TIMEOUT,
    )


async def _search(index: str, body: dict[str, Any]) -> dict[str, Any]:
    async with _client() as client:
        response = await client.post(f"/{index}/_search", json=body)
        response.raise_for_status()
        return response.json()


def _value(source: dict[str, Any], *paths: str, default: Any = None) -> Any:
    for path in paths:
        # Kibana often stores dotted ECS fields as literal keys.
        if path in source and source[path] not in (None, ""):
            return source[path]
        current: Any = source
        for part in path.split("."):
            if not isinstance(current, dict) or part not in current:
                current = None
                break
            current = current[part]
        if current not in (None, ""):
            return current
    return default


def _log_level(source: dict[str, Any]) -> str:
    level = str(_value(source, "log.level", "event.severity", default="")).lower()
    if level in {"error", "critical", "fatal", "alert", "emergency"}:
        return "error"
    if level in {"warn", "warning"}:
        return "warn"
    if level in {"info", "notice"}:
        return "info"
    message = str(_value(source, "message", "error.message", default="")).lower()
    if any(word in message for word in ("error", "failed", "failure", "denied", "fatal")):
        return "error"
    if any(word in message for word in ("warn", "blocked", "invalid")):
        return "warn"
    return "debug"


async def fetch_logs(page: int = 1, page_size: int = 50, query: str = "") -> dict[str, Any]:
    page = max(page, 1)
    page_size = max(1, min(page_size, 200))
    result = await _search(ELASTIC_LOG_INDEX, {
        "track_total_hits": True,
        "from": (page - 1) * page_size,
        "size": page_size,
        "sort": [{"@timestamp": {"order": "desc", "unmapped_type": "date"}}],
        "query": ({"bool": {"should": [
            {"multi_match": {"query": query, "fields": ["message", "host.name", "host.hostname", "user.name", "process.name", "process.args", "system.auth.sudo.command", "event.dataset", "kibana.alert.rule.rule_id"], "operator": "and"}},
            {"ids": {"values": [query]}}
        ], "minimum_should_match": 1}} if query else {"match_all": {}}),
    })
    logs = []
    for hit in result.get("hits", {}).get("hits", []):
        source = hit.get("_source", {})
        message = _value(source, "message", "error.message", default="")
        logs.append({
            "id": hit.get("_id"),
            "timestamp": _value(source, "@timestamp"),
            "host": _value(source, "host.name", "host.hostname", default=""),
            "service": _value(source, "service.name", "system.syslog.program", "event.dataset", default=""),
            "message": message,
            "level": _value(source, "log.level", "event.severity", default=""),
            "event_kind": _value(source, "event.kind", default=""),
            "dataset": _value(source, "event.dataset", default=""),
            "process": _value(source, "process.name", default=""),
            "user": _value(source, "user.name", "user.effective.name", default=""),
            "command": _value(source, "system.auth.sudo.command", default=""),
            "document_id": hit.get("_id"),
            "index": hit.get("_index"),
            "technique_id": _value(source, "threat.technique.id", "rule.threat.technique.id"),
            "technique_name": _value(source, "threat.technique.name", "rule.threat.technique.name"),
            "error_name": message,
            "raw": source,
        })
    total = result.get("hits", {}).get("total", {}).get("value", len(logs))
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "logs": logs,
        "source": ELASTIC_LOG_INDEX,
    }


async def fetch_alerts(page: int = 1, page_size: int = 50, query: str = "") -> dict[str, Any]:
    page = max(page, 1)
    page_size = max(1, min(page_size, 200))
    result = await _search(ELASTIC_ALERT_INDEX, {
        "track_total_hits": True,
        "from": (page - 1) * page_size,
        "size": page_size,
        "sort": [{"@timestamp": {"order": "desc", "unmapped_type": "date"}}],
        "query": {"multi_match": {"query": query, "fields": ["kibana.alert.rule.name", "kibana.alert.rule.description", "kibana.alert.reason", "kibana.alert.rule.rule_id", "host.name", "user.name", "message", "kibana.alert.ancestors.id"], "operator": "and"}} if query else {"match_all": {}},
    })
    alerts = []
    for hit in result.get("hits", {}).get("hits", []):
        source = hit.get("_source", {})
        rule_name = _value(source, "kibana.alert.rule.name", "kibana.alert.rule.rule_name", "rule.name", default="")
        severity = str(_value(source, "kibana.alert.severity", "event.severity", default="")).upper()
        alerts.append({
            "id": hit.get("_id"),
            "timestamp": _value(source, "@timestamp", "kibana.alert.original_time"),
            "severity": severity,
            "category": _value(source, "kibana.alert.rule.category", "event.category", default=""),
            "title": rule_name,
            "description": _value(source, "kibana.alert.reason", "kibana.alert.rule.description", "kibana.alert.rule.parameters.description", "message", default=""),
            "recommendation": _value(source, "kibana.alert.rule.parameters.note", "kibana.alert.rule.parameters.recommendation", default=""),
            "status": _value(source, "kibana.alert.workflow_status", default=""),
            "rule_id": _value(source, "kibana.alert.rule.uuid", "kibana.alert.rule.rule_id"),
            "risk_score": _value(source, "kibana.alert.risk_score", "kibana.alert.rule.risk_score", "kibana.alert.rule.parameters.risk_score"),
            "rule_type": _value(source, "kibana.alert.rule.type", "kibana.alert.rule.parameters.type"),
            "host": _value(source, "host.name", "host.hostname", "host.name"),
            "user": _value(source, "user.name", "user.effective.name"),
            "mitre_attack": _value(source, "kibana.alert.rule.threat", "kibana.alert.rule.parameters.threat", "threat"),
            "raw": source,
        })
    total = result.get("hits", {}).get("total", {}).get("value", len(alerts))
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "alerts": alerts,
        "source": ELASTIC_ALERT_INDEX,
    }
