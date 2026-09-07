import { appendFile, readFile } from "node:fs/promises"
import { deployedWebsite } from "../tools/release-smoke/config.mjs"

const path = process.argv[2]
if (!path) throw new Error("Pass the deployment log path")
const url = deployedWebsite(await readFile(path, "utf8"))
const setup = new URL("/setup", url).href
console.log(`Sylph: ${url}\nFinish setup: ${setup}`)
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `\nSylph is deployed. [Open Sylph](${url}) · [Finish setup](${setup})\n\nUse your saved setup code to connect GitHub and claim this Installation. Rerunning this workflow keeps the deployment's credentials and saved setup.\n`
  )
}
