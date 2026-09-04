import { describe, expect, test } from "bun:test"
import * as domain from "./index"
import { SkillResourceJsonSchema } from "./skills"

describe("workspace tool JSON schemas", () => {
  test("uses object roots that Grok accepts for every workspace tool", () => {
    const schemas = Object.entries(domain).filter(([name]) =>
      name.endsWith("JsonSchema")
    )
    expect(schemas.length).toBeGreaterThan(10)
    for (const [name, schema] of schemas) {
      expect(schema, name).toHaveProperty("type", "object")
      expect(schema, name).not.toHaveProperty("$ref")
    }
  })

  test("keeps skill resource validation fields inline", () => {
    expect(SkillResourceJsonSchema).toMatchObject({
      type: "object",
      required: ["skill", "path"],
      properties: { skill: { type: "string" }, path: { type: "string" } },
      additionalProperties: false,
    })
  })
})
