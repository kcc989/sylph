import base64
import hashlib
import json
import os
import sqlite3
import sys


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def cell(value):
    return {"blob": base64.b64encode(value).decode()} if isinstance(value, bytes) else value


def authorize(action, first, second, database, trigger):
    if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_CREATE_VTABLE):
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION and second not in ("length", "typeof", "hex", "quote"):
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_PRAGMA and first not in ("foreign_keys", "defer_foreign_keys"):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def inspect(database):
    integrity = database.execute("PRAGMA integrity_check").fetchall()
    if integrity != [("ok",)] or database.execute("PRAGMA foreign_key_check").fetchall():
        raise ValueError("Imported database failed integrity or foreign key validation")
    schema = database.execute("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").fetchall()
    tables = []
    credentials = []
    for kind, name, owner, sql in schema:
        if kind != "table":
            continue
        quoted = '"' + name.replace('"', '""') + '"'
        cursor = database.execute("SELECT * FROM " + quoted)
        columns = [column[0] for column in cursor.description]
        rows = [[cell(value) for value in row] for row in cursor.fetchall()]
        tables.append({"name": name, "rows": len(rows), "digest": digest(sorted(rows, key=lambda row: json.dumps(row, sort_keys=True)))})
        if "encrypted" in columns and "iv" in columns:
            for row in rows:
                encrypted, iv = row[columns.index("encrypted")], row[columns.index("iv")]
                if encrypted is not None and iv is not None:
                    credentials.append({"table": name, "encrypted": encrypted, "iv": iv})
    installation = database.execute("SELECT id, claimed_by_user_id FROM installation").fetchall()
    if len(installation) != 1:
        raise ValueError("Expected exactly one Installation identity")
    return {"schemaHash": digest(schema), "dataHash": digest(tables), "tables": tables, "installation": {"id": installation[0][0], "claimed_by_user_id": installation[0][1]}, "credentials": credentials}


try:
    request = json.load(sys.stdin)
    database = sqlite3.connect(":memory:")
    database.set_authorizer(authorize)
    database.executescript(request["sql"])
    database.set_authorizer(None)
    summary = inspect(database)
    duplicate = sqlite3.connect(":memory:")
    database.backup(duplicate)
    if inspect(duplicate) != summary:
        raise ValueError("Database copy did not round trip")
    if request.get("target"):
        target = request["target"]
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(descriptor)
        destination = sqlite3.connect(target)
        database.backup(destination)
        if inspect(destination) != summary:
            raise ValueError("Restored local database differs from the archive")
        destination.close()
    print(json.dumps(summary))
except Exception:
    print("Installation SQL verification failed; no remote data was changed", file=sys.stderr)
    sys.exit(1)
