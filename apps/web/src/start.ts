import { createSerializationAdapter } from "@tanstack/react-router"
import { createStart } from "@tanstack/react-start"
import {
  decodeServerFailure,
  encodeServerFailure,
  isServerFailure,
  type ServerFailure,
} from "@workspace/domain"

const serverFailureAdapter = createSerializationAdapter({
  key: "sylph/server-failure",
  test: (value): value is ServerFailure => isServerFailure(value),
  toSerializable: (failure) => encodeServerFailure(failure),
  fromSerializable: (encoded) => decodeServerFailure(encoded),
})

export const startInstance = createStart(() => ({
  serializationAdapters: [serverFailureAdapter],
}))

declare module "@tanstack/react-start" {
  interface Register {
    config: Awaited<ReturnType<typeof startInstance.getOptions>>
  }
}
