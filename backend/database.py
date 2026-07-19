import os
import inspect
from pathlib import Path
from functools import lru_cache
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from supabase.lib.client_options import SyncClientOptions
from supabase import Client, create_client

load_dotenv(Path(__file__).with_name(".env"))


def _normalize_supabase_url(raw_url: str) -> str:
    url = raw_url.strip().strip('"').strip("'")

    # Common deployment mistake: pasting markdown links instead of plain URLs.
    if "[" in url or "]" in url or "(" in url or ")" in url:
        raise RuntimeError("SUPABASE_URL must be a plain URL, not markdown or wrapped text")

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("SUPABASE_URL must be a valid http(s) URL like https://<project>.supabase.co")

    return f"{parsed.scheme}://{parsed.netloc}"


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    raw_url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not raw_url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    url = _normalize_supabase_url(raw_url)

    disable_ssl_verify = os.getenv("SUPABASE_DISABLE_SSL_VERIFY", "false").lower() == "true"
    timeout_seconds = float(os.getenv("SUPABASE_HTTP_TIMEOUT_SECONDS", "20"))
    transport_retries = int(os.getenv("SUPABASE_HTTP_RETRIES", "3"))

    options_signature = inspect.signature(SyncClientOptions)
    if "httpx_client" in options_signature.parameters:
        transport = httpx.HTTPTransport(retries=transport_retries)
        httpx_client = httpx.Client(
            verify=not disable_ssl_verify,
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
            limits=httpx.Limits(max_connections=30, max_keepalive_connections=10),
        )
        options = SyncClientOptions(httpx_client=httpx_client)
        return create_client(url, key, options=options)

    # Older supabase-py releases do not support injecting a custom httpx client.
    # Fall back to default client creation so the app can still boot.
    if disable_ssl_verify:
        # Explicitly keep legacy behavior on old releases when SSL verify is disabled.
        return create_client(url, key)

    return create_client(url, key)


def get_admin_secret() -> str:
    return os.getenv("ADMIN_SECRET", "")
