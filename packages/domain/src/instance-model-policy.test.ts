import { describe, expect, test } from "bun:test"
import {
  instanceModelEnabled,
  validateInstanceModelPolicy,
} from "./instance-model-policy"

const enabled = { providerId: "openrouter", modelId: "selected" }
const disabled = { providerId: "openrouter", modelId: "new-model" }
const policy = { models: [enabled], defaultModel: enabled }

describe("instance model policy", () => {
  test("requires both provider and model to be enabled", () => {
    expect(instanceModelEnabled(policy, enabled)).toBe(true)
    expect(instanceModelEnabled(policy, disabled)).toBe(false)
    expect(
      instanceModelEnabled(policy, { ...enabled, providerId: "other" })
    ).toBe(false)
    expect(
      instanceModelEnabled({ models: [], defaultModel: null }, enabled)
    ).toBe(false)
  })

  test("allows an enabled default and an explicitly empty policy", () => {
    expect(() =>
      validateInstanceModelPolicy(policy, [enabled, disabled])
    ).not.toThrow()
    expect(() =>
      validateInstanceModelPolicy({ models: [], defaultModel: null }, [enabled])
    ).not.toThrow()
  })

  test("rejects fabricated selections and duplicate models", () => {
    expect(() => validateInstanceModelPolicy(policy, [disabled])).toThrow(
      "connected provider catalog"
    )
    expect(() =>
      validateInstanceModelPolicy({ ...policy, models: [enabled, enabled] }, [
        enabled,
      ])
    ).toThrow("only be selected once")
  })

  test("requires the default to belong to the enabled list", () => {
    for (const invalid of [
      { models: [enabled], defaultModel: disabled },
      { models: [enabled], defaultModel: null },
      { models: [], defaultModel: enabled },
    ]) {
      expect(() =>
        validateInstanceModelPolicy(invalid, [enabled, disabled])
      ).toThrow("enabled default model")
    }
  })
})
