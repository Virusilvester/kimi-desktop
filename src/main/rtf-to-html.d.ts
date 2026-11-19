declare module '@iarna/rtf-to-html' {
  interface RtfToHTML {
    fromString(rtf: string, callback: (error: Error | null, html: string) => void): void
  }
  const rtfToHTML: RtfToHTML
  export = rtfToHTML
}
