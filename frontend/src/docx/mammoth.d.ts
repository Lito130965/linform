declare module 'mammoth' {
  interface MammothMessage {
    type: string
    message: string
  }
  interface MammothResult {
    value: string
    messages: MammothMessage[]
  }
  function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: Record<string, unknown>,
  ): Promise<MammothResult>
  const mammoth: { convertToHtml: typeof convertToHtml }
  export default mammoth
}
