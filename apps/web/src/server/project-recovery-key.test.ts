import { expect, test } from "bun:test"
import {
  projectRecoveryKey,
  projectRecoveryVerifyToken,
} from "./project-recovery-key"

test("recovery encryption and verification keys are stable and scoped to one Project", async () => {
  const first = await projectRecoveryKey("one", "installation-secret")
  expect(atob(first).length).toBe(32)
  expect(await projectRecoveryKey("one", "installation-secret")).toBe(first)
  expect(await projectRecoveryKey("two", "installation-secret")).not.toBe(first)
  expect(
    await projectRecoveryVerifyToken("one", "installation-secret")
  ).not.toBe(first)
  expect(
    await projectRecoveryKey("one", "rotated-installation-secret")
  ).not.toBe(first)
})
