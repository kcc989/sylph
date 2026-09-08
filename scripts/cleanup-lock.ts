import { readFile, writeFile } from "node:fs/promises"
import { parseArgs, parseEnv } from "node:util"
import { Schema } from "effect"
import { homedir } from "node:os"
import { resolve } from "node:path"
import {
  CleanupLockPlan,
  CleanupLockTarget,
  changeCleanupLock,
  planCleanupLock,
} from "../tools/release-smoke/cleanup-lock"

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: "string" },
    plan: { type: "string" },
    receipt: { type: "string" },
    "confirm-bucket": { type: "string" },
  },
})
const command = positionals[0]
if (!values.plan || !["plan", "install", "remove"].includes(command ?? ""))
  throw new Error(
    "Use plan --target target.json --plan plan.json, or install|remove --plan plan.json --confirm-bucket exact-name --receipt receipt.json"
  )
const configuration = parseEnv(
  await readFile(
    resolve(
      process.env.SYLPH_SMOKE_ENV_FILE ||
        `${process.env.XDG_CONFIG_HOME || `${homedir()}/.config`}/sylph/release-smoke.env`
    ),
    "utf8"
  )
)
const accountId = configuration.CLOUDFLARE_ACCOUNT_ID
const token = configuration.CLOUDFLARE_API_TOKEN
if (!accountId || !token)
  throw new Error(
    "Saved configuration needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN"
  )
const access = { accountId, token }
if (command === "plan") {
  if (!values.target) throw new Error("Provide --target target.json")
  const target = Schema.decodeUnknownSync(CleanupLockTarget)(
    JSON.parse(await readFile(values.target, "utf8"))
  )
  const plan = await planCleanupLock(access, target)
  await writeFile(values.plan, JSON.stringify(plan, null, 2), {
    mode: 0o600,
    flag: "wx",
  })
  console.log(
    `Planned a two-hour lock for ${plan.bucketName}, ${plan.scope}; inspect ${values.plan} before install`
  )
} else if (command === "install" || command === "remove") {
  const plan = Schema.decodeUnknownSync(CleanupLockPlan)(
    JSON.parse(await readFile(values.plan, "utf8"))
  )
  if (values["confirm-bucket"] !== plan.bucketName || !values.receipt)
    throw new Error("Confirm the exact planned bucket and provide --receipt")
  const receipt = await changeCleanupLock(access, plan, command)
  await writeFile(values.receipt, JSON.stringify(receipt, null, 2), {
    mode: 0o600,
    flag: "wx",
  })
  console.log(
    `${command} verified for ${plan.bucketName}; receipt: ${values.receipt}`
  )
}
