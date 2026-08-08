#!/usr/bin/env python3
"""Wait for required GitHub workflow jobs on one exact main-branch commit.

Publish runs at the same time as CI, CodeQL, and Security after a push. This
script queries workflow runs by immutable head SHA and refuses PR, scheduled,
tag, or other-branch runs. It is intentionally stdlib-only so the gate itself
does not need an unpinned dependency or a privileged third-party action.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


@dataclass(frozen=True)
class Gate:
    label: str
    workflow: str
    jobs: tuple[str, ...]


GATES = (
    Gate(
        "CI",
        "ci.yml",
        (
            "test",
            "lint",
            "contract",
            "deploy",
            "expo (customer)",
            "expo (vendor)",
            "expo (driver)",
        ),
    ),
    Gate("CodeQL", "codeql.yml", ("analyze",)),
    Gate("Security", "security.yml", ("Repository vulnerabilities and IaC",)),
)

SHA = re.compile(r"[0-9a-fA-F]{40}\Z")
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")


class GateError(RuntimeError):
    """A gate cannot safely be accepted."""


def required_env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise GateError(f"{name} is required")
    return value


def positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise GateError(f"{name} must be an integer") from error
    if value <= 0:
        raise GateError(f"{name} must be positive")
    return value


class GitHub:
    def __init__(self, repository: str, token: str, api_url: str) -> None:
        if not REPOSITORY.fullmatch(repository):
            raise GateError("GITHUB_REPOSITORY must be owner/repository")
        if not api_url.startswith("https://"):
            raise GateError("GITHUB_API_URL must use HTTPS")
        self.repository = repository
        self.token = token
        self.api_url = api_url.rstrip("/")

    def get(self, path: str, query: dict[str, str] | None = None) -> dict:
        url = f"{self.api_url}{path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query)}"
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self.token}",
                "User-Agent": "superapp-publish-gate",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # A newly added workflow can briefly be absent from the workflow
            # index while the same push is already running Publish.
            if error.code == 404:
                return {}
            raise GateError(f"GitHub API returned HTTP {error.code}") from error
        except urllib.error.URLError as error:
            raise GateError(f"GitHub API request failed: {error.reason}") from error

    def workflow_run(self, workflow: str, sha: str) -> dict | None:
        workflow_id = urllib.parse.quote(workflow, safe="")
        payload = self.get(
            f"/repos/{self.repository}/actions/workflows/{workflow_id}/runs",
            {
                "branch": "main",
                "event": "push",
                "head_sha": sha,
                "per_page": "20",
            },
        )
        runs = [
            run
            for run in payload.get("workflow_runs", [])
            if run.get("head_sha") == sha
            and run.get("head_branch") == "main"
            and run.get("event") == "push"
        ]
        if not runs:
            return None
        return max(runs, key=lambda run: (run.get("run_number", 0), run.get("run_attempt", 0)))

    def jobs(self, run_id: int) -> dict[str, dict]:
        payload = self.get(
            f"/repos/{self.repository}/actions/runs/{run_id}/jobs",
            {"filter": "latest", "per_page": "100"},
        )
        return {job.get("name", ""): job for job in payload.get("jobs", [])}


def verify_gate(github: GitHub, gate: Gate, sha: str) -> tuple[bool, str]:
    run = github.workflow_run(gate.workflow, sha)
    if run is None:
        return False, "run has not appeared"

    status = run.get("status")
    conclusion = run.get("conclusion")
    if status != "completed":
        return False, f"run is {status or 'pending'}"
    if conclusion != "success":
        raise GateError(f"{gate.label} concluded {conclusion or 'without a conclusion'}")

    jobs = github.jobs(int(run["id"]))
    for required in gate.jobs:
        job = jobs.get(required)
        if job is None:
            raise GateError(f"{gate.label} is missing required job {required!r}")
        if job.get("status") != "completed" or job.get("conclusion") != "success":
            raise GateError(
                f"{gate.label} job {required!r} is "
                f"{job.get('status')}/{job.get('conclusion')}"
            )
    return True, f"run {run['id']} and {len(gate.jobs)} required job(s) succeeded"


def main() -> int:
    try:
        sha = required_env("TARGET_SHA").lower()
        if not SHA.fullmatch(sha):
            raise GateError("TARGET_SHA must be a full 40-character commit SHA")

        github = GitHub(
            required_env("GITHUB_REPOSITORY"),
            required_env("GITHUB_TOKEN"),
            os.environ.get("GITHUB_API_URL", "https://api.github.com"),
        )
        timeout = positive_int("GATE_TIMEOUT_SECONDS", 2700)
        poll = positive_int("GATE_POLL_SECONDS", 15)
        deadline = time.monotonic() + timeout
        pending = {gate.label: gate for gate in GATES}

        print(f"Waiting for exact-commit gates on {sha}", flush=True)
        while pending:
            for label, gate in tuple(pending.items()):
                ready, detail = verify_gate(github, gate, sha)
                print(f"{label}: {detail}", flush=True)
                if ready:
                    del pending[label]

            if not pending:
                break
            if time.monotonic() >= deadline:
                waiting = ", ".join(pending)
                raise GateError(f"timed out waiting for: {waiting}")
            time.sleep(min(poll, max(0, deadline - time.monotonic())))

        print("CI, CodeQL, Security, and the generated-contract job all passed.")
        return 0
    except GateError as error:
        print(f"gate rejected: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
