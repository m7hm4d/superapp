#!/usr/bin/env python3
"""Fail if a blocking Trivy workflow scan can consume repository policy files."""

from __future__ import annotations

import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
TRIVY_ACTION = re.compile(
    r"^\s*(?:-\s*)?uses:\s*aquasecurity/trivy-action@[0-9a-f]{40}(?:\s+#.*)?$"
)
INPUT = re.compile(r"^\s+([a-z0-9-]+):\s*(.*?)\s*$")
EXPECTED = {
    "trivy-config": "${{ runner.temp }}/trivy-blocking.yaml",
    "trivyignores": "${{ runner.temp }}/trivy-empty-ignore.yaml",
}
REQUIRED_BLOCKING = {
    ".github/workflows/ci.yml": {
        "Scan images for vulnerabilities",
        "Scan the admin image",
    },
    ".github/workflows/security.yml": {
        "Gate fixable high and critical repository findings",
    },
    ".github/workflows/publish.yml": {
        "Scan the published image digest",
    },
}


def indentation(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def action_inputs(lines: list[str], action_index: int) -> dict[str, str]:
    action_indent = indentation(lines[action_index])
    if lines[action_index].lstrip().startswith("-"):
        action_indent += 2
    inputs: dict[str, str] = {}
    in_with = False
    with_indent = -1

    for line in lines[action_index + 1 :]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        current_indent = indentation(line)
        if current_indent < action_indent:
            break

        if not in_with:
            if current_indent == action_indent and stripped == "with:":
                in_with = True
                with_indent = current_indent
            continue

        if current_indent <= with_indent:
            break

        match = INPUT.match(line)
        if match:
            inputs[match.group(1)] = unquote(match.group(2))

    return inputs


def action_step_name(lines: list[str], action_index: int) -> str | None:
    action_indent = indentation(lines[action_index])
    if lines[action_index].lstrip().startswith("-"):
        action_indent += 2
    step_indent = action_indent - 2

    for line in reversed(lines[: action_index + 1]):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        current_indent = indentation(line)
        if current_indent < step_indent:
            break
        if current_indent == step_indent and stripped.startswith("-"):
            match = re.match(r"-\s*name:\s*(.*?)\s*$", stripped)
            return unquote(match.group(1)) if match else None

    return None


def main() -> int:
    failures: list[str] = []
    blocking = 0
    blocking_by_workflow: dict[str, list[str | None]] = {}

    workflow_paths = sorted(WORKFLOWS.glob("*.yml")) + sorted(
        WORKFLOWS.glob("*.yaml")
    )
    for path in workflow_paths:
        lines = path.read_text(encoding="utf-8").splitlines()
        relative = str(path.relative_to(ROOT))
        workflow_blocking = blocking_by_workflow.setdefault(relative, [])
        for index, line in enumerate(lines):
            if not TRIVY_ACTION.match(line):
                continue

            inputs = action_inputs(lines, index)
            name = action_step_name(lines, index)
            if inputs.get("exit-code") != "1":
                if name in REQUIRED_BLOCKING.get(relative, set()):
                    failures.append(
                        f"{relative}:{index + 1}: required Trivy scan {name!r} "
                        "must use exit-code: 1"
                    )
                continue

            blocking += 1
            workflow_blocking.append(name)
            for key, expected in EXPECTED.items():
                actual = inputs.get(key)
                if actual != expected:
                    failures.append(
                        f"{relative}:{index + 1}: blocking Trivy input {key!r} "
                        f"must be {expected!r}, got {actual!r}"
                    )

    for workflow, required_names in REQUIRED_BLOCKING.items():
        actual_names = blocking_by_workflow.get(workflow, [])
        if len(actual_names) != len(required_names):
            failures.append(
                f"{workflow}: expected exactly {len(required_names)} blocking "
                f"Trivy scan(s), found {len(actual_names)}"
            )
        missing = required_names.difference(name for name in actual_names if name)
        if missing:
            failures.append(
                f"{workflow}: missing required blocking Trivy scan(s): "
                + ", ".join(repr(name) for name in sorted(missing))
            )

    if failures:
        print("Trivy workflow policy check failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(
        f"Trivy workflow policy check passed for {blocking} blocking scan(s): "
        "repository .trivyignore and trivy.yaml files cannot control them."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
