import hashlib
import json
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE_COMMIT = "5311a147464946a7f0b781737166ea81d9c91f78"
SOURCE_HASH = "4f9cccd13fe0a768d7a49f2711099de527b0519482bff0958e6d047750e1a63d"


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def quoted(value):
    return '"' + value.replace('"', '""') + '"'


def authorize(action, first, second, database, trigger):
    if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_CREATE_VTABLE):
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION and second not in ("length", "typeof", "hex", "quote", "unixepoch"):
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_PRAGMA and first not in ("foreign_keys", "defer_foreign_keys"):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def database(sql, trusted=False):
    result = sqlite3.connect(":memory:")
    if not trusted:
        result.set_authorizer(authorize)
    result.executescript(sql)
    result.set_authorizer(None)
    check(result)
    return result


def check(db):
    if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or db.execute("PRAGMA foreign_key_check").fetchall():
        raise ValueError("Database integrity validation failed")


def schema(db):
    return db.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','__alchemy_migrations','_cf_KV','_cf_METADATA') ORDER BY type,name").fetchall()


def rows(db, table, columns):
    expressions = []
    for column in columns:
        name = quoted(column)
        expressions.extend(["typeof(" + name + ")", "CASE WHEN typeof(" + name + ") IN ('text','blob') THEN hex(" + name + ") ELSE quote(" + name + ") END"])
    values = [[{"kind": row[index], "value": row[index + 1]} for index in range(0, len(row), 2)] for row in db.execute("SELECT " + ",".join(expressions) + " FROM " + quoted(table))]
    return sorted(values, key=lambda row: json.dumps(row, separators=(",", ":")))


def dump_statements(db):
    statements = ["PRAGMA defer_foreign_keys=ON;"]
    objects = db.execute("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC,name").fetchall()
    def literal(value):
        if value is None:
            return "NULL"
        if isinstance(value, str):
            return "CAST(X'" + value.encode().hex() + "' AS TEXT)"
        if isinstance(value, bytes):
            return "X'" + value.hex() + "'"
        return repr(value)
    for kind, name, sql in objects:
        if kind == "table":
            statements.append(sql + ";")
    for kind, name, sql in objects:
        if kind == "table":
            for row in db.execute("SELECT * FROM " + quoted(name)):
                statements.append("INSERT INTO " + quoted(name) + " VALUES (" + ",".join(map(literal, row)) + ");")
    if db.execute("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").fetchone():
        statements.append("DELETE FROM sqlite_sequence;")
        for row in db.execute("SELECT name,seq FROM sqlite_sequence"):
            statements.append("INSERT INTO sqlite_sequence VALUES (" + ",".join(map(literal, row)) + ");")
    for kind, name, sql in objects:
        if kind != "table":
            statements.append(sql + ";")
    return statements


def dump(db):
    return "\n".join(dump_statements(db))


def bookkeeping(db):
    result = []
    for name in ("__alchemy_migrations", "d1_migrations"):
        if db.execute("SELECT 1 FROM sqlite_schema WHERE name=?", (name,)).fetchone():
            columns = [column[1] for column in db.execute("PRAGMA table_info(" + quoted(name) + ")")]
            content = rows(db, name, columns)
            result.append({"table": name, "columns": columns, "rows": len(content), "sha256": digest(json.dumps(content, separators=(",", ":")))})
    return result


def quiescent(db):
    checks = [
        ("workspace", "status NOT IN ('ready','idle','waiting','interrupted','archived','error') OR restart_request IS NOT NULL"),
        ("repository_operation", "status NOT IN ('succeeded','failed','completed','cancelled')"),
        ("deployment", "status IN ('queued','running')"),
        ("agent_sessions", "status NOT IN ('ready','idle','waiting','interrupted','error','archived')"),
        ("ci_runs", "status IN ('queued','running')"),
        ("project_resource_operation", "status = 'deploying'"),
        ("workspace_pending_prompt", "delivered_at IS NULL"),
        ("magic_link_outbox", "1 = 1"),
    ]
    for table, predicate in checks:
        if db.execute("SELECT 1 FROM " + quoted(table) + " WHERE " + predicate + " LIMIT 1").fetchone():
            raise ValueError("Active operations in " + table)


def convert(request):
    if request["sourceCommit"] != SOURCE_COMMIT:
        raise ValueError("Unsupported source commit")
    fixture = (ROOT / "tools/installation-migration/sources/d1-5311a14.sql").read_text()
    if digest(fixture) != SOURCE_HASH:
        raise ValueError("Source fixture integrity failed")
    source = database(request["sql"])
    reference = database(fixture, trusted=True)
    if schema(source) != schema(reference):
        raise ValueError("Unknown source schema")
    history = json.loads((ROOT / "tools/installation-migration/sources/d1-migrations.json").read_text())
    ledgers = [name for name in ("d1_migrations", "__alchemy_migrations") if source.execute("SELECT 1 FROM sqlite_schema WHERE name=?", (name,)).fetchone()]
    if len(ledgers) > 1:
        raise ValueError("Ambiguous source migration bookkeeping")
    for name in ledgers:
        columns = [column[1] for column in source.execute("PRAGMA table_info(" + quoted(name) + ")")]
        expected = ["id", "hash", "created_at", "name", "applied_at"] if name == "__alchemy_migrations" else ["id", "name", "applied_at"]
        if columns != expected:
            raise ValueError("Unknown source migration bookkeeping")
        actual = source.execute("SELECT name" + (",hash" if "hash" in columns else "") + " FROM " + quoted(name) + " ORDER BY name").fetchall()
        desired = [(row["name"], row["sha256"]) if "hash" in columns else (row["name"],) for row in history]
        if actual != desired:
            raise ValueError("Source migration history differs")
    quiescent(source)
    identities = source.execute("SELECT id,claimed_by_user_id FROM installation").fetchall()
    if identities != [(request["installationId"], request["claimedByUserId"])]:
        raise ValueError("Installation identity mismatch")
    workspace_ids = [row[0] for row in source.execute("SELECT id FROM workspace ORDER BY id")]
    if len(set(request["workspaceIds"])) != len(request["workspaceIds"]) or sorted(request["workspaceIds"]) != workspace_ids:
        raise ValueError("Workspace coverage mismatch")
    migrations = sorted((ROOT / "packages/db/migrations").glob("*.sql"))
    target = database("\n".join(path.read_text() for path in migrations), trusted=True)
    target.execute("PRAGMA foreign_keys=OFF")
    for kind, name, owner, sql in schema(target):
        if kind == "table":
            target.execute("DELETE FROM " + quoted(name))
    evidence = []
    for kind, name, owner, sql in schema(source):
        if kind != "table":
            continue
        columns = [row[1] for row in source.execute("PRAGMA table_info(" + quoted(name) + ")")]
        target_columns = [row[1] for row in target.execute("PRAGMA table_info(" + quoted(name) + ")")]
        if not set(columns).issubset(target_columns):
            raise ValueError("Unmapped source columns")
        source_rows = source.execute("SELECT " + ",".join(map(quoted, columns)) + " FROM " + quoted(name)).fetchall()
        target.executemany("INSERT INTO " + quoted(name) + " (" + ",".join(map(quoted, columns)) + ") VALUES (" + ",".join("?" for column in columns) + ")", source_rows)
        expected = rows(source, name, columns)
        if rows(target, name, columns) != expected:
            raise ValueError("Recovered content differs for " + name)
        evidence.append({"table": name, "columns": columns, "rows": len(expected), "sha256": digest(json.dumps(expected, separators=(",", ":")))})
    source_sequences = source.execute("SELECT name,seq FROM sqlite_sequence").fetchall()
    for name, sequence in source_sequences:
        target.execute("DELETE FROM sqlite_sequence WHERE name=?", (name,))
        target.execute("INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)", (name, sequence))
    target.commit()
    check(target)
    target.execute("CREATE TABLE __alchemy_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)")
    target.executemany("INSERT INTO __alchemy_migrations(hash,name) VALUES (?,?)", [(digest(path.read_text()), path.name) for path in migrations])
    target.commit()
    output = dump(target)
    restored = database(output)
    for item in evidence:
        if rows(restored, item["table"], item["columns"]) != rows(source, item["table"], item["columns"]):
            raise ValueError("Independent import content mismatch")
    return {"sourceCommit": SOURCE_COMMIT, "sourceSqlHash": digest(request["sql"]), "targetSql": output, "targetStatements": dump_statements(target), "targetSqlHash": digest(output), "sourceSchemaHash": digest(json.dumps(schema(source), separators=(",", ":"))), "targetSchemaHash": digest(json.dumps(schema(target), separators=(",", ":"))), "workspaceIds": workspace_ids, "workspaceIdentities": [{"id": row[0], "projectId": row[1], "organizationId": row[2], "sessionIds": [session[0] for session in source.execute("SELECT opencode_session_id FROM agent_sessions WHERE workspace_id=? ORDER BY opencode_session_id", (row[0],))]} for row in source.execute("SELECT id,project_id,organization_id FROM workspace ORDER BY id")], "sourceBookkeeping": bookkeeping(source), "targetBookkeeping": bookkeeping(target), "tables": evidence, "targetTables": [{"table": name, "columns": [column[1] for column in target.execute("PRAGMA table_info(" + quoted(name) + ")")], "rows": target.execute("SELECT count(*) FROM " + quoted(name)).fetchone()[0], "sha256": digest(json.dumps(rows(target, name, [column[1] for column in target.execute("PRAGMA table_info(" + quoted(name) + ")")]), separators=(",", ":")))} for kind, name, owner, sql in schema(target) if kind == "table"], "targetMigrations": [{"name": path.name, "sha256": digest(path.read_text())} for path in migrations]}


if __name__ == "__main__":
    try:
        print(json.dumps(convert(json.load(sys.stdin))))
    except Exception as error:
        print("Installation conversion rejected: " + str(error), file=sys.stderr)
        sys.exit(1)
