declare module "hpack.js" {
  import { Duplex } from "node:stream"
  type Header = { name: string; value: string; neverIndex?: boolean }
  type Options = { table: { maxSize: number } }
  export const compressor: {
    create(options: Options): Duplex & { write(headers: Header[]): boolean }
  }
  export const decompressor: {
    create(options: Options): Duplex & { execute(): void }
  }
}
