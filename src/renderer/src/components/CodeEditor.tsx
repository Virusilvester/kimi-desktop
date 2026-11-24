import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'

export interface CodeEditorHandle {
  getScrollDOM: () => HTMLElement | null
}

interface CodeEditorProps {
  value: string
  fileName: string // drives syntax highlighting
  onChange: (value: string) => void
  onSave: () => void
}

// Direct CM6 wrapper (no React binding): the parent owns the document, the
// component owns the view. Language support loads async per file extension.
const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, fileName, onChange, onSave },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageCompartmentRef = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  }, [onChange, onSave])

  useEffect(() => {
    const view = new EditorView({
      parent: containerRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                onSaveRef.current()
                return true
              }
            }
          ]),
          basicSetup,
          languageCompartmentRef.current.of([]),
          oneDark,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '13px' },
            '.cm-scroller': { fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace" }
          })
        ]
      })
    })
    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
    // The view is created once; the document is synced by the effect below.
  }, [])

  // External document replacement (file switch, reload). The comparison
  // keeps the onChange -> value round-trip from re-dispatching.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (value !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    let cancelled = false
    const description = LanguageDescription.matchFilename(languages, fileName)
    if (!description) {
      viewRef.current?.dispatch({
        effects: languageCompartmentRef.current.reconfigure([])
      })
      return
    }
    description
      .load()
      .then((support) => {
        if (!cancelled) {
          viewRef.current?.dispatch({
            effects: languageCompartmentRef.current.reconfigure(support)
          })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [fileName])

  useImperativeHandle(
    ref,
    () => ({
      getScrollDOM: () => viewRef.current?.scrollDOM ?? null
    }),
    []
  )

  return <div ref={containerRef} className="code-editor" />
})

export default CodeEditor
