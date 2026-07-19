"""
GitHub Actions API client.
- Tao/xoa environment moi khach
- Ghi/xoa secret (AWS key) vao environment
- Trigger workflow_dispatch voi customer_id
- Poll trang thai run
"""
import os
import asyncio
import base64

import httpx
from dotenv import load_dotenv
from nacl import encoding, public

load_dotenv()

logger_name = __name__
import logging
logger = logging.getLogger(logger_name)

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "").strip()
REPO = os.getenv("GITHUB_REPO", "").strip()
WORKFLOW_FILE = os.getenv("WORKFLOW_FILE", "actions.yml").strip()

API = "https://api.github.com"


def _headers():
    if not GITHUB_TOKEN:
        raise RuntimeError("Missing GITHUB_TOKEN in backend/.env")
    if not REPO:
        raise RuntimeError("Missing GITHUB_REPO in backend/.env")
    return {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cloud-monitoring-backend",
    }


async def _request(method: str, url: str, **kwargs):
    """Helper: gui request va log loi cu the."""
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.request(method, url, headers=_headers(), **kwargs)
        if r.status_code >= 400:
            logger.error("GitHub API %s %s -> %s: %s", method, url, r.status_code, r.text[:300])
        r.raise_for_status()
        return r


async def create_environment(env: str):
    """Tao environment. GitHub can env ton tai TRUOC khi lay public-key."""
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.put(
            f"{API}/repos/{REPO}/environments/{env}",
            headers=_headers(),
            json={},
        )
    # 200 = tao moi thanh cong
    # 422 = da ton tai -> OK
    if r.status_code == 200:
        logger.info("Environment '%s' created", env)
    elif r.status_code == 422:
        logger.info("Environment '%s' already exists", env)
    else:
        logger.error("create_environment failed: %s %s", r.status_code, r.text[:200])
    # cho GitHub dong bo
    await asyncio.sleep(2)


async def get_repo_public_key(env: str):
    """Lay public key cua environment. Retry vi env vua tao co the chua ready."""
    for attempt in range(5):
        try:
            r = await _request("GET", f"{API}/repos/{REPO}/environments/{env}/secrets/public-key")
            j = r.json()
            return j["key_id"], j["key"]
        except Exception as e:
            logger.warning("get_public_key attempt %d failed: %s", attempt + 1, str(e)[:100])
            await asyncio.sleep(2)
    raise RuntimeError(f"Cannot get public-key for environment '{env}' after retries")


async def put_env_secret(env: str, name: str, value: str):
    """Ghi 1 secret vao environment (da ma hoa libsodium)."""
    key_id, pub_b64 = await get_repo_public_key(env)
    pub_key = public.PublicKey(pub_b64.encode(), encoding.Base64Encoder())
    sealed = public.SealedBox(pub_key)
    encrypted = sealed.encrypt(value.encode())
    body = {
        "encrypted_value": base64.b64encode(encrypted).decode(),
        "key_id": key_id,
    }
    await _request(
        "PUT",
        f"{API}/repos/{REPO}/environments/{env}/secrets/{name}",
        json=body,
    )
    logger.info("Secret '%s' saved to environment '%s'", name, env)


async def delete_env_secret(env: str, name: str):
    async with httpx.AsyncClient(timeout=30) as c:
        await c.delete(
            f"{API}/repos/{REPO}/environments/{env}/secrets/{name}",
            headers=_headers(),
        )


async def delete_environment(env: str):
    async with httpx.AsyncClient(timeout=30) as c:
        await c.delete(
            f"{API}/repos/{REPO}/environments/{env}",
            headers=_headers(),
        )


async def dispatch_workflow(customer_id: str, scan_regions: str = "ap-southeast-1") -> int:
    """Trigger workflow. Tra ve run_id."""
    await _request(
        "POST",
        f"{API}/repos/{REPO}/actions/workflows/{WORKFLOW_FILE}/dispatches",
        json={
            "ref": os.getenv("WORKFLOW_REF", "main"),
            "inputs": {
                "customer_id": customer_id,
                "scan_regions": scan_regions,
            },
        },
    )
    return await _get_latest_run_id(customer_id)


async def _get_latest_run_id(customer_id: str) -> int:
    await asyncio.sleep(3)
    r = await _request("GET", f"{API}/repos/{REPO}/actions/runs?per_page=5")
    runs = r.json().get("workflow_runs", [])
    if runs:
        return runs[0]["id"]
    return 0


async def get_run_status(run_id: int) -> dict:
    r = await _request("GET", f"{API}/repos/{REPO}/actions/runs/{run_id}")
    j = r.json()
    return {
        "run_id": run_id,
        "status": j.get("status"),
        "conclusion": j.get("conclusion"),
        "html_url": j.get("html_url"),
    }
