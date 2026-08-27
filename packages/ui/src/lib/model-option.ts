import { z } from "zod"

export interface ModelOptionValue {
  providerId: string
  modelId: string
}

const ModelOptionValueSchema = z.tuple([z.string().min(1), z.string().min(1)])

export const encodeModelOption = ({ providerId, modelId }: ModelOptionValue) =>
  JSON.stringify([providerId, modelId])

export const decodeModelOption = (value: string): ModelOptionValue | null => {
  try {
    const decoded = ModelOptionValueSchema.safeParse(JSON.parse(value))
    return decoded.success
      ? { providerId: decoded.data[0], modelId: decoded.data[1] }
      : null
  } catch {
    return null
  }
}
