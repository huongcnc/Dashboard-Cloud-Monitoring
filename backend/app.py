import os
import json
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

try:
    from ai_agent import analyze_logs
    AI_AGENT_OK = True
except Exception:
    AI_AGENT_OK = False
    async def analyze_logs(*a, **k):
        return {"alerts": [], "error": "AI agent not available (crewai not installed)"}
from parser import parse_syslog
from github_client import (
    create_environment,
    put_env_secret,
    dispatch_workflow,
    get_run_status,
    delete_env_secret,
    delete_environment,
)
from s3_client import get_latest_results, get_latest_raw, list_history, get_history_results
from analysis_service import get_analysis, normalize_customer_id, run_analysis_job, start_analysis

from mock_data import get_mock_data
from elk_client import fetch_alerts, fetch_logs

BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))

def resolve_log_path(path: str) -> str:
    if not os.path.isabs(path):
        return os.path.join(BACKEND_DIR, path)
    return path

app = FastAPI(title="Cloud Monitoring Dashboard API")

cors_origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if item.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# Models
# =========================================================
class CustomerSetup(BaseModel):
    customer_id: str            # vd: "cust-acme"
    aws_access_key_id: str
    aws_secret_access_key: str
    aws_region: str = "ap-southeast-1"
    schedule: str = "daily"     # daily | weekly (cron da co san trong actions.yml)


class ScanTrigger(BaseModel):
    customer_id: str
    scan_regions: str = "ap-southeast-1"


# =========================================================
# Health
# =========================================================
@app.get("/health")
async def health():
    return {"status": "ok"}


# =========================================================
# Logs (giu nguyen endpoint cu, doc live data tu Elasticsearch)
# =========================================================
@app.get("/logs")
async def get_logs(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), q: str = Query("", max_length=200)):
    try:
        return await fetch_logs(page=page, page_size=page_size, query=q)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Elasticsearch logs unavailable: {exc}")


@app.get("/api/alerts")
async def get_alerts(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), q: str = Query("", max_length=200)):
    try:
        return await fetch_alerts(page=page, page_size=page_size, query=q)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Elasticsearch alerts unavailable: {exc}")


# =========================================================
# Customer management: nhap key -> tao environment + secret
# =========================================================
@app.post("/api/customer")
async def setup_customer(req: CustomerSetup):
    """
    Khach nhap AWS key qua dashboard.
    Backend tao GitHub environment rieng cho khach + ghi secret (ma hoa).
    """
    env = req.customer_id.strip().lower()
    if not env.startswith("cust-"):
        env = f"cust-{env}"

    try:
        await create_environment(env)
        await put_env_secret(env, "AWS_ACCESS_KEY_ID", req.aws_access_key_id)
        await put_env_secret(env, "AWS_SECRET_ACCESS_KEY", req.aws_secret_access_key)
        return {
            "status": "ok",
            "customer_id": env,
            "message": f"Environment '{env}' created with AWS credentials stored as encrypted secrets.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub API error: {str(e)}")


@app.delete("/api/customer/{customer_id}")
async def remove_customer(customer_id: str):
    """Xoa khach: xoa secret + environment."""
    env = customer_id.strip().lower()
    if not env.startswith("cust-"):
        env = f"cust-{env}"
    try:
        await delete_env_secret(env, "AWS_ACCESS_KEY_ID")
        await delete_env_secret(env, "AWS_SECRET_ACCESS_KEY")
        await delete_environment(env)
        return {"status": "ok", "message": f"Environment '{env}' removed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# Scan trigger: goi pipeline GitHub Actions
# =========================================================
@app.post("/api/scan/trigger")
async def trigger_scan(req: ScanTrigger):
    """
    Trigger workflow_dispatch voi customer_id.
    Pipeline chay Terraformer + KICS + Trivy roi push ket qua len S3.
    """
    env = req.customer_id.strip().lower()
    if not env.startswith("cust-"):
        env = f"cust-{env}"
    try:
        run_id = await dispatch_workflow(env, req.scan_regions)
        return {
            "status": "triggered",
            "customer_id": env,
            "run_id": run_id,
            "message": "Pipeline triggered. Poll /api/scan/status/{run_id} for progress.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Dispatch error: {str(e)}")


@app.get("/api/scan/status/{run_id}")
async def scan_status(run_id: int):
    """Poll trang thai run GitHub Actions."""
    try:
        return await get_run_status(run_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =========================================================
# AI infrastructure analysis: chay ngoai pipeline, doc ket qua S3
# =========================================================
@app.post("/api/results/{customer_id}/analyze")
async def analyze_results(customer_id: str, background_tasks: BackgroundTasks):
    """Queue a Gemini-powered correlation analysis outside the scan pipeline."""
    env = normalize_customer_id(customer_id)
    try:
        job = await start_analysis(env)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    background_tasks.add_task(run_analysis_job, job["analysis_id"], env)
    return job


@app.get("/api/analysis/{analysis_id}")
async def analysis_status(analysis_id: str):
    """Poll an infrastructure analysis job."""
    job = get_analysis(analysis_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis job not found.")
    return job


# =========================================================
# Results: doc tu S3 (folder theo khach)
# =========================================================
@app.get("/api/results/{customer_id}/latest")
async def results_latest(customer_id: str):
    """Doc ket qua scan moi nhat cua khach (merged-results.json)."""
    env = customer_id.strip().lower()
    if not env.startswith("cust-"):
        env = f"cust-{env}"
    data = get_latest_results(env)
    if data is None:
        raise HTTPException(status_code=404, detail="No results found for this customer yet.")
    return data


@app.get("/api/results/{customer_id}/raw/{kind}")
async def results_raw(customer_id: str, kind: str):
    """Doc raw KICS hoac Trivy. kind = kics | trivy"""
    if kind not in ("kics", "trivy"):
        raise HTTPException(status_code=400, detail="kind must be 'kics' or 'trivy'")
    env = customer_id.strip().lower()
    if not env.startswith("cust-"):
        env = f"cust-{env}"
    data = get_latest_raw(env, kind)
    if data is None:
        raise HTTPException(status_code=404, detail="No raw results found.")
    return data


@app.get("/api/results/{customer_id}/history")
async def results_history(customer_id: str):
    """Liet ke cac lan scan trong qua khu."""
    env = customer_id.strip().lower()
    if not env.startswith("cust-"):
        env = f"cust-{env}"
    return {"history": list_history(env)}


@app.get("/api/results/{customer_id}/history/{timestamp}")
async def results_history_detail(customer_id: str, timestamp: str):
    """Doc ket qua 1 lan scan cu the."""
    env = customer_id.strip().lower()
    if not env.startswith("cust-"):
        env = f"cust-{env}"
    data = get_history_results(env, timestamp)
    if data is None:
        raise HTTPException(status_code=404, detail="No results for this timestamp.")
    return data
