"""
Tầng 2 – AI diễn giải kết quả quét từ S3 bằng Gemini (REST).

Phạm vi đúng hai nhiệm vụ theo phương pháp luận:
  1. Tổng quan lỗ hổng theo nhóm.
  2. Gộp các remediation trùng lặp thành khối khuyến nghị có thứ tự ưu tiên.

Ràng buộc:
  - Mọi con số (số lượng, severity,CVSS) do backend/scanner tính, không lấy từ AI.
  - Mọi khuyến nghị phải bám vào finding_id/query_name có thật trong dữ liệu.
  - Findings + Terraform được che bí mật trước khi gửi ra ngoài.
"""

import asyncio
import hashlib
import io
import json
import logging
import os
import re
import time
import zipfile
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL_PRIMARY = os.getenv("GEMINI_MODEL_PRIMARY", "gemini-3.6-flash").strip()
GEMINI_MODEL_FALLBACK = os.getenv("GEMINI_MODEL_FALLBACK", "gemini-3.5-flash").strip()
GEMINI_MODEL_LAST = os.getenv("GEMINI_MODEL_LAST", "gemini-flash-lite-latest").strip()
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_TIMEOUT = float(os.getenv("GEMINI_TIMEOUT", "90"))
GEMINI_TEMPERATURE = float(os.getenv("GEMINI_TEMPERATURE", "0.1"))
GEMINI_MAX_ATTEMPTS = int(os.getenv("GEMINI_MAX_ATTEMPTS", "2"))
GEMINI_RETRY_DELAY = float(os.getenv("GEMINI_RETRY_DELAY", "3"))
GEMINI_MAX_OUTPUT_TOKENS = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "32768"))

AI_MAX_FINDINGS = int(os.getenv("AI_MAX_FINDINGS", "300"))
AI_MAX_IAC_CHARS = int(os.getenv("AI_MAX_IAC_CHARS", "30000"))
AI_MAX_RAW_CHARS = int(os.getenv("AI_MAX_RAW_CHARS", "20000"))
AI_CACHE_TTL = int(os.getenv("AI_CACHE_TTL", "600"))
MAX_RECOMMENDATIONS = 25

SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}


class AIModelError(RuntimeError):
    pass


def ai_configured() -> bool:
    return bool(GEMINI_API_KEY)


def ai_models() -> list[str]:
    return [
        m for m in dict.fromkeys(
            [GEMINI_MODEL_PRIMARY, GEMINI_MODEL_FALLBACK, GEMINI_MODEL_LAST]
        ) if m
    ]


# =========================================================
# Che bí mật
# =========================================================
_MASK_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
     "[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b"),
     "[REDACTED_AWS_ACCESS_KEY_ID]"),
    (re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b"),
     "[REDACTED_GITHUB_TOKEN]"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
     "[REDACTED_GITHUB_TOKEN]"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
     "[REDACTED_SLACK_TOKEN]"),
    (re.compile(r"https://hooks\.slack\.com/services/[A-Za-z0-9/_-]+"),
     "[REDACTED_SLACK_WEBHOOK]"),
    (re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b"),
     "[REDACTED_GOOGLE_API_KEY]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
     "[REDACTED_JWT]"),
    (re.compile(r"(?i)(authorization\s*:\s*(?:bearer|basic)\s+)\S+"),
     r"\1[REDACTED]"),
    (re.compile(
        r"""(?ix)
        ((?:aws_secret_access_key|secret_access_key|secret_key|password|passwd|pwd|
            api_key|apikey|access_token|private_key)\s*[=:]\s*)
        (["']?)([^"'\s,}\n]{4,})\2
        """
    ), r"\1\2[REDACTED]\2"),
]


def mask_secrets(text: str) -> tuple[str, int]:
    """Che các khóa bí mật phổ biến. Trả về (text_đã_che, số_lần_che)."""
    if not text:
        return text, 0
    total = 0
    for pattern, repl in _MASK_PATTERNS:
        text, n = pattern.subn(repl, text)
        total += n
    return text, total


# =========================================================
# Dựng ngữ cảnh từ kics-results.json / trivy-results.json
# =========================================================
def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n... [đã cắt bớt]"


def extract_kics_context(raw_kics: Optional[dict], max_chars: int = AI_MAX_RAW_CHARS) -> tuple[str, int]:
    """Metadata từng query KICS: severity, risk_score, CWE, mô tả, query_url, file mẫu."""
    if not isinstance(raw_kics, dict):
        return "", 0

    queries = []
    for q in raw_kics.get("queries") or []:
        if not isinstance(q, dict):
            continue
        files = []
        for f in q.get("files") or []:
            if isinstance(f, dict):
                name = _s(f.get("file_name"))
                line = f.get("line")
                files.append(f"{name}:{line}" if line is not None else name)
            if len(files) >= 3:
                break
        queries.append({
            "query_name": _s(q.get("query_name"), 200),
            "query_id": _s(q.get("query_id"), 60),
            "severity": _s(q.get("severity"), 20),
            "category": _s(q.get("category"), 120),
            "risk_score": _s(q.get("risk_score"), 20),
            "cwe": _s(q.get("cwe"), 30),
            "description": _s(q.get("description"), 400),
            "query_url": _s(q.get("query_url"), 300),
            "files": files,
        })

    text = json.dumps({"queries": queries}, ensure_ascii=False)
    text, masked = mask_secrets(text)
    return _truncate(text, max_chars), masked


def extract_trivy_context(raw_trivy: Optional[dict], max_chars: int = AI_MAX_RAW_CHARS) -> tuple[str, int]:
    """Secret finding + CVE (nếu có) từ trivy-results.json."""
    if not isinstance(raw_trivy, dict):
        return "", 0

    data: dict = {"secret_findings": [], "vulnerabilities": [], "notes": []}

    secret_report = raw_trivy.get("secret_scan_iac") or {}
    for result in secret_report.get("Results") or []:
        if not isinstance(result, dict):
            continue
        target = _s(result.get("Target"), 200)
        for item in result.get("Secrets") or []:
            if not isinstance(item, dict):
                continue
            data["secret_findings"].append({
                "target": target,
                "line": item.get("StartLine"),
                "rule_id": _s(item.get("RuleID"), 80),
                "title": _s(item.get("Title"), 160),
                "severity": _s(item.get("Severity"), 20),
                "category": _s(item.get("Category"), 80),
            })
            if len(data["secret_findings"]) >= 100:
                break

    # Pipeline xuat image_scans la list cac report Trivy khi co image,
    # hoac dict {"images": [], "message": ...} khi khong co image.
    image_report = raw_trivy.get("image_scans") or []
    if isinstance(image_report, dict):
        if image_report.get("message"):
            data["notes"].append(_s(image_report.get("message"), 200))
        images = image_report.get("images") or []
    elif isinstance(image_report, list):
        images = image_report
    else:
        images = []

    for image in images:
        if not isinstance(image, dict):
            continue
        artifact = _s(image.get("ArtifactName"), 200)
        for result in image.get("Results") or []:
            if not isinstance(result, dict):
                continue
            target = _s(result.get("Target"), 200)
            for vuln in result.get("Vulnerabilities") or []:
                if not isinstance(vuln, dict):
                    continue
                cvss = (vuln.get("CVSS") or {})
                score = None
                if isinstance(cvss, dict):
                    for key in ("nvd", "redhat", "ghsa"):
                        v = cvss.get(key)
                        if isinstance(v, dict) and v.get("V3Score"):
                            score = v.get("V3Score")
                            break
                data["vulnerabilities"].append({
                    "image": artifact,
                    "target": target,
                    "cve_id": _s(vuln.get("VulnerabilityID"), 40),
                    "package": _s(vuln.get("PkgName"), 120),
                    "installed_version": _s(vuln.get("InstalledVersion"), 60),
                    "fixed_version": _s(vuln.get("FixedVersion"), 60),
                    "severity": _s(vuln.get("Severity"), 20),
                    "cvss_v3": score,
                    "title": _s(vuln.get("Title"), 200),
                })
                if len(data["vulnerabilities"]) >= 100:
                    break

    text = json.dumps(data, ensure_ascii=False)
    text, masked = mask_secrets(text)
    return _truncate(text, max_chars), masked


def _kics_reference_map(raw_kics: Optional[dict]) -> dict[str, dict]:
    """query_name -> {query_url, risk_score, cwe} để gắn nguồn cho khuyến nghị."""
    refs: dict[str, dict] = {}
    if not isinstance(raw_kics, dict):
        return refs
    for q in raw_kics.get("queries") or []:
        if not isinstance(q, dict):
            continue
        name = _s(q.get("query_name")).strip()
        if not name:
            continue
        refs[name] = {
            "query_url": _s(q.get("query_url"), 300),
            "risk_score": _s(q.get("risk_score"), 20),
            "cwe": _s(q.get("cwe"), 30),
        }
    return refs


# =========================================================
# Dựng ngữ cảnh từ iac.zip
# =========================================================
_IAC_BOILERPLATE = {"provider.tf", "outputs.tf", "variables.tf", "terraform.tf", "versions.tf"}


def _iac_priority(findings: Optional[list[dict]]) -> dict[str, tuple[int, int]]:
    """Diem uu tien moi file .tf: (muc do nang nhat, -so finding). File KICS co dang iac/<path>."""
    score: dict[str, list[int]] = {}
    for f in findings or []:
        path = _s(f.get("file")).replace("\\", "/")
        if path.startswith("./"):
            path = path[2:]
        if path.startswith("iac/"):
            path = path[4:]
        if not path.endswith((".tf", ".tfvars")):
            continue
        sev = SEVERITY_ORDER.get(_s(f.get("severity")).upper(), 99)
        cur = score.setdefault(path, [99, 0])
        cur[0] = min(cur[0], sev)
        cur[1] += 1
    return {p: (v[0], -v[1]) for p, v in score.items()}


def extract_iac_context(
    zip_bytes: Optional[bytes],
    max_chars: int = AI_MAX_IAC_CHARS,
    findings: Optional[list[dict]] = None,
) -> tuple[str, list[str], int]:
    """
    Đọc tệp .tf/.tfvars trong iac.zip, che bí mật và cắt theo giới hạn ký tự.
    Bỏ file khung (provider/outputs...) và ưu tiên file có finding nặng nhất
    để ngân sách ký tự không bị tiêu vào file rỗng khi IaC chia theo nhiều region.
    """
    if not zip_bytes:
        return "", [], 0
    priority = _iac_priority(findings)

    chunks: list[str] = []
    files: list[str] = []
    masked_total = 0
    used = 0

    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = [
                info.filename for info in zf.infolist()
                if not info.is_dir()
                and info.filename.lower().endswith((".tf", ".tfvars"))
                and info.filename.rsplit("/", 1)[-1].lower() not in _IAC_BOILERPLATE
            ]
            names.sort(key=lambda n: (*priority.get(n.lstrip("./"), (99, 0)), n))
            for name in names:
                if used >= max_chars:
                    break
                try:
                    raw = zf.read(name)[:200_000]
                except Exception:
                    continue
                text = raw.decode("utf-8", errors="replace")
                text, masked = mask_secrets(text)
                masked_total += masked
                files.append(name)
                room = max_chars - used
                piece = f"\n# --- {name} ---\n{text}"
                if len(piece) > room:
                    piece = piece[:room] + "\n# [đã cắt bớt]"
                chunks.append(piece)
                used += len(piece)
    except zipfile.BadZipFile:
        logger.warning("[ai_analysis] iac.zip không hợp lệ")
        return "", [], 0

    return "".join(chunks), files, masked_total


# =========================================================
# Chuẩn hóa findings + thống kê deterministic
# =========================================================
def _s(value: Any, limit: Optional[int] = None) -> str:
    if value is None:
        return ""
    text = str(value)
    return text[:limit] if limit else text


def _normalize_findings(data: dict) -> list[dict]:
    findings: list[dict] = []
    seen_ids: set[str] = set()

    for idx, raw in enumerate(data.get("findings") or []):
        if not isinstance(raw, dict):
            continue
        fid = _s(raw.get("id")).strip() or f"finding-{idx + 1}"
        if fid in seen_ids:
            fid = f"{fid}-{idx + 1}"
        seen_ids.add(fid)

        severity = _s(raw.get("severity")).upper()
        if severity not in SEVERITY_ORDER:
            severity = "INFO"

        findings.append({
            "id": fid,
            "source": _s(raw.get("source") or raw.get("platform"), 40),
            "severity": severity,
            "query_name": _s(raw.get("query_name") or raw.get("title"), 200),
            "category": _s(raw.get("category"), 120),
            "file": _s(raw.get("file"), 200),
            "line": raw.get("line"),
            "resource": _s(
                ".".join(part for part in (_s(raw.get("resource_type")), _s(raw.get("resource_name"))) if part),
                200,
            ),
            "description": _s(raw.get("description"), 600),
            "expected": _s(raw.get("expected_value"), 300),
            "actual": _s(raw.get("actual_value"), 300),
            "remediation": _s(
                raw.get("remediation") or raw.get("resolution") or raw.get("remediation_guide"), 800
            ),
            "cwe": _s(raw.get("cwe"), 30),
            "risk_score": _s(raw.get("risk_score") or raw.get("cvss"), 20),
        })
    return findings


def build_groups(findings: list[dict]) -> list[dict]:
    """Nhóm lỗ hổng theo category. Toàn bộ số liệu do backend tính."""
    groups: dict[str, dict] = {}
    for f in findings:
        name = (f.get("category") or "").strip() or "Khác"
        g = groups.setdefault(name, {
            "group": name,
            "count": 0,
            "severities": {},
            "query_names": set(),
            "finding_ids": [],
        })
        g["count"] += 1
        sev = f["severity"]
        g["severities"][sev] = g["severities"].get(sev, 0) + 1
        if f["query_name"]:
            g["query_names"].add(f["query_name"])
        g["finding_ids"].append(f["id"])

    out = []
    for g in groups.values():
        severities = dict(sorted(g["severities"].items(), key=lambda kv: SEVERITY_ORDER.get(kv[0], 99)))
        worst = next(iter(severities), "INFO")
        out.append({
            "group": g["group"],
            "count": g["count"],
            "severities": severities,
            "query_names": sorted(g["query_names"]),
            "finding_ids": g["finding_ids"],
            "_worst": SEVERITY_ORDER.get(worst, 99),
        })
    out.sort(key=lambda g: (g["_worst"], -g["count"], g["group"]))
    for g in out:
        g.pop("_worst", None)
    return out


def _severity_totals(findings: list[dict]) -> dict[str, int]:
    totals = {sev: 0 for sev in SEVERITY_ORDER}
    for f in findings:
        totals[f["severity"]] = totals.get(f["severity"], 0) + 1
    return {sev: n for sev, n in totals.items() if n}


def _fallback_summary(group: dict) -> str:
    return f"Nhóm {group['group']} có {group['count']} finding cần xem xét."


# =========================================================
# Gọi Gemini
# =========================================================
def _build_prompt(
    stats: dict,
    findings_payload: list[dict],
    iac_context: str,
    kics_context: str = "",
    trivy_context: str = "",
) -> str:
    return f"""Bạn là trợ lý tổng hợp báo cáo an toàn hạ tầng cloud cho một dashboard.

BẠN CHỈ ĐƯỢC LÀM ĐÚNG HAI NHIỆM VỤ:
1. Viết tổng quan ngắn cho từng nhóm lỗ hổng đã được thống kê sẵn.
2. Gộp các remediation trùng lặp hoặc cùng nhóm lỗi thành các khối khuyến nghị, xếp theo thứ tự ưu tiên.

RÀNG BUỘC BẮT BUỘC:
- Chỉ dùng nhóm có trong phần THỐNG KÊ. Không tạo nhóm mới.
- KHÔNG viết bất kỳ con số thống kê nào trong nội dung (số lượng do hệ thống tự điền).
- Mỗi khuyến nghị phải gắn với finding_ids và/hoặc query_names CÓ THẬT trong dữ liệu bên dưới. Không có căn cứ thì bỏ, không bịa.
- Không bịa CVE, tài nguyên, kỹ thuật tấn công; không đổi severity.
- Có thể dùng risk_score, CWE của KICS và CVE/CVSS của Trivy khi có trong dữ liệu gốc; không tự tính điểm.
- Khuyến nghị phải dựa trên remediation/expected_value của scanner; bạn chỉ nén và diễn đạt lại.

THỐNG KÊ (do scanner tính, không sửa):
{json.dumps(stats, ensure_ascii=False, indent=1)}

FINDINGS (JSON, đã gộp từ merged-results.json):
{json.dumps(findings_payload, ensure_ascii=False)}

DỮ LIỆU KICS GỐC (metadata query: severity, risk_score, CWE, mô tả, query_url, file mẫu):
{kics_context or "(không có)"}

DỮ LIỆU TRIVY GỐC (secret finding; CVE/CVSS nếu có):
{trivy_context or "(không có)"}

NGỮ CẢNH TERRAFORM (đã che bí mật, chỉ để hiểu ngữ cảnh, không trích nguyên văn):
{iac_context or "(không có)"}

Trả về CHỈ một JSON object đúng schema sau, không markdown, không giải thích:
{{
  "group_summaries": [
    {{"group": "<tên nhóm đúng như THỐNG KÊ>", "summary": "<2-4 câu mô tả bối cảnh của nhóm>"}}
  ],
  "recommendations": [
    {{
      "priority": 1,
      "title": "<tiêu đề ngắn>",
      "finding_ids": ["<id có thật>"],
      "query_names": ["<query_name có thật>"],
      "action": "<các bước khắc phục, gộp từ remediation gốc>"
    }}
  ]
}}
"""


async def _generate(model: str, prompt: str) -> str:
    url = f"{GEMINI_BASE_URL}/{model}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": GEMINI_TEMPERATURE,
            "responseMimeType": "application/json",
            "maxOutputTokens": GEMINI_MAX_OUTPUT_TOKENS,
        },
    }
    headers = {"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=GEMINI_TIMEOUT) as client:
        response = await client.post(url, json=payload, headers=headers)

    if response.status_code >= 400:
        raise AIModelError(f"{model} HTTP {response.status_code}: {response.text[:300]}")

    body = response.json()
    try:
        parts = body["candidates"][0]["content"]["parts"]
        text = "".join(part.get("text", "") for part in parts)
    except (KeyError, IndexError, TypeError):
        raise AIModelError(f"{model} trả về rỗng: {json.dumps(body, ensure_ascii=False)[:300]}")

    if not text.strip():
        raise AIModelError(f"{model} trả về nội dung rỗng")
    return text


async def _generate_with_fallback(prompt: str) -> tuple[str, str]:
    """Thu lan luot cac model; loi tam thoi (503/429/5xx) thi backoff roi thu lai."""
    errors: list[str] = []
    for model in ai_models():
        for attempt in range(1, GEMINI_MAX_ATTEMPTS + 1):
            try:
                return model, await _generate(model, prompt)
            except (AIModelError, httpx.HTTPError) as exc:
                message = str(exc)
                errors.append(f"{model} (lan {attempt}): {message}")
                logger.warning("[ai_analysis] model %s lan %s that bai: %s", model, attempt, message)

                # 429 la het quota - thu lai ngay se vo ich, chuyen model luon.
                # Chi retry khi loi tam thoi phia may chu (5xx / qua tai).
                transient = any(
                    token in message
                    for token in ("500", "502", "503", "504", "UNAVAILABLE", "overloaded")
                )
                if not transient or "429" in message:
                    break
                if attempt < GEMINI_MAX_ATTEMPTS:
                    await asyncio.sleep(GEMINI_RETRY_DELAY * (2 ** (attempt - 1)))
    raise AIModelError("Không gọi được Gemini: " + " | ".join(errors))


def _auto_close_json(text: str) -> Optional[str]:
    """Đóng chuỗi/ngoặc còn hở nếu Gemini bị cắt giữa chừng."""
    stack: list[str] = []
    in_string = False
    escaped = False

    for ch in text:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if not stack:
                return None
            opener = stack.pop()
            if (ch == "}" and opener != "{") or (ch == "]" and opener != "["):
                return None

    if in_string:
        text += '"'
    text += "".join("}" if c == "{" else "]" for c in reversed(stack))
    return text


def _parse_truncated(text: str) -> Optional[dict]:
    """Cắt dần phần đuôi bị cụt rồi tự đóng JSON, trả về object hợp lệ gần nhất."""
    candidate = text
    for _ in range(300):
        closed = _auto_close_json(candidate)
        if closed:
            for attempt in (closed, re.sub(r",\s*([}\]])", r"\1", closed)):
                try:
                    data = json.loads(attempt)
                    if isinstance(data, dict):
                        return data
                except json.JSONDecodeError:
                    pass

        cut = max(candidate.rfind(","), candidate.rfind("{"), candidate.rfind("["))
        if cut <= 0:
            return None
        candidate = candidate[:cut]
    return None


def _parse_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", cleaned, flags=re.S).strip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    candidates = [cleaned]
    if start != -1 and end > start:
        candidates.append(cleaned[start:end + 1])

    for candidate in candidates:
        # Thu nguyen ban, roi sua trailing comma
        for attempt in (candidate, re.sub(r",\s*([}\]])", r"\1", candidate)):
            try:
                data = json.loads(attempt)
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                continue

    # Truong hop bi cat giua chung: tu dong dong ngoac
    if start != -1:
        repaired = _parse_truncated(cleaned[start:])
        if repaired is not None:
            logger.warning("[ai_analysis] JSON bi cat ngan, da tu dong sua (len=%d)", len(cleaned))
            return repaired

    raise AIModelError("Gemini trả về không phải JSON hợp lệ")


# =========================================================
# Hợp nhất output AI với số liệu deterministic
# =========================================================
def _normalize_ai_output(
    raw: dict,
    groups: list[dict],
    findings: list[dict],
    kics_meta: Optional[dict[str, dict]] = None,
) -> tuple[list[dict], list[dict]]:
    by_id = {f["id"]: f for f in findings}
    by_query: dict[str, list[dict]] = {}
    for f in findings:
        if f["query_name"]:
            by_query.setdefault(f["query_name"], []).append(f)

    # --- Tổng quan theo nhóm: số liệu lấy từ backend, AI chỉ điền summary ---
    name_map = {g["group"].lower(): g["group"] for g in groups}
    summaries: dict[str, str] = {}
    for item in raw.get("group_summaries") or []:
        if not isinstance(item, dict):
            continue
        name = _s(item.get("group")).strip()
        key = name_map.get(name.lower())
        if not key or key in summaries:
            continue
        summary = _s(item.get("summary"), 1200).strip()
        if summary:
            summaries[key] = summary

    overview = []
    for g in groups:
        summary, _ = mask_secrets(summaries.get(g["group"], ""))
        overview.append({
            "group": g["group"],
            "count": g["count"],
            "severities": g["severities"],
            "query_names": g["query_names"],
            "summary": summary or _fallback_summary(g),
        })

    # --- Khuyến nghị: phải truy vết được về finding có thật ---
    recommendations = []
    seen_titles: set[str] = set()
    for item in raw.get("recommendations") or []:
        if not isinstance(item, dict):
            continue

        action = _s(item.get("action"), 1500).strip()
        if not action:
            continue

        matched: dict[str, dict] = {}
        for fid in item.get("finding_ids") or []:
            fid = _s(fid)
            if fid in by_id:
                matched[fid] = by_id[fid]
        for qname in item.get("query_names") or []:
            qname = _s(qname)
            for f in by_query.get(qname, []):
                matched[f["id"]] = f

        if not matched:
            continue

        severities = {f["severity"] for f in matched.values()}
        severity = min(severities, key=lambda s: SEVERITY_ORDER.get(s, 99))

        title = _s(item.get("title"), 200).strip() or ", ".join(
            sorted({f["query_name"] for f in matched.values() if f["query_name"]})
        )[:200]
        if not title or title.lower() in seen_titles:
            continue
        seen_titles.add(title.lower())

        try:
            priority = int(item.get("priority"))
        except (TypeError, ValueError):
            priority = 99

        action, _ = mask_secrets(action)
        title, _ = mask_secrets(title)

        references = []
        for qname in sorted({f["query_name"] for f in matched.values() if f["query_name"]}):
            meta = (kics_meta or {}).get(qname)
            if meta and meta.get("query_url"):
                references.append({
                    "query_name": qname,
                    "url": meta["query_url"],
                    "risk_score": meta.get("risk_score") or "",
                    "cwe": meta.get("cwe") or "",
                })

        recommendations.append({
            "priority": priority,
            "title": title,
            "severity": severity,
            "action": action,
            "finding_ids": sorted(matched),
            "query_names": sorted({f["query_name"] for f in matched.values() if f["query_name"]})[:12],
            "references": references,
        })

    recommendations.sort(key=lambda r: (r["priority"], SEVERITY_ORDER.get(r["severity"], 99)))
    for idx, rec in enumerate(recommendations[:MAX_RECOMMENDATIONS], start=1):
        rec["priority"] = idx

    return overview, recommendations[:MAX_RECOMMENDATIONS]


# =========================================================
# Cache + entrypoint
# =========================================================
_CACHE: dict[str, tuple[float, dict]] = {}


def _cache_key(customer_id: str, data: dict, findings: list[dict]) -> str:
    stamp = (
        _s(data.get("scanned_at"))
        or _s((data.get("summary") or {}).get("scan_end"))
        or hashlib.md5(json.dumps(findings, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    )
    return f"{customer_id}:{stamp}"


def _mask_finding(finding: dict) -> tuple[dict, int]:
    masked = dict(finding)
    total = 0
    for key in ("description", "expected", "actual", "remediation", "resource"):
        value = masked.get(key)
        if value:
            masked[key], n = mask_secrets(value)
            total += n
    return masked, total


async def analyze_scan_results(
    customer_id: str,
    data: dict,
    iac_zip: Optional[bytes] = None,
    raw_kics: Optional[dict] = None,
    raw_trivy: Optional[dict] = None,
    force: bool = False,
) -> dict:
    """
    Dữ liệu đầu vào (giống backend đang dùng để hiển thị dashboard):
      - merged-results.json  (bắt buộc, đã gộp KICS + Trivy)
      - kics-results.json    (tùy chọn: risk_score, CWE, query_url, file)
      - trivy-results.json   (tùy chọn: secret finding, CVE/CVSS)
      - iac.zip              (tùy chọn: mã Terraform đã che bí mật)

    Số liệu trong kết quả do backend tính từ findings — không lấy từ AI.
    """
    if not ai_configured():
        raise AIModelError("GEMINI_API_KEY chưa được cấu hình trong backend/.env")

    findings = _normalize_findings(data)
    if not findings:
        raise AIModelError("Không có finding nào trong kết quả quét để phân tích.")

    groups = build_groups(findings)
    cache_key = _cache_key(customer_id, data, findings)

    if not force:
        cached = _CACHE.get(cache_key)
        if cached and time.time() - cached[0] < AI_CACHE_TTL:
            return cached[1]

    # Ưu tiên finding nghiêm trọng khi dữ liệu quá lớn
    ordered = sorted(findings, key=lambda f: (SEVERITY_ORDER.get(f["severity"], 99), f["id"]))
    selected = ordered[:AI_MAX_FINDINGS]

    masked_findings = []
    masked_total = 0
    for finding in selected:
        item, n = _mask_finding(finding)
        masked_findings.append(item)
        masked_total += n

    iac_context, iac_files, iac_masked = extract_iac_context(iac_zip, findings=findings)
    masked_total += iac_masked

    kics_context, kics_masked = extract_kics_context(raw_kics)
    masked_total += kics_masked

    trivy_context, trivy_masked = extract_trivy_context(raw_trivy)
    masked_total += trivy_masked

    stats = {
        "total_findings": len(findings),
        "sent_findings": len(selected),
        "groups": [
            {"group": g["group"], "count": g["count"], "severities": g["severities"]}
            for g in groups
        ],
        "severity_totals": _severity_totals(findings),
    }

    prompt = _build_prompt(stats, masked_findings, iac_context, kics_context, trivy_context)
    model, text = await _generate_with_fallback(prompt)
    try:
        raw = _parse_json(text)
    except AIModelError:
        # Thu lai voi payload gon hon va yeu cau JSON ngan gon
        logger.warning(
            "[ai_analysis] JSON parse failed (model=%s, len=%d). raw=%s",
            model, len(text), text[:1000],
        )
        retry_prompt = _build_prompt(
            stats, masked_findings[:80], iac_context, kics_context, trivy_context
        ) + "\n\nLƯU Ý BẮT BUỘC: chỉ trả về JSON hợp lệ, ngắn gọn, tối đa 8 khuyến nghị."
        model, text = await _generate_with_fallback(retry_prompt)
        try:
            raw = _parse_json(text)
        except AIModelError:
            logger.warning(
                "[ai_analysis] JSON parse failed after retry (model=%s, len=%d). raw=%s",
                model, len(text), text[:1000],
            )
            raise AIModelError(
                "Gemini trả về không phải JSON hợp lệ (đã thử lại). Xem log backend để biết chi tiết."
            )

    overview, recommendations = _normalize_ai_output(
        raw, groups, findings, _kics_reference_map(raw_kics)
    )

    result = {
        "customer_id": customer_id,
        "provider": "gemini",
        "model": model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total_findings": len(findings),
            "groups": len(groups),
            "severities": _severity_totals(findings),
            "masked_secrets": masked_total,
            "iac_files": iac_files,
            "sources": {
                "merged_results": True,
                "kics_results": bool(raw_kics),
                "trivy_results": bool(raw_trivy),
                "iac_zip": bool(iac_zip),
            },
        },
        "overview": overview,
        "recommendations": recommendations,
        "note": "Số liệu do scanner cung cấp; AI chỉ tổng hợp và diễn giải, không sinh số liệu mới.",
    }

    _CACHE[cache_key] = (time.time(), result)
    return result
