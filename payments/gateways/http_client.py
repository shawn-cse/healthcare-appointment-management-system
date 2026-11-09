import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional


class HttpClientError(Exception):
    pass


def send_http_request(
    url: str,
    method: str = "POST",
    data: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 15,
    is_json: bool = False,
) -> Dict[str, Any]:
    """
    Standard-library HTTP client wrapper supporting JSON and urlencoded requests
    with configurable timeouts and safe exception handling.
    """
    req_headers = {
        "User-Agent": "GreenHospital-PaymentGateway/1.0",
    }
    if headers:
        req_headers.update(headers)

    encoded_data = None
    if data is not None:
        if is_json:
            req_headers["Content-Type"] = "application/json"
            encoded_data = json.dumps(data).encode("utf-8")
        else:
            req_headers["Content-Type"] = "application/x-www-form-urlencoded"
            encoded_data = urllib.parse.urlencode(data).encode("utf-8")

    req = urllib.request.Request(
        url=url,
        data=encoded_data,
        headers=req_headers,
        method=method.upper(),
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            resp_body = response.read().decode("utf-8")
            content_type = response.headers.get("Content-Type", "")
            if "application/json" in content_type or resp_body.strip().startswith(("{", "[")):
                try:
                    return json.loads(resp_body)
                except json.JSONDecodeError:
                    return {"raw_response": resp_body}
            return {"raw_response": resp_body}
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="ignore")
        raise HttpClientError(f"HTTP {e.code} error: {e.reason} - {error_body}")
    except urllib.error.URLError as e:
        raise HttpClientError(f"Network error contacting gateway: {e.reason}")
    except Exception as e:
        raise HttpClientError(f"Gateway connection error: {str(e)}")
