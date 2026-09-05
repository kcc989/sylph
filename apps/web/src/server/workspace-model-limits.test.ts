import { expect, test } from "bun:test"
import {
  assertWorkspaceModelRequestSize,
  boundedWorkspaceModelLimits,
  workspaceModelRequestByteLimit,
  workspaceCompactionRequestByteLimit,
} from "./workspace-model-limits"

test("caps large model windows without increasing smaller limits", () => {
  expect(
    boundedWorkspaceModelLimits({ context: 1_000_000, output: 128_000 })
  ).toEqual({ context: 32_768, input: 24_576, output: 4_096 })
  expect(
    boundedWorkspaceModelLimits({ context: 8_000, input: 4_000, output: 2_000 })
  ).toEqual({ context: 8_000, input: 4_000, output: 2_000 })
})

test("allows bounded native compaction to shorten history larger than a normal request", async () => {
  const request = new Request("https://model.example", {
    method: "POST",
    body: "x".repeat(workspaceModelRequestByteLimit + 1),
  })
  await expect(
    assertWorkspaceModelRequestSize(request, "compaction")
  ).resolves.toBeUndefined()
  await expect(
    assertWorkspaceModelRequestSize(request, "build")
  ).rejects.toThrow("Model request stopped")
  const oversized = new Request("https://model.example", {
    method: "POST",
    body: "x".repeat(workspaceCompactionRequestByteLimit + 1),
  })
  await expect(
    assertWorkspaceModelRequestSize(oversized, "compaction")
  ).rejects.toThrow("Model request stopped")
})

test("rejects oversized outbound bodies without consuming the original request", async () => {
  const request = new Request("https://model.example", {
    method: "POST",
    body: "x".repeat(workspaceModelRequestByteLimit + 1),
  })
  await expect(assertWorkspaceModelRequestSize(request)).rejects.toThrow(
    "Model request stopped"
  )
  expect(request.bodyUsed).toBe(false)
})

test("measures encoded bytes and preserves a bounded request", async () => {
  const large = new Request("https://model.example", {
    method: "POST",
    body: "界".repeat(workspaceModelRequestByteLimit / 2),
  })
  await expect(assertWorkspaceModelRequestSize(large)).rejects.toThrow(
    "Model request stopped"
  )
  const small = new Request("https://model.example", {
    method: "POST",
    body: "small prompt",
  })
  await assertWorkspaceModelRequestSize(small)
  expect(await small.text()).toBe("small prompt")
})
