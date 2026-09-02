import asyncio
import hashlib
import json
import os
import re
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Literal, Optional

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError, field_validator

from s3_client import get_latest_raw, get_latest_results, get_latest_terraform


load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "models/gemini-3.6-flash")
GEMINI_FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "models/gemini-2.5-flash")
GEMINI_TIMEOUT = float(os.getenv("GEMINI_TIMEOUT", "120"))
MAX_INPUT_CHARS = int(os.getenv("GEMINI_MAX_INPUT_CHARS", "120000"))
STORE_DIR = Path(os.getenv("ANALYSIS_STORE_DIR", "analysis_results"))

_jobs: dict[str, dict[str, Any]] = {}
_job_lock = asyncio.Lock()


class Correlation(BaseModel):
    finding_ids: list[str] = Field(min_length=1)
    relationship: str
    rationale: str
    confidence: Literal["LOW", "MEDIUM", "HIGH"]


class AttackStep(BaseModel):
    finding_id: Optional[str] = None
    resource: str = ""
    action: str


class AttackVector(BaseModel):
    id: str
    name: str
    severity: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    preconditions: list[str] = Field(default_factory=list)
    steps: list[AttackStep] = Field(min_length=1)
    business_impact: str
    confidence: Literal["LOW", "MEDIUM", "HIGH"]


class Assessment(BaseModel):
    overall_risk: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
    summary: str
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)


class Recommendation(BaseModel):
    title: str
    priority: Literal["P0", "P1", "P2", "P3"]
    finding_ids: list[str] = Field(default_factory=list)
    remediation: str
    terraform_hint: str = ""


class AnalysisResult(BaseModel):
    correlations: list[Correlation] = Field(default_factory=list)
    attack_vectors: list[AttackVector] = Field(default_factory=list)
    assessment: Assessment
    recommendations: list[Recommendation] = Field(default_factory=list)

    @field_validator("correlations", "attack_vectors", "recommendations")
    @classmethod
    def truncate_lists(cls, value: list[Any]) -> list[Any]:
        return value[:30]


def normalize_customer_id(customer_id: str) -> str:
    value = customer_id.strip().lower()
    return value if value.startswith("cust-") else f"cust-{value}"


async def start_analysis(customer_id: str) -> dict[str, Any]:
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not configured")

    normalized_customer = normalize_customer_id(customer_id)
    analysis_id = uuid.uuid4().hex
    job = {
        "analysis_id": analysis_id,
        "customer_id": normalized_customer,
        "status": "queued",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "completed_at": None,
        "result": None,
        "warnings": [],
        "error": None,
    }
    async with _job_lock:
        _jobs[analysis_id] = job
    return job


async def run_analysis_job(analysis_id: str, customer_id: str) -> None:
    job = _jobs.get(analysis_id)
    if job is None or job["status"] != "queued":
        return

    job.update(status="running", started_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    try:
        results = get_latest_results(customer_id)
        if results is None:
            raise FileNotFoundError("No scan results found for this customer")

        kics = get_latest_raw(customer_id, "kics")
        trivy = get_latest_raw(customer_id, "trivy")
        terraform = get_latest_terraform(customer_id)
        findings = prepare_findings(results, kics)
        context = build_context(results, findings, trivy, terraform)
        fingerprint = hashlib.sha256(json.dumps(context, ensure_ascii=False).encode()).hexdigest()
        cache_path = STORE_DIR / customer_id / f"{fingerprint}.json"
        if cache_path.exists():
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            job.update(
                status="completed",
                completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                result=cached["result"],
                warnings=cached.get("warnings", []),
                model=cached.get("model"),
                cached=True,
            )
            return

        raw_response, model = await call_gemini(context)
        parsed = parse_json_response(raw_response)
        result, warnings = validate_result(parsed, finding_ids={item["id"] for item in findings})
        if not terraform:
            warnings.append("Terraform files were not found in S3; analysis is based on scanner output only.")

        payload = {
            "result": result.model_dump(),
            "raw_response": raw_response,
            "warnings": warnings,
            "model": model,
            "customer_id": customer_id,
            "scanned_at": results.get("scanned_at"),
            "fingerprint": fingerprint,
        }
        STORE_DIR.joinpath(customer_id).mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        job.update(
            status="completed",
            completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            result=result.model_dump(),
            warnings=warnings,
            model=model,
            cached=False,
        )
    except Exception as exc:
        job.update(
            status="error",
            completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            error=str(exc),
        )


def get_analysis(analysis_id: str) -> Optional[dict[str, Any]]:
    return _jobs.get(analysis_id)


def prepare_findings(results: dict[str, Any], kics: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    remediation_by_name: dict[str, str] = {}
    if kics:
        for query in kics.get("queries", []):
            name = query.get("name") or query.get("query_name")
            if name and query.get("remediation"):
                remediation_by_name[name] = str(query["remediation"])[:2000]

    prepared: list[dict[str, Any]] = []
    for finding in results.get("findings", [])[:300]:
        query_name = finding.get("query_name", "")
        prepared.append({
            "id": finding.get("id") or uuid.uuid4().hex[:10],
            "query_name": query_name,
            "severity": finding.get("severity", "INFO"),
            "source": finding.get("source", ""),
            "category": finding.get("category", ""),
            "file": finding.get("file", ""),
            "line": finding.get("line"),
            "resource_type": finding.get("resource_type", ""),
            "resource_name": finding.get("resource_name", ""),
            "description": finding.get("description", ""),
            "expected_value": finding.get("expected_value", ""),
            "actual_value": finding.get("actual_value", ""),
            "remediation": remediation_by_name.get(query_name, ""),
        })
    return prepared


def sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: sanitize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_value(item) for item in value]
    if not isinstance(value, str):
        return value

    text = value
    text = re.sub(r"(?i)(aws_access_key_id\s*=\s*)[\"']?[A-Z0-9]{16,20}[\"']?", r"\1<masked>", text)
    text = re.sub(r"(?i)(aws_secret_access_key\s*=\s*)[\"']?[^\s\"']+[\"']?", r"\1<masked>", text)
    text = re.sub(r"(?i)((?:api[_-]?key|token|password|secret)[\"']?\s*[:=]\s*)[\"'][^\"']{8,}[\"']", r"\1\"<masked>\"", text)
    text = re.sub(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b", "<masked-aws-key>", text)
    return text


def build_context(
    results: dict[str, Any],
    findings: list[dict[str, Any]],
    trivy: Optional[dict[str, Any]],
    terraform: dict[str, str],
) -> dict[str, Any]:
    selected_terraform = select_terraform_context(terraform, findings)
    context = {
        "customer_id": results.get("customer_id"),
        "scanned_at": results.get("scanned_at"),
        "summary": sanitize_value(results.get("summary", {})),
        "top_categories": sanitize_value(results.get("top_categories", [])),
        "findings": sanitize_value(findings),
        "trivy_summary": sanitize_value(summarize_trivy(trivy)),
        "terraform_files": sanitize_value(selected_terraform),
        "terraform_available": bool(selected_terraform),
        "total_terraform_files": len(terraform),
    }
    encoded = json.dumps(context, ensure_ascii=False)
    if len(encoded) <= MAX_INPUT_CHARS:
        return context

    non_findings = {key: value for key, value in context.items() if key != "findings"}
    trim_budget = max(20000, MAX_INPUT_CHARS - len(json.dumps(non_findings, ensure_ascii=False)))
    context["findings"] = context["findings"][:120]
    context["terraform_files"] = trim_terraform(selected_terraform, trim_budget)
    return context


def summarize_trivy(trivy: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not trivy:
        return {"available": False}

    secrets: list[dict[str, Any]] = []
    for result in trivy.get("secret_scan_iac", {}).get("Results", []):
        for secret in result.get("Secrets", [])[:100]:
            secrets.append({
                "target": result.get("Target", ""),
                "rule_id": secret.get("RuleID", ""),
                "title": secret.get("Title", ""),
                "severity": secret.get("Severity", ""),
                "start_line": secret.get("StartLine"),
            })

    vulnerabilities: list[dict[str, Any]] = []
    image_scans = trivy.get("image_scans", [])
    if isinstance(image_scans, dict):
        image_scans = image_scans.get("images", image_scans.get("image_scans", []))
    if not isinstance(image_scans, list):
        image_scans = []
    for image in image_scans[:30]:
        if not isinstance(image, dict):
            continue
        artifact = image.get("ArtifactName", "")
        for result in image.get("Results", []):
            for vulnerability in result.get("Vulnerabilities", [])[:100]:
                vulnerabilities.append({
                    "image": artifact,
                    "id": vulnerability.get("VulnerabilityID", ""),
                    "package": vulnerability.get("PkgName", ""),
                    "severity": vulnerability.get("Severity", ""),
                    "fixed_version": vulnerability.get("FixedVersion", ""),
                })

    return {
        "available": True,
        "secrets": secrets[:150],
        "vulnerabilities": vulnerabilities[:300],
    }


def extract_hcl_blocks(text: str) -> list[dict[str, Any]]:
    header_pattern = re.compile(r"(?m)^(resource|data|module)\s+\"([^\"]+)\"\s+\"([^\"]+)\"\s*\{")
    blocks: list[dict[str, Any]] = []
    for match in header_pattern.finditer(text):
        start = match.start()
        cursor = match.end() - 1
        brace_depth = 0
        in_string = False
        escaped = False
        while cursor < len(text):
            char = text[cursor]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == "\"":
                    in_string = False
            else:
                if char == "\"":
                    in_string = True
                elif char == "{":
                    brace_depth += 1
                elif char == "}":
                    brace_depth -= 1
                    if brace_depth == 0:
                        end = cursor + 1
                        block_type, type_name, resource_name = match.groups()
                        blocks.append({
                            "kind": block_type,
                            "type": type_name,
                            "name": resource_name,
                            "id": f"{block_type}.{type_name}.{resource_name}",
                            "start": start,
                            "end": end,
                            "start_line": text.count("\n", 0, start) + 1,
                            "end_line": text.count("\n", 0, end) + 1,
                            "body": text[start:end],
                        })
                        break
            cursor += 1
    return blocks


def select_terraform_context(terraform: dict[str, str], findings: list[dict[str, Any]]) -> dict[str, str]:
    selected_blocks: dict[str, dict[str, Any]] = {}
    remaining = max(30000, int(MAX_INPUT_CHARS * 0.6))
    security_types = {
        "aws_security_group", "aws_security_group_rule", "aws_iam_role", "aws_iam_role_policy",
        "aws_iam_policy", "aws_instance", "aws_launch_configuration", "aws_s3_bucket",
        "aws_s3_bucket_public_access_block", "aws_ecs_service", "aws_ecs_task_definition",
        "aws_ecr_repository", "aws_lb", "aws_db_instance", "aws_rds_cluster",
    }

    for path, content in sorted(terraform.items()):
        if not path.endswith(".tf"):
            continue
        blocks = extract_hcl_blocks(content)
        block_by_id = {block["id"]: block for block in blocks}
        finding_blocks: set[int] = set()
        path_base = Path(path).name.lower()
        for finding in findings:
            finding_file = str(finding.get("file", "")).lower()
            if finding_file and path_base not in finding_file and finding_file not in path.lower():
                continue
            line = finding.get("line")
            if not isinstance(line, int):
                continue
            for block in blocks:
                if block["start_line"] <= line <= block["end_line"]:
                    finding_blocks.add(id(block))

        queue = deque(block for block in blocks if id(block) in finding_blocks)
        depth = {id(block): 0 for block in queue}
        while queue:
            block = queue.popleft()
            key = f"{path}::{block['id']}"
            selected_blocks[key] = {**block, "path": path}
            if depth[id(block)] >= 2:
                continue
            for candidate_id, candidate in block_by_id.items():
                candidate_key = f"{path}::{candidate_id}"
                if candidate_key in selected_blocks or id(candidate) in depth:
                    continue
                if re.search(rf"\b{re.escape(candidate_id)}\b", block["body"]):
                    depth[id(candidate)] = depth[id(block)] + 1
                    queue.append(candidate)

        for block in blocks:
            key = f"{path}::{block['id']}"
            if key not in selected_blocks and block["type"] in security_types:
                selected_blocks[key] = {**block, "path": path}

    grouped: dict[str, list[str]] = {}
    for key, block in selected_blocks.items():
        grouped.setdefault(block["path"], []).append(block["body"])

    output: dict[str, str] = {}
    for path, bodies in grouped.items():
        content = "\n\n".join(bodies)
        if len(content) <= remaining:
            output[path] = content
            remaining -= len(content)
    return trim_terraform(output, max(10000, remaining))


def trim_terraform(terraform: dict[str, str], budget: int) -> dict[str, str]:
    output: dict[str, str] = {}
    remaining = budget
    for path, content in sorted(terraform.items(), key=lambda item: len(item[1])):
        if remaining <= 1000:
            break
        if len(content) <= remaining:
            output[path] = content
            remaining -= len(content)
        else:
            output[path] = content[: remaining - 200] + "\n/* truncated */"
            remaining = 0
    return output


async def call_gemini(context: dict[str, Any]) -> tuple[str, str]:
    prompt = build_prompt(context)
    models = [GEMINI_MODEL]
    if GEMINI_FALLBACK_MODEL and GEMINI_FALLBACK_MODEL != GEMINI_MODEL:
        models.append(GEMINI_FALLBACK_MODEL)
    last_error: Optional[Exception] = None

    for model in models:
        model_path = model if model.startswith("models/") else f"models/{model}"
        url = f"https://generativelanguage.googleapis.com/v1beta/{model_path}:generateContent"
        body = {
            "systemInstruction": {
                "parts": [{
                    "text": "You are a cloud security architect. Analyze only supplied evidence, never invent findings or resources, and return valid JSON only. Write human-readable values in Vietnamese."
                }]
            },
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "topP": 0.8,
                "maxOutputTokens": 8192,
                "responseMimeType": "application/json",
            },
        }
        try:
            async with httpx.AsyncClient(timeout=GEMINI_TIMEOUT) as client:
                response = await client.post(url, params={"key": GEMINI_API_KEY}, json=body)
                response.raise_for_status()
                payload = response.json()
            candidates = payload.get("candidates", [])
            if not candidates:
                raise ValueError(f"Gemini returned no candidates: {payload.get('promptFeedback')}")
            parts = candidates[0].get("content", {}).get("parts", [])
            text = "".join(part.get("text", "") for part in parts).strip()
            if not text:
                raise ValueError("Gemini returned an empty response")
            return text, model
        except Exception as exc:
            last_error = exc
            response = getattr(exc, "response", None)
            status_code = response.status_code if response is not None else None
            if status_code not in {400, 404}:
                break

    raise RuntimeError(f"Gemini request failed: {last_error}")


def build_prompt(context: dict[str, Any]) -> str:
    schema = json.dumps(AnalysisResult.model_json_schema(), ensure_ascii=False, indent=2)
    context_json = json.dumps(context, ensure_ascii=False, indent=2)
    return f"""Phân tích bảo mật hạ tầng AWS từ dữ liệu scanner và Terraform dưới đây.

Nhiệm vụ:
1. Tìm tương quan giữa các findings: một lỗ hổng có thể là tiền đề cho lỗ hổng khác không.
2. Xây attack vector thực tế giữa các lỗ hổng và tài nguyên liên quan.
3. Đánh giá bức tranh tổng thể rủi ro hạ tầng.
4. Đưa ra remediation theo thứ tự ưu tiên.

Quy tắc bắt buộc:
- Chỉ dùng finding id, resource, file và dữ liệu trong input.
- Không bịa CVE, resource, IP, port, IAM permission hoặc attack chain không có bằng chứng.
- Nếu thiếu Terraform hoặc bằng chứng, ghi nhận giới hạn trong rationale và giảm confidence.
- Mọi reasoning phải dựa trên evidence trong input.
- Output chỉ là một JSON object khớp schema, không markdown.

JSON schema:
{schema}

Input:
{context_json}
"""


def strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    return stripped


def parse_json_response(text: str) -> dict[str, Any]:
    value = json.loads(strip_code_fence(text))
    if not isinstance(value, dict):
        raise ValueError("Gemini response must be a JSON object")
    return value


def validate_result(value: dict[str, Any], finding_ids: set[str]) -> tuple[AnalysisResult, list[str]]:
    warnings: list[str] = []
    try:
        result = AnalysisResult.model_validate(value)
    except ValidationError as exc:
        raise ValueError(f"Gemini response does not match analysis schema: {exc}") from exc

    valid_correlations: list[Correlation] = []
    for correlation in result.correlations:
        valid_ids = [finding_id for finding_id in correlation.finding_ids if finding_id in finding_ids]
        dropped = set(correlation.finding_ids) - set(valid_ids)
        if dropped:
            warnings.append(f"Dropped unknown finding IDs from correlation: {', '.join(sorted(dropped))}")
        if valid_ids:
            correlation.finding_ids = valid_ids
            valid_correlations.append(correlation)

    valid_vectors: list[AttackVector] = []
    for vector in result.attack_vectors:
        for step in vector.steps:
            if step.finding_id and step.finding_id not in finding_ids:
                warnings.append(f"Dropped unknown finding ID from attack step: {step.finding_id}")
                step.finding_id = None
        valid_vectors.append(vector)

    valid_recommendations: list[Recommendation] = []
    for recommendation in result.recommendations:
        valid_ids = [finding_id for finding_id in recommendation.finding_ids if finding_id in finding_ids]
        dropped = set(recommendation.finding_ids) - set(valid_ids)
        if dropped:
            warnings.append(f"Dropped unknown finding IDs from recommendation: {', '.join(sorted(dropped))}")
        recommendation.finding_ids = valid_ids
        valid_recommendations.append(recommendation)

    result.correlations = valid_correlations
    result.attack_vectors = valid_vectors
    result.recommendations = valid_recommendations
    return result, list(dict.fromkeys(warnings))
