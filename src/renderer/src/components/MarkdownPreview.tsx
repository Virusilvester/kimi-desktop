import { useMemo } from 'react'
import MarkdownIt from 'markdown-it'

// html: false — raw HTML in the source is escaped, so the preview needs no
// sanitizer dependency (the XSS surface is closed at the renderer).
const md = new MarkdownIt({ html: false, linkify: true })

interface MarkdownPreviewProps {
  source: string
  containerRef: React.RefObject<HTMLDivElement | null>
}

export default function MarkdownPreview({
  source,
  containerRef
}: MarkdownPreviewProps): React.JSX.Element {
  const html = useMemo(() => md.render(source), [source])

  // Links open in the system browser (routed by the main window's
  // window.open handler), never inside the app window.
  const handleClick = (event: React.MouseEvent): void => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (anchor) {
      event.preventDefault()
      const href = anchor.getAttribute('href')
      if (href && /^https?:\/\//.test(href)) window.open(href)
    }
  }

  return (
    <div
      ref={containerRef}
      className="markdown-preview"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
