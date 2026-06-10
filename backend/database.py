import os
import inspect
from pathlib import Path
from functools import lru_cache

import httpx
from dotenv import load_dotenv
from supabase.lib.client_options import SyncClientOptions
from supabase import Client, create_client

load_dotenv(Path(__file__).with_name(".env"))


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    disable_ssl_verify = os.getenv("SUPABASE_DISABLE_SSL_VERIFY", "false").lower() == "true"
    if disable_ssl_verify:
        options_signature = inspect.signature(SyncClientOptions)
        if "httpx_client" in options_signature.parameters:
            options = SyncClientOptions(httpx_client=httpx.Client(verify=False))
            return create_client(url, key, options=options)

        # Older supabase-py releases do not support injecting a custom httpx client.
        # Fall back to default client creation so the app can still boot.
        return create_client(url, key)

    return create_client(url, key)


def get_admin_secret() -> str:
    return os.getenv("ADMIN_SECRET", "")
