import { Schema } from "effect"

type ToolInputSchema = Schema.Constraint & {
  readonly fields: Schema.Struct.Fields
}

export const toolJsonSchema = (schema: ToolInputSchema) => {
  if (Object.keys(schema.fields).length === 0) {
    return {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    }
  }
  const document = Schema.toJsonSchemaDocument(schema, {
    referencePolicy: () => undefined,
  })
  return { ...document.schema, $defs: document.definitions }
}
