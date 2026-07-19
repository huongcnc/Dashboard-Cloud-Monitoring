"""
S3 client: doc ket qua scan theo folder khach hang.
"""
import os
import json
from typing import Optional

import boto3
from botocore.exceptions import ClientError


S3_BUCKET = os.getenv("S3_BUCKET", "scanning-result-bucket")
S3_PREFIX = os.getenv("S3_PREFIX", "customers")

# Dung session rieng cho S3 (key cua BAN, k phai key khach)
_session = boto3.Session(
    aws_access_key_id=os.getenv("S3_READ_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("S3_READ_SECRET_ACCESS_KEY"),
    region_name=os.getenv("S3_REGION", "ap-southeast-1"),
)


def _key(customer_id: str, *parts: str) -> str:
    return "/".join([S3_PREFIX, customer_id, *parts])


def get_latest_results(customer_id: str) -> Optional[dict]:
    """Doc merged-results.json moi nhat cua khach."""
    client = _session.client("s3")
    try:
        r = client.get_object(
            Bucket=S3_BUCKET,
            Key=_key(customer_id, "latest", "merged-results.json"),
        )
        return json.loads(r["Body"].read())
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            return None
        raise


def get_latest_raw(customer_id: str, kind: str) -> Optional[dict]:
    """Doc raw KICS hoac Trivy. kind = 'kics' | 'trivy'."""
    fname = {"kics": "kics-results.json", "trivy": "trivy-results.json"}[kind]
    client = _session.client("s3")
    try:
        r = client.get_object(
            Bucket=S3_BUCKET,
            Key=_key(customer_id, "latest", fname),
        )
        return json.loads(r["Body"].read())
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            return None
        raise


def list_history(customer_id: str) -> list[dict]:
    """Liet ke cac lan scan trong history/."""
    client = _session.client("s3")
    prefix = _key(customer_id, "history", "")
    runs = []
    paginator = client.get_paginator("list_objects_v2")
    seen = set()
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix, Delimiter="/"):
        for p in page.get("CommonPrefixes", []):
            # p["Prefix"] = customers/cust-a/history/2026-07-16T.../
            ts = p["Prefix"].rstrip("/").split("/")[-1]
            seen.add(ts)
    for ts in sorted(seen, reverse=True):
        runs.append({"timestamp": ts, "path": f"{prefix}{ts}/"})
    return runs


def get_history_results(customer_id: str, timestamp: str) -> Optional[dict]:
    """Doc merged-results cua 1 lan scan cu the."""
    client = _session.client("s3")
    try:
        r = client.get_object(
            Bucket=S3_BUCKET,
            Key=_key(customer_id, "history", timestamp, "merged-results.json"),
        )
        return json.loads(r["Body"].read())
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            return None
        raise
