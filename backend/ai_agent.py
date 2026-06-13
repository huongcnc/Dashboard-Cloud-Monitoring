import os
import json
import asyncio
import logging
from dotenv import load_dotenv
from crewai import Agent, Task, Crew, LLM

load_dotenv()

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# LLM pool: primary + fallback models
# Thứ tự ưu tiên: gemini-2.5-flash → gemini-2.0-flash → gemini-1.5-flash
# ─────────────────────────────────────────────
_GEMINI_KEY = os.getenv("GEMINI_API_KEY")

LLM_PRIMARY  = LLM(model="gemini/gemini-2.5-flash",  api_key=_GEMINI_KEY)
LLM_FALLBACK = LLM(model="gemini/gemini-2.0-flash",  api_key=_GEMINI_KEY)
LLM_LAST     = LLM(model="gemini/gemini-1.5-flash",  api_key=_GEMINI_KEY)

LLM_POOL = [LLM_PRIMARY, LLM_FALLBACK, LLM_LAST]

# Retry config
MAX_RETRIES  = 3          # số lần thử lại mỗi model
RETRY_DELAY  = 5          # giây chờ ban đầu (exponential backoff)

llm = LLM_PRIMARY         # default; sẽ được override khi cần fallback

# ─────────────────────────────────────────────
# Agent 1: Log Parser
# Nhiệm vụ: trích xuất các trường có cấu trúc từ raw log
# ─────────────────────────────────────────────
parser_agent = Agent(
    role="Log Parser",
    goal="Extract structured fields from raw Linux syslog lines",
    backstory="""
You are a log parsing specialist. You receive raw syslog text and extract
structured fields from each line. You understand common syslog formats:

  <timestamp> <hostname> <process>[<pid>]: <message>

Examples of fields you extract:
  - timestamp  : e.g. "Jun  7 03:21:44"
  - hostname   : e.g. "ubuntu-server"
  - process    : e.g. "sshd", "sudo", "kernel", "dockerd"
  - pid        : e.g. "1234" (or null if absent)
  - message    : the remainder of the line

Return ONLY a JSON array. Each element represents one log line:

[
  {
    "timestamp": "...",
    "hostname": "...",
    "process": "...",
    "pid": "...",
    "message": "..."
  }
]

If a field cannot be determined, use null. Do not output anything except the JSON array.
""",
    llm=llm,
    verbose=False
)

# ─────────────────────────────────────────────
# Agent 2: Security Analyst
# Nhiệm vụ: áp dụng rule detection bằng prompt + model knowledge
# ─────────────────────────────────────────────
security_agent = Agent(
    role="SOC Security Analyst",
    goal="Detect security threats from structured Linux log entries",
    backstory="""
You are a senior SOC analyst with deep knowledge of Linux security events.

Using your expertise, detect the following threat categories from structured log entries:

  1. SSH Brute Force
     - Rule: multiple "Failed password" or "Invalid user" from same IP within short time
     - Severity: HIGH

  2. Failed Login / Authentication Failure
     - Rule: "authentication failure", "Failed password", "pam_unix" with auth failures
     - Severity: MEDIUM

  3. Privilege Escalation
     - Rule: "sudo" commands, "su" switches, "NOPASSWD" usage, "TTY=unknown"
     - Severity: HIGH

  4. Firewall / Network Block
     - Rule: "kernel: [UFW BLOCK]", "iptables DROP", "DPT=" with repeated sources
     - Severity: MEDIUM

  5. Service Restart / Crash Anomaly
     - Rule: "systemd" with "start request repeated", "failed", "restarting"
     - Severity: MEDIUM

  6. Docker / Container Anomaly
     - Rule: "dockerd" errors, container OOM, unexpected container exits
     - Severity: MEDIUM

  7. Malware / Suspicious Process
     - Rule: unusual process names, base64 in commands, reverse shell patterns,
             crontab modifications, /tmp execution
     - Severity: CRITICAL

For each detected threat, produce one alert. Correlate related events into a single alert
when they share the same source IP, process, or time window (within ~60 seconds).

Return ONLY a JSON object in this exact format, with no markdown, no extra text:

{
  "alerts": [
    {
      "timestamp": "<timestamp of first related event>",
      "severity": "<CRITICAL|HIGH|MEDIUM|LOW|INFO>",
      "category": "<threat category>",
      "title": "<short descriptive title>",
      "description": "<what was detected and why it is suspicious>",
      "recommendation": "<actionable remediation step>"
    }
  ]
}

If no threats are found, return: {"alerts": []}
""",
    llm=llm,
    verbose=False
)


def _build_crew(active_llm: LLM, raw_logs: str) -> tuple[Crew, Task]:
    """Tạo Crew với LLM được chỉ định, trả về (crew, detect_task)."""

    _parser = Agent(
        role="Log Parser",
        goal="Extract structured fields from raw Linux syslog lines",
        backstory=parser_agent.backstory,
        llm=active_llm,
        verbose=False
    )

    _analyst = Agent(
        role="SOC Security Analyst",
        goal="Detect security threats from structured Linux log entries",
        backstory=security_agent.backstory,
        llm=active_llm,
        verbose=False
    )

    parse_task = Task(
        description=f"""
Parse the following raw syslog lines into a structured JSON array.
Extract: timestamp, hostname, process, pid, message for each line.
Return ONLY the JSON array, no other text.

Raw logs:
{raw_logs}
""",
        expected_output="A JSON array of structured log entry objects",
        agent=_parser
    )

    detect_task = Task(
        description="""
You will receive structured log entries (JSON array) produced by the Log Parser.
Apply your security rules and expert knowledge to detect threats.

Instructions:
- Correlate related events (same IP / process / time window) into a single alert.
- Assign severity based on the threat category rules in your backstory.
- Return ONLY the JSON object with the "alerts" array.
- Do not output markdown, explanations, or any text outside the JSON.
""",
        expected_output='A JSON object: {"alerts": [...]}',
        agent=_analyst,
        context=[parse_task]
    )

    crew = Crew(
        agents=[_parser, _analyst],
        tasks=[parse_task, detect_task],
        verbose=False
    )

    return crew, detect_task


def _strip_fences(text: str) -> str:
    """Loại bỏ markdown code fences (```json ... ```) nếu có."""
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(
            line for line in lines
            if not line.strip().startswith("```")
        ).strip()
    return text


async def analyze_logs(raw_logs: str) -> dict:
    """
    Pipeline với retry + model fallback:

      raw_logs
        → [Parser Agent] → structured JSON array
        → [Security Analyst Agent] → {"alerts": [...]}

    Retry strategy:
      - Mỗi model thử tối đa MAX_RETRIES lần với exponential backoff
      - Nếu vẫn lỗi 503/500 → chuyển sang model tiếp theo trong LLM_POOL
      - Nếu toàn bộ pool thất bại → trả về {"alerts": [], "error": "..."}
    """
    last_error: Exception | None = None

    for model_idx, active_llm in enumerate(LLM_POOL):
        model_name = active_llm.model

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                logger.info(
                    f"[analyze_logs] model={model_name} attempt={attempt}/{MAX_RETRIES}"
                )

                crew, _ = _build_crew(active_llm, raw_logs)
                result   = await crew.kickoff_async()
                raw      = _strip_fences(str(result).strip())

                return json.loads(raw)

            except json.JSONDecodeError:
                # Model trả về không phải JSON hợp lệ — không cần retry
                raw = _strip_fences(str(result).strip())
                logger.warning(f"[analyze_logs] JSON decode failed, raw={raw[:200]}")
                return {"raw_response": raw, "alerts": []}

            except Exception as exc:
                last_error = exc
                err_str    = str(exc)

                # Chỉ retry khi gặp lỗi tạm thời (503 / 429 / 500)
                is_transient = any(
                    code in err_str
                    for code in ("503", "429", "500", "UNAVAILABLE", "RESOURCE_EXHAUSTED")
                )

                if not is_transient:
                    # Lỗi không phải tạm thời (auth, bad request...) → dừng hẳn
                    logger.error(f"[analyze_logs] non-transient error: {exc}")
                    raise

                if attempt < MAX_RETRIES:
                    wait = RETRY_DELAY * (2 ** (attempt - 1))   # 5s → 10s → 20s
                    logger.warning(
                        f"[analyze_logs] {model_name} attempt {attempt} failed "
                        f"({err_str[:80]}). Retrying in {wait}s..."
                    )
                    await asyncio.sleep(wait)
                else:
                    logger.warning(
                        f"[analyze_logs] {model_name} exhausted {MAX_RETRIES} retries. "
                        f"Moving to next model..."
                    )

    # Toàn bộ pool đều thất bại
    logger.error(f"[analyze_logs] All models failed. Last error: {last_error}")
    return {
        "alerts": [],
        "error": f"All models unavailable. Last error: {str(last_error)}"
    }