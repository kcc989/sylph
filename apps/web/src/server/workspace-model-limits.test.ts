import { expect, test } from "bun:test"
import {
  assertWorkspaceModelRequestSize,
  boundedWorkspaceModelLimits,
  workspaceModelRequestByteLimit,
  workspaceCompactionRequestByteLimit,
  workspaceModelRequestLimit,
} from "./workspace-model-limits"

test("accepts ordinary coding history within a large model context window", async () => {
  const request = new Request("https://model.example", {
    method: "POST",
    body: JSON.stringify({ messages: [{ content: "code ".repeat(50_000) }] }),
  })
  await expect(
    assertWorkspaceModelRequestSize(
      request,
      "build",
      workspaceModelRequestLimit({ context: 1_000_000, output: 4_096 })
    )
  ).resolves.toBeUndefined()
  expect(request.bodyUsed).toBe(false)
})

test("uses a smaller advertised input limit and retains a transport ceiling", () => {
  expect(
    workspaceModelRequestLimit({
      context: 1_000_000,
      input: 16_000,
      output: 4_096,
    })
  ).toBe(workspaceModelRequestByteLimit + 16_000 * 8)
  expect(
    workspaceModelRequestLimit({ context: 10_000_000, output: 4_096 })
  ).toBe(8 * 1024 * 1024)
  expect(workspaceModelRequestLimit({ context: 0, output: 4_096 })).toBe(
    workspaceModelRequestByteLimit
  )
})

test("preserves provider context windows while bounding generated output", () => {
  expect(
    boundedWorkspaceModelLimits({ context: 1_000_000, output: 128_000 })
  ).toEqual({ context: 1_000_000, output: 4_096 })
  expect(
    boundedWorkspaceModelLimits({
      context: 256_000,
      input: 240_000,
      output: 32_000,
    })
  ).toEqual({ context: 256_000, input: 240_000, output: 4_096 })
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
