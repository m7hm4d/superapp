#!/usr/bin/env python3
"""Classify a GHCR tag without treating registry failures as absence."""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import pathlib
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from email.message import Message
from typing import Callable


IMAGE = re.compile(
    r"ghcr\.io/(?P<path>[a-z0-9][a-z0-9_.-]{0,99}/[a-z0-9][a-z0-9_.-]{0,199})\Z"
)
TAG = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
USERNAME = re.compile(r"[A-Za-z0-9_.\[\]-]+\Z")
ACCEPT = ", ".join(
    (
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    )
)
MAX_BODY = 1024 * 1024
TRANSIENT_HTTP = {429, 500, 502, 503, 504}


class RegistryError(RuntimeError):
    """The registry did not provide an authoritative tag state."""


@dataclass(frozen=True)
class TagState:
    state: str
    digest: str | None = None


@dataclass(frozen=True)
class HttpResult:
    status: int
    headers: Message
    body: bytes


Opener = Callable[..., object]


class RegistryClient:
    def __init__(
        self,
        username: str,
        token: str,
        *,
        opener: Opener = urllib.request.urlopen,
        timeout: float = 15.0,
        retries: int = 3,
        retry_delays: tuple[float, ...] = (1.0, 2.0),
        base_url: str = "https://ghcr.io",
    ) -> None:
        if not USERNAME.fullmatch(username):
            raise RegistryError("GHCR_USERNAME is invalid")
        if not token or any(character in token for character in "\r\n"):
            raise RegistryError("GHCR_TOKEN is invalid")
        if not base_url.startswith("https://") and opener is urllib.request.urlopen:
            raise RegistryError("registry URL must use HTTPS")
        self.username = username
        self.token = token
        self.opener = opener
        self.timeout = timeout
        self.retries = retries
        self.retry_delays = retry_delays
        self.base_url = base_url.rstrip("/")

    def _request(self, request: urllib.request.Request, purpose: str) -> HttpResult:
        last_error = "unknown error"
        for attempt in range(self.retries):
            try:
                with self.opener(request, timeout=self.timeout) as response:  # type: ignore[attr-defined]
                    body = response.read(MAX_BODY + 1)
                    if len(body) > MAX_BODY:
                        raise RegistryError(f"{purpose} response is too large")
                    return HttpResult(response.status, response.headers, body)
            except urllib.error.HTTPError as error:
                body = error.read(MAX_BODY + 1)
                if len(body) > MAX_BODY:
                    raise RegistryError(f"{purpose} error response is too large") from error
                if error.code not in TRANSIENT_HTTP:
                    return HttpResult(error.code, error.headers, body)
                last_error = f"HTTP {error.code}"
            except (TimeoutError, socket.timeout, urllib.error.URLError) as error:
                last_error = str(getattr(error, "reason", error))

            if attempt + 1 < self.retries:
                delay = self.retry_delays[min(attempt, len(self.retry_delays) - 1)]
                time.sleep(delay)

        raise RegistryError(
            f"{purpose} remained unavailable after {self.retries} attempts: {last_error}"
        )

    def _bearer_token(self, repository: str) -> str:
        basic = base64.b64encode(
            f"{self.username}:{self.token}".encode("utf-8")
        ).decode("ascii")
        query = urllib.parse.urlencode(
            {"service": "ghcr.io", "scope": f"repository:{repository}:pull"}
        )
        request = urllib.request.Request(
            f"{self.base_url}/token?{query}",
            headers={
                "Accept": "application/json",
                "Authorization": f"Basic {basic}",
                "User-Agent": "superapp-registry-tag-gate",
            },
        )
        response = self._request(request, "GHCR token request")
        if response.status != 200:
            raise RegistryError(f"GHCR token request returned HTTP {response.status}")
        try:
            payload = json.loads(response.body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RegistryError("GHCR token response is not valid JSON") from error
        bearer = payload.get("token") or payload.get("access_token")
        if not isinstance(bearer, str) or not bearer or any(
            character in bearer for character in "\r\n"
        ):
            raise RegistryError("GHCR token response has no valid bearer token")
        return bearer

    def probe(self, image: str, tag: str) -> TagState:
        match = IMAGE.fullmatch(image)
        if not match:
            raise RegistryError("image must be a lowercase ghcr.io/owner/name path")
        if not TAG.fullmatch(tag):
            raise RegistryError("registry tag is invalid")

        repository = match.group("path")
        bearer = self._bearer_token(repository)
        encoded_tag = urllib.parse.quote(tag, safe="")
        request = urllib.request.Request(
            f"{self.base_url}/v2/{repository}/manifests/{encoded_tag}",
            headers={
                "Accept": ACCEPT,
                "Authorization": f"Bearer {bearer}",
                "User-Agent": "superapp-registry-tag-gate",
            },
        )
        response = self._request(request, "GHCR manifest lookup")
        if response.status == 200:
            digest = response.headers.get("Docker-Content-Digest", "").lower()
            if not DIGEST.fullmatch(digest):
                raise RegistryError("GHCR manifest response has no valid content digest")
            return TagState("present", digest)

        if response.status == 404:
            try:
                payload = json.loads(response.body)
                codes = {
                    item.get("code")
                    for item in payload.get("errors", [])
                    if isinstance(item, dict)
                }
            except (AttributeError, UnicodeDecodeError, json.JSONDecodeError) as error:
                raise RegistryError("GHCR 404 response is not a registry error") from error
            if codes.intersection({"MANIFEST_UNKNOWN", "NAME_UNKNOWN"}):
                return TagState("absent")
            raise RegistryError("GHCR 404 did not prove that the manifest is absent")

        raise RegistryError(f"GHCR manifest lookup returned HTTP {response.status}")


def client_from_environment() -> RegistryClient:
    return RegistryClient(
        os.environ.get("GHCR_USERNAME", ""),
        os.environ.get("GHCR_TOKEN", ""),
    )


def require_absent(client: RegistryClient, image: str, tag: str) -> None:
    # Two authoritative reads narrow the last-writer race immediately before
    # the workflow's create command. Any ambiguous read raises and fails closed.
    for _ in range(2):
        result = client.probe(image, tag)
        if result.state != "absent":
            raise RegistryError(f"refusing to create existing tag {image}:{tag}")


class FakeResponse:
    def __init__(self, status: int, body: bytes, headers: Message | None = None) -> None:
        self.status = status
        self.body = body
        self.headers = headers or Message()

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self, limit: int) -> bytes:
        return self.body[:limit]


def http_error(status: int, body: bytes = b"{}") -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "https://ghcr.io/test",
        status,
        "mock failure",
        Message(),
        io.BytesIO(body),
    )


def run_self_test() -> None:
    token = FakeResponse(200, b'{"token":"test-bearer"}')

    for failure in (
        http_error(500),
        urllib.error.URLError(socket.timeout("mock timeout")),
    ):
        calls = iter((token, failure, failure, failure))

        def opener(*_: object, **__: object) -> object:
            result = next(calls)
            if isinstance(result, BaseException):
                raise result
            return result

        client = RegistryClient(
            "test-user",
            "test-token",
            opener=opener,
            retries=3,
            retry_delays=(0.0, 0.0),
            base_url="https://ghcr.io",
        )
        create_called = False
        try:
            require_absent(client, "ghcr.io/test-user/test-image", "sha-" + "a" * 40)
            create_called = True
        except RegistryError:
            pass
        if create_called:
            raise AssertionError("registry failure reached the create operation")

    absent_body = b'{"errors":[{"code":"MANIFEST_UNKNOWN"}]}'
    calls = iter((token, http_error(404, absent_body), token, http_error(404, absent_body)))

    def absent_opener(*_: object, **__: object) -> object:
        result = next(calls)
        if isinstance(result, BaseException):
            raise result
        return result

    client = RegistryClient(
        "test-user",
        "test-token",
        opener=absent_opener,
        retries=1,
        retry_delays=(0.0,),
        base_url="https://ghcr.io",
    )
    require_absent(client, "ghcr.io/test-user/test-image", "sha-" + "a" * 40)
    print("Registry tag gate self-test passed: timeout/HTTP 500 cannot reach create.")


def check_workflow(path: pathlib.Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines):
        if line.strip() == "curl \\":
            if index + 1 >= len(lines) or lines[index + 1].strip() != "-q \\":
                raise RegistryError(
                    f"{path}:{index + 1}: curl must use -q as its first option"
                )
    creates = [index for index, line in enumerate(lines) if "docker buildx imagetools create" in line]
    if len(creates) != 1:
        raise RegistryError(
            f"expected exactly one guarded SHA-tag create, found {len(creates)}"
        )
    for index in creates:
        preceding = "\n".join(lines[max(0, index - 4) : index])
        if (
            "python3 scripts/check-registry-tag.py require-absent" not in preceding
            or "set +e" not in preceding
        ):
            raise RegistryError(
                f"{path}:{index + 1}: imagetools create lacks an immediate fail-closed absence gate or set -e suspension"
            )
        following = "\n".join(lines[index : min(len(lines), index + 16)])
        for required in (
            "create_status=$?",
            "set -e",
            "if (( create_status != 0 )); then",
            'python3 scripts/check-registry-tag.py require-digest "$image" "$tag" "$digest"',
        ):
            if required not in following:
                raise RegistryError(
                    f"{path}:{index + 1}: SHA-tag create lacks uncertain-result reconciliation {required!r}"
                )
    source = "\n".join(lines)
    if "\n  retag:" in source or "Promote main-signed" in source:
        raise RegistryError("GHCR SemVer promotion jobs are forbidden")
    for required in (
        ".name == $tag",
        "length == 0",
        "generate_release_notes: false",
        "reconcile_deadline=$((SECONDS + 90))",
        "current_source=$(resolve_remote_tag)",
        "release creation was not authoritatively reconciled within 90 seconds",
        "GHCR SemVer aliases are not created",
    ):
        if required not in source:
            raise RegistryError(f"idempotent digest-only release is missing {required!r}")
    if re.search(r"(?:if|elif)\s+(?:timeout\s+\S+\s+)?docker buildx imagetools inspect", source):
        raise RegistryError("imagetools inspect must not classify a tag as absent")
    print("Publish tag-create policy passed: only the guarded full-SHA tag can be created.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--check-workflow", type=pathlib.Path)
    subparsers = parser.add_subparsers(dest="command")
    for command in ("probe", "require-absent"):
        child = subparsers.add_parser(command)
        child.add_argument("image")
        child.add_argument("tag")
    require_digest = subparsers.add_parser("require-digest")
    require_digest.add_argument("image")
    require_digest.add_argument("tag")
    require_digest.add_argument("digest")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.self_test:
            run_self_test()
            return 0
        if args.check_workflow:
            check_workflow(args.check_workflow)
            return 0
        if not args.command:
            raise RegistryError("a registry tag command is required")

        client = client_from_environment()
        if args.command == "probe":
            result = client.probe(args.image, args.tag)
            print(json.dumps({"state": result.state, "digest": result.digest}))
        elif args.command == "require-absent":
            require_absent(client, args.image, args.tag)
            print(f"confirmed absent: {args.image}:{args.tag}")
        elif args.command == "require-digest":
            expected = args.digest.lower()
            if not DIGEST.fullmatch(expected):
                raise RegistryError("expected digest is invalid")
            result = client.probe(args.image, args.tag)
            if result.state != "present" or result.digest != expected:
                raise RegistryError(
                    f"registry tag does not resolve to the expected digest: {args.image}:{args.tag}"
                )
            print(f"confirmed digest: {args.image}:{args.tag} -> {expected}")
        return 0
    except (AssertionError, RegistryError) as error:
        print(f"registry tag gate rejected: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
