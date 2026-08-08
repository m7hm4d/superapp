#!/usr/bin/env python3
"""Fail closed unless migrations target the local Compose PostgreSQL service.

The input is `docker compose config --format json`.  Values are deliberately
never echoed because the document contains the production database password.
"""

from __future__ import annotations

import json
import sys
from urllib.parse import unquote, urlsplit


def reject(message: str) -> "NoReturn":
    print(f"database target rejected: {message}", file=sys.stderr)
    raise SystemExit(1)


def required_string(mapping: object, key: str, location: str) -> str:
    if not isinstance(mapping, dict):
        reject(f"{location} is missing")
    value = mapping.get(key)
    if not isinstance(value, str) or not value:
        reject(f"{location}.{key} is missing")
    return value


try:
    document = json.load(sys.stdin)
except (json.JSONDecodeError, UnicodeDecodeError):
    reject("Compose did not produce valid JSON")

services = document.get("services") if isinstance(document, dict) else None
if not isinstance(services, dict):
    reject("Compose services are missing")

db = services.get("db")
migrate = services.get("migrate")
if not isinstance(db, dict) or not isinstance(migrate, dict):
    reject("db or migrate service is missing")

db_environment = db.get("environment")
migrate_environment = migrate.get("environment")
db_user = required_string(db_environment, "POSTGRES_USER", "db.environment")
db_password = required_string(db_environment, "POSTGRES_PASSWORD", "db.environment")
db_name = required_string(db_environment, "POSTGRES_DB", "db.environment")
database_url = required_string(migrate_environment, "DATABASE_URL", "migrate.environment")

try:
    parsed = urlsplit(database_url)
    port = parsed.port
except ValueError:
    reject("DATABASE_URL is malformed")

if parsed.scheme not in {"postgres", "postgresql"}:
    reject("DATABASE_URL scheme must be postgres or postgresql")
if parsed.query or parsed.fragment:
    reject("DATABASE_URL query and fragment are not allowed")
if parsed.hostname != "db" or port != 5432:
    reject("DATABASE_URL must target db:5432")
if parsed.username is None or unquote(parsed.username) != db_user:
    reject("DATABASE_URL user does not match POSTGRES_USER")
if parsed.password is None or unquote(parsed.password) != db_password:
    reject("DATABASE_URL password does not match POSTGRES_PASSWORD")
if not parsed.path.startswith("/") or unquote(parsed.path[1:]) != db_name:
    reject("DATABASE_URL database does not match POSTGRES_DB")

print("database target matches the local Compose db service")
