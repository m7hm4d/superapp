#!/usr/bin/env python3
"""Protect durable-deployment reconciliation invariants from YAML drift."""

from __future__ import annotations

import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-production.yml"


def require(source: str, needle: str, failures: list[str]) -> None:
    if source.count(needle) != 1:
        failures.append(f"expected exactly one occurrence of {needle!r}")


def main() -> int:
    source = WORKFLOW.read_text(encoding="utf-8")
    lines = source.splitlines()
    failures: list[str] = []

    for index, line in enumerate(lines):
        if line.strip() == "curl \\":
            if index + 1 >= len(lines) or lines[index + 1].strip() != "-q \\":
                failures.append(
                    f"{WORKFLOW}:{index + 1}: curl must use -q as its first option"
                )

    for needle in (
        "id: launch",
        "if: always() && steps.remote-run.outputs.path != ''",
        "LAUNCH_OUTCOME: ${{ steps.launch.outcome }}",
        "launch_grace_is_active()",
    ):
        require(source, needle, failures)
    if source.count('launch_marker="$run_dir/launch-attempt"') != 2:
        failures.append("launcher and poller must use the same durable launch marker")

    runner_pid = source.find('pid_tmp="${pid_file}.tmp.$$"')
    runner_running = source.find("write_status running '-' || exit 125")
    launch_marker = source.find('mv -f -- "$marker_tmp" "$launch_marker"')
    nohup = source.find('nohup "$runner"')
    if min(runner_pid, runner_running) < 0 or runner_pid >= runner_running:
        failures.append("durable runner must persist its own PID before running status")
    if min(launch_marker, nohup) < 0 or launch_marker >= nohup:
        failures.append("launcher must persist its attempt marker immediately before nohup")

    guarded_heartbeat = (
        "if [[ \"$state\" == 'running' ]] && process_matches_run && "
        "! heartbeat_is_fresh; then"
    )
    require(source, guarded_heartbeat, failures)
    if "queued' || \"$state\" == 'running' ]] && ! heartbeat_is_fresh" in source:
        failures.append("queued launch recovery must not require a heartbeat")
    if "failure\\t126" in source:
        failures.append("stale heartbeat must not synthesize a terminal failure")
    for needle in (
        "printf 'running-stale\\t-\\t%s\\n'",
        "stale_heartbeat_polls=$((stale_heartbeat_polls + 1))",
        "stale_heartbeat_polls % 6 == 0",
        "verified PID/cmdline is alive; continuing reconciliation",
    ):
        if needle not in source:
            failures.append(f"stale-heartbeat reconciliation is missing {needle!r}")

    wait_start = source.find("- name: Wait for the durable deployment result")
    launch_start = source.find("- name: Reconfirm freshness and start the durable deployment")
    cleanup_start = source.find("- name: Remove remote staging bundle")
    if launch_start < 0 or wait_start <= launch_start:
        failures.append("durable launch step boundaries are missing")
    else:
        launch_step = source[launch_start:wait_start]
        for needle in ("id: launch", "continue-on-error: true", "remote_uid=$(id -u)"):
            if needle not in launch_step:
                failures.append(f"durable launch step is missing {needle!r}")
        launcher_uid_guard = launch_step.find("remote_uid=$(id -u)")
        launcher_mutation = launch_step.find('marker_tmp="$run_dir/.launch-attempt.$$"')
        if min(launcher_uid_guard, launcher_mutation) < 0 or launcher_uid_guard >= launcher_mutation:
            failures.append("remote launcher must reject UID 0 before its first mutation")

    if wait_start < 0 or cleanup_start <= wait_start:
        failures.append("durable result step boundaries are missing")
    else:
        wait_step = source[wait_start:cleanup_start]
        for needle in (
            "if: always() && steps.remote-run.outputs.path != ''",
            "LAUNCH_OUTCOME: ${{ steps.launch.outcome }}",
            "launch_grace_is_active",
            "process_matches_run",
        ):
            if needle not in wait_step:
                failures.append(f"durable result step is missing {needle!r}")

    staging_start = source.find("- name: Create remote staging directory")
    transfer_start = source.find("- name: Transfer the exact-commit bundle")
    if staging_start < 0 or transfer_start <= staging_start:
        failures.append("remote staging step boundaries are missing")
    else:
        staging_step = source[staging_start:transfer_start]
        for needle in (
            '[[ "$SSH_USER" != \'root\' ]]',
            'test "$(id -u)" -ne 0 ||',
            "mktemp -d /tmp/superapp-deploy.XXXXXXXX",
        ):
            if needle not in staging_step:
                failures.append(f"remote staging root guard is missing {needle!r}")
        if staging_step.find('test "$(id -u)" -ne 0 ||') >= staging_step.find(
            "mktemp -d /tmp/superapp-deploy.XXXXXXXX"
        ):
            failures.append("remote UID guard must run before staging mktemp")

    remote_script_start = source.find("<<'REMOTE_SCRIPT'")
    remote_script_end = source.find("\n          REMOTE_SCRIPT", remote_script_start + 1)
    if remote_script_start < 0 or remote_script_end <= remote_script_start:
        failures.append("remote installer script boundaries are missing")
    else:
        installer = source[remote_script_start:remote_script_end]
        uid_guard = installer.find("remote_uid=$(id -u)")
        first_mutation = installer.find('install -d -m 700 "$state_dir"')
        if min(uid_guard, first_mutation) < 0 or uid_guard >= first_mutation:
            failures.append("remote installer must reject UID 0 before install/extract mutation")
        for needle in (
            '[[ "$remote_uid" =~ ^[1-9][0-9]*$ ]]',
            "remote application path is a dangerous shared/system path",
            "/ | */ | *//* | */./* | */.",
        ):
            if needle not in installer:
                failures.append(f"remote installer is missing {needle!r}")

    local_cleanup_start = source.find("- name: Remove ephemeral deployment material")
    if cleanup_start < 0 or local_cleanup_start <= cleanup_start:
        failures.append("remote cleanup step boundaries are missing")
    else:
        cleanup_step = source[cleanup_start:local_cleanup_start]
        for needle in (
            "if: always()",
            "continue-on-error: true",
            "::warning::",
            "the verified deployment result remains authoritative",
            "if ! ssh",
        ):
            if needle not in cleanup_step:
                failures.append(f"remote cleanup must be non-authoritative and include {needle!r}")
    if local_cleanup_start < 0:
        failures.append("local ephemeral cleanup step is missing")
    else:
        local_cleanup_step = source[local_cleanup_start:]
        for needle in (
            "if: always()",
            "continue-on-error: true",
            "::warning::ephemeral runner cleanup failed",
            "the verified deployment result remains authoritative",
        ):
            if needle not in local_cleanup_step:
                failures.append(f"local cleanup must be non-authoritative and include {needle!r}")

    if failures:
        print("Deploy workflow reconciliation policy failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(
        "Deploy reconciliation policy passed: an uncertain SSH launch is always "
        "polled, remote mutation rejects UID 0/dangerous roots, and cleanup cannot "
        "override the durable result."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
