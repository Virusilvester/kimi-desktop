import { clipboard, nativeImage } from 'electron'
import rtfToHTML from '@iarna/rtf-to-html'

export type ClipboardReadFormat = 'text' | 'html' | 'rich-text' | 'image'
export type ClipboardWriteFormat = 'text' | 'html' | 'image'

export const CLIPBOARD_READ_FORMATS: readonly ClipboardReadFormat[] = [
  'text',
  'html',
  'rich-text',
  'image'
]
export const CLIPBOARD_WRITE_FORMATS: readonly ClipboardWriteFormat[] = ['text', 'html', 'image']

// Platform-specific RTF clipboard format name. Linux-first project, but the
// mapping keeps the module honest elsewhere.
function rtfClipboardFormat(): string {
  if (process.platform === 'darwin') return 'public.rtf'
  if (process.platform === 'win32') return 'Rich Text Format'
  return 'text/rtf'
}

// @iarna/rtf-to-html emits a full HTML document; callers of 'rich-text' want a
// paste-ready fragment instead.
function rtfToFragment(rtf: string): Promise<string | null> {
  return new Promise((resolve) => {
    rtfToHTML.fromString(rtf, (error, html) => {
      if (error) {
        console.error('[Clipboard] RTF to HTML conversion failed:', error)
        resolve(null)
        return
      }
      const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
      const fragment = (match ? match[1] : html).trim()
      resolve(fragment.length > 0 ? fragment : null)
    })
  })
}

function plainTextFromHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim()
}

export async function readClipboard(format: ClipboardReadFormat): Promise<string | null> {
  switch (format) {
    case 'text':
      return clipboard.readText()
    case 'html':
      // The native text/html clipboard layer, when the source app provided one.
      return clipboard.readHTML() || null
    case 'rich-text': {
      const html = clipboard.readHTML()
      if (html) return html
      const rtf = clipboard.read(rtfClipboardFormat())
      if (!rtf) return null
      // Converter quirk: an RTF paragraph not terminated by \par is dropped,
      // so unterminated trailing text comes back as null.
      return rtfToFragment(rtf)
    }
    case 'image': {
      const image = clipboard.readImage()
      if (image.isEmpty()) return null
      return image.toDataURL()
    }
  }
}

export function writeClipboard(format: ClipboardWriteFormat, value: string): boolean {
  switch (format) {
    case 'text':
      clipboard.writeText(value)
      return true
    case 'html':
      // Plain-text fallback alongside the HTML payload, as native clipboards
      // expect both layers.
      clipboard.write({ text: plainTextFromHtml(value), html: value })
      return true
    case 'image': {
      const image = nativeImage.createFromDataURL(value)
      if (image.isEmpty()) return false
      clipboard.write({ image })
      return true
    }
  }
}
