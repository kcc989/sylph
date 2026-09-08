export declare const cursorProtocolPlugin: () => {
  name: string
  transform: (
    source: string,
    id: string
  ) => Promise<{ code: string; map: null } | undefined>
}
