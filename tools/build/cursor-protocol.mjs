import { pathToFileURL } from "node:url"
import staticModule from "protobufjs-cli/targets/static-module.js"

export const cursorProtocolPlugin = () => ({
  name: "sylph-cursor-static-protocol",
  async transform(source, id) {
    if (!id.endsWith("/cursor-opencode-provider/dist/protocol/messages.js"))
      return
    const { createMessageTypes } = await import(pathToFileURL(id).href)
    const generated = await new Promise((resolve, reject) => {
      staticModule(
        createMessageTypes(),
        {
          wrap: "es6",
          root: "sylph-cursor",
          encode: true,
          decode: true,
          verify: true,
          convert: true,
          create: true,
          delimited: false,
          comments: false,
        },
        (error, output) => (error ? reject(error) : resolve(output))
      )
    })
    const tail = source.indexOf("export function encodeMessage(")
    if (tail < 0) throw new Error("Cursor protocol exports changed")
    return {
      code: `${generated.replaceAll("$Writer.create()", "new $Writer()")}
const protobuf = $protobuf;
export function createMessageTypes() {
  return { lookupType(name) {
    const type = $root[name];
    if (!type) throw new Error('Unknown Cursor message type: ' + name);
    return type;
  } };
}
export const getMessageTypes = createMessageTypes;
${source.slice(tail)}`,
      map: null,
    }
  },
})
