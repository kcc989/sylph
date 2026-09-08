import importlib.util
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("convert", ROOT / "convert.py")
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


def fixture():
    db = converter.database((ROOT / "sources/d1-5311a14.sql").read_text(), trusted=True)
    db.executescript("""
    INSERT INTO user(id,name,email) VALUES ('owner','Owner','owner@example.test');
    INSERT INTO organization(id,name,slug) VALUES ('org','Organization','org');
    UPDATE installation SET organization_id='org',claimed_by_user_id='owner',claimed_at=1;
    INSERT INTO project(id,organization_id,owner_user_id,name,slug,artifact_repo_id,artifact_repo,artifact_remote) VALUES ('project','org','owner','Project','project','artifact','org/repo','https://repo.test');
    INSERT INTO workspace(id,project_id,organization_id,owner_user_id,title,status,base_artifact_repo,workspace_artifact_repo) VALUES ('workspace','project','org','owner','Workspace','ready','base','fork');
    INSERT INTO project_secret(project_id,environment,name,encrypted,iv) VALUES ('project','production','SECRET','opaque-ciphertext','opaque-iv');
    INSERT INTO workspace_pending_prompt(id,workspace_id,user_id,payload,created_at,delivered_at) VALUES ('prompt','workspace','owner','{"text":"retained"}',1,2);
    DELETE FROM workspace_pending_prompt;
    """)
    db.execute("UPDATE workspace SET title=?", ("Binary\x00text😀",))
    db.commit()
    return db


def request(db):
    return {"sourceCommit": converter.SOURCE_COMMIT, "sql": converter.dump(db), "installationId": "default", "claimedByUserId": "owner", "workspaceIds": ["workspace"]}


class Conversion(unittest.TestCase):
    def test_copies_all_columns_ciphertext_identity_and_sequence(self):
        original = fixture()
        result = converter.convert(request(original))
        restored = converter.database(result["targetSql"])
        self.assertEqual(restored.execute("SELECT encrypted,iv FROM project_secret").fetchall(), [("opaque-ciphertext", "opaque-iv")])
        self.assertEqual(restored.execute("SELECT title FROM workspace").fetchone(), ("Binary\x00text😀",))
        self.assertEqual(restored.execute("SELECT seq FROM sqlite_sequence WHERE name='workspace_pending_prompt'").fetchone(), (1,))
        self.assertEqual(len(result["tables"]), sum(1 for row in converter.schema(original) if row[0] == "table"))
        self.assertEqual(restored.execute("SELECT repair_commit FROM workspace").fetchone(), (None,))

    def test_rejects_active_work_and_coverage_drift(self):
        for workspace_ids in ([], ["workspace", "workspace"], ["workspace", "extra"]):
            value = request(fixture())
            value["workspaceIds"] = workspace_ids
            with self.assertRaisesRegex(ValueError, "coverage"):
                converter.convert(value)
        db = fixture()
        db.execute("UPDATE workspace SET status='running'")
        with self.assertRaisesRegex(ValueError, "Active operations"):
            converter.convert(request(db))

    def test_rejects_unknown_schema_source_and_identity(self):
        db = fixture()
        db.execute("CREATE TABLE unmapped(secret TEXT)")
        with self.assertRaisesRegex(ValueError, "Unknown source schema"):
            converter.convert(request(db))
        for key, value in (("sourceCommit", "a" * 40), ("claimedByUserId", "stranger")):
            data = request(fixture())
            data[key] = value
            with self.assertRaises(ValueError):
                converter.convert(data)


if __name__ == "__main__":
    unittest.main()
