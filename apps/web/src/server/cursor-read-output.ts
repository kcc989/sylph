export const cursorReadOutput = (output: string) => {
  const lines = output.split("\n")
  const header = /^Read file (.+), (?:0 lines|lines (\d+)-(\d+))$/.exec(
    lines[0] ?? ""
  )
  if (!header) return output
  const start = Number(header[2] ?? 1)
  const end = Number(header[3] ?? 0)
  const count = end === 0 ? 0 : end - start + 1
  if (count < 0 || count > lines.length - 1) return output
  const body = lines.slice(1, count + 1)
  if (body.some((line, index) => !line.startsWith(`${start + index}: `)))
    return output
  const remainder = lines.slice(count + 1).join("\n")
  const truncated =
    /^\[Output truncated\. Continue reading with offset: (\d+)\]$/.exec(
      remainder
    )
  if (remainder && !truncated) return output
  const footer = truncated
    ? `(Showing lines ${start}-${end}. Use offset=${truncated[1]} to continue.)`
    : start > 1
      ? `(Showing lines ${start}-${end} of ${end}.)`
      : `(End of file - total ${end} lines)`
  return `<path>${header[1]}</path>\n<type>file</type>\n<content>\n${body.join("\n")}\n\n${footer}\n</content>`
}
