import { execFileSync } from "node:child_process"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { EarlierInstallationCommit } from "@workspace/domain/installation-migration"
import type { InstallationPreservationSource } from "@workspace/domain/installation-preservation"
import {
  inspectPreservedSql,
  preservationHash,
  sealInstallation,
  verifyPreservedCredentials,
} from "../../release-smoke/preservation"

export function installationFixture() {
  const rootSecret = "fixture-credential-root"
  const key = Buffer.from(randomBytes(32))
  const iv = randomBytes(12)
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(rootSecret).digest(),
    iv
  )
  const encrypted = Buffer.concat([
    cipher.update("fixture-project-secret"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64")
  const sql = execFileSync(
    "python3",
    [
      "-c",
      `import json,runpy,sys
fixture=runpy.run_path(sys.argv[1])
db=fixture['fixture']()
credential=json.load(sys.stdin)
db.execute("UPDATE project_secret SET encrypted=?,iv=?",(credential['encrypted'],credential['iv']))
db.execute("UPDATE workspace SET id='workspace-a'")
db.commit()
print(fixture['converter'].dump(db))`,
      new URL("./convert_test.py", import.meta.url).pathname,
    ],
    {
      encoding: "utf8",
      input: JSON.stringify({
        encrypted,
        iv: Buffer.from(iv).toString("base64"),
      }),
    }
  ).trimEnd()
  const source: InstallationPreservationSource = {
    accountId: "fixture-account",
    stage: "fixture-source",
    sourceCommit: EarlierInstallationCommit,
    websiteWorker: "fixture-website",
    runtimeWorkers: ["fixture-runtime"],
    databaseId: "source-database",
    installationId: "default",
    claimedByUserId: "owner",
  }
  const database = inspectPreservedSql(sql)
  const preservedSource = JSON.stringify(
    sealInstallation(
      {
        version: 1,
        scope: "d1-and-key-preservation-with-retained-runtime",
        createdAt: "2026-09-07T00:00:00.000Z",
        source,
        bindings: [
          {
            worker: "fixture-runtime",
            name: "WORKSPACES",
            type: "durable_object_namespace",
            resourceId: "source-namespace",
          },
        ],
        workerVersions: [],
        sql,
        sqlHash: preservationHash(sql),
        database,
        keys: {
          credentialEncryptionKey: rootSecret,
          betterAuthSecret: "fixture-auth-secret",
        },
        credentialRowsVerified: verifyPreservedCredentials(
          database,
          rootSecret
        ),
        retainedState: "original-workers-and-namespaces-required",
      },
      key
    )
  )
  const statements = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `import json,sqlite3,sys
sql=sys.stdin.read()
statements=[]
pending=''
for line in sql.splitlines(keepends=True):
 pending+=line
 if sqlite3.complete_statement(pending):
  statements.append(pending.strip())
  pending=''
if pending.strip(): raise Exception('Incomplete fixture SQL')
print(json.dumps(statements))`,
      ],
      { input: sql, encoding: "utf8" }
    )
  )
  return { sql, statements, source, key, preservedSource }
}
