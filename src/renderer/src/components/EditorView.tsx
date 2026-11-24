import { useCallback, useEffect, useRef, useState } from 'react'
import CodeEditor, { CodeEditorHandle } from './CodeEditor'
import MarkdownPreview from './MarkdownPreview'
import RunPanel from './RunPanel'
import { offlineManager } from '../utils/offlineManager'
import '../assets/EditorView.css'

interface EditorViewProps {
  chatId: string | null
  active: boolean
  onClose: () => void
  skillArmed: boolean
  onToggleSkill: () => void
}

interface ArtifactFile {
  path: string
  size: number
  mtimeMs: number
}

type ViewMode = 'edit' | 'split' | 'preview'

const isMarkdown = (path: string | null): boolean => path !== null && /\.(md|markdown)$/i.test(path)

// The editor surface: artifacts of one chat directory (<workspace>/<chatId>/),
// markdown preview with scroll sync, and the tier-1 run console docked below.
export default function EditorView({
  chatId,
  active,
  onClose,
  skillArmed,
  onToggleSkill
}: EditorViewProps): React.JSX.Element {
  const [activeChatId, setActiveChatId] = useState<string | null>(chatId)
  const [workspaceState, setWorkspaceState] = useState<'loading' | 'ready' | 'unset'>('loading')
  const [chatDirs, setChatDirs] = useState<Array<{ id: string; title: string }>>([])
  const [files, setFiles] = useState<ArtifactFile[]>([])
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
  const [error, setError] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState<string | null>(null)
  const editorHandleRef = useRef<CodeEditorHandle | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const scrollSyncingRef = useRef(false)
  const chordRef = useRef(false)

  const dirty = fileContent !== savedContent

  // Workspace root: set → load chat dirs for the picker; unset → prompt.
  const initWorkspace = useCallback(async (): Promise<void> => {
    setWorkspaceState('loading')
    const result = await window.api?.fsList('')
    if (!result?.success) {
      setWorkspaceState('unset')
      return
    }
    const dirs = (result.entries ?? []).filter((e) => e.isDirectory)
    let titles = new Map<string, string>()
    try {
      const conversations = await offlineManager.getAllConversations()
      titles = new Map(conversations.map((c) => [c.id, c.title]))
    } catch {
      // titles are cosmetic — fall back to ids
    }
    setChatDirs(dirs.map((d) => ({ id: d.name, title: titles.get(d.name) ?? d.name })))
    setWorkspaceState('ready')
  }, [])

  useEffect(() => {
    void initWorkspace()
  }, [initWorkspace])

  const refreshFiles = useCallback(async (): Promise<void> => {
    if (!activeChatId) return
    const result = await window.api?.fsListRecursive(activeChatId)
    if (result?.success) {
      setFiles(result.files ?? [])
    } else {
      setError(result?.error ?? 'Failed to list artifacts')
    }
  }, [activeChatId])

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles])

  // The workspace root can change while the editor stays mounted (Settings →
  // Workspace Folder): the open buffer belongs to the old root, so close it
  // and re-init instead of writing it into the new root on the next save.
  const workspaceRootRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    window.api
      ?.getSettings?.()
      .then((settings) => {
        if (!cancelled && workspaceRootRef.current === undefined) {
          workspaceRootRef.current = settings?.workspaceRoot ?? null
        }
      })
      .catch(() => {})
    const off = window.api?.onSettingsChanged?.((settings) => {
      const next = settings?.workspaceRoot ?? null
      const prev = workspaceRootRef.current
      workspaceRootRef.current = next
      if (prev === undefined || prev === next) return
      setCurrentFile(null)
      setFileContent('')
      setSavedContent('')
      void initWorkspace()
      void refreshFiles()
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [initWorkspace, refreshFiles])

  const openFile = useCallback(
    async (path: string): Promise<void> => {
      if (!activeChatId) return
      if (dirty && !window.confirm('Unsaved changes will be lost. Continue?')) return
      const result = await window.api?.fsRead(`${activeChatId}/${path}`)
      if (result?.success && result.content !== undefined) {
        setCurrentFile(path)
        setFileContent(result.content)
        setSavedContent(result.content)
        setError(null)
        if (!isMarkdown(path)) setViewMode('edit')
      } else {
        setError(result?.error ?? 'Failed to open the file')
      }
    },
    [activeChatId, dirty]
  )

  const saveCurrentFile = useCallback(async (): Promise<boolean> => {
    if (!activeChatId || !currentFile) return false
    const result = await window.api?.fsWrite(`${activeChatId}/${currentFile}`, fileContent)
    if (result?.success) {
      setSavedContent(fileContent)
      setError(null)
      return true
    }
    setError(result?.error ?? 'Failed to save the file')
    return false
  }, [activeChatId, currentFile, fileContent])

  const handleCreateFile = async (): Promise<void> => {
    const name = newFileName?.trim()
    if (!name || !activeChatId) return
    if (name.startsWith('/') || name.split('/').includes('..')) {
      setError('Invalid file name')
      return
    }
    const result = await window.api?.fsWrite(`${activeChatId}/${name}`, '')
    if (result?.success) {
      setNewFileName(null)
      await refreshFiles()
      await openFile(name)
    } else {
      setError(result?.error ?? 'Failed to create the file')
    }
  }

  const chooseWorkspace = async (): Promise<void> => {
    const picked = await window.api?.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    const path = picked?.filePaths?.[0]
    if (!path) return
    const settings = (await window.api?.getSettings?.()) || {}
    const result = await window.api?.saveSettings?.({ ...settings, workspaceRoot: path })
    if (result?.success) {
      await initWorkspace()
    } else {
      setError('Failed to save the workspace folder')
    }
  }

  // Markdown shortcuts (VS Code): Ctrl+Shift+V toggles the preview,
  // Ctrl+K V opens the split. No listener while the editor is hidden: the
  // mounted-but-hidden editor must not intercept keystrokes on the chat
  // surface.
  useEffect(() => {
    if (!active) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isMarkdown(currentFile)) return
      if (event.ctrlKey && event.shiftKey && event.key === 'V') {
        event.preventDefault()
        setViewMode((mode) => (mode === 'preview' ? 'edit' : 'preview'))
        return
      }
      if (event.ctrlKey && event.key === 'k') {
        chordRef.current = true
        setTimeout(() => {
          chordRef.current = false
        }, 1000)
        return
      }
      if (chordRef.current && event.key === 'v') {
        event.preventDefault()
        chordRef.current = false
        setViewMode('split')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [active, currentFile])

  // Two-way scroll sync in split mode (ratio-based, loop-guarded).
  useEffect(() => {
    if (viewMode !== 'split') return
    const editorDOM = editorHandleRef.current?.getScrollDOM()
    const previewDOM = previewRef.current
    if (!editorDOM || !previewDOM) return

    const sync = (from: HTMLElement, to: HTMLElement): void => {
      if (scrollSyncingRef.current) return
      scrollSyncingRef.current = true
      const max = Math.max(from.scrollHeight - from.clientHeight, 1)
      to.scrollTop = (from.scrollTop / max) * Math.max(to.scrollHeight - to.clientHeight, 1)
      requestAnimationFrame(() => {
        scrollSyncingRef.current = false
      })
    }
    const fromEditor = (): void => sync(editorDOM, previewDOM)
    const fromPreview = (): void => sync(previewDOM, editorDOM)
    editorDOM.addEventListener('scroll', fromEditor)
    previewDOM.addEventListener('scroll', fromPreview)
    return () => {
      editorDOM.removeEventListener('scroll', fromEditor)
      previewDOM.removeEventListener('scroll', fromPreview)
    }
  }, [viewMode, currentFile])

  // --- workspace unset prompt ---
  if (workspaceState === 'unset') {
    return (
      <div className="editor-view">
        <div className="editor-placeholder">
          <div className="empty-icon">🗂️</div>
          <p>Choose a workspace folder to edit chat artifacts.</p>
          <p className="editor-placeholder-sub">
            Each chat keeps its files in a folder of its own under this directory.
          </p>
          <button className="btn-primary" onClick={() => void chooseWorkspace()}>
            Choose Folder…
          </button>
          <button className="btn-secondary" onClick={onClose}>
            ← Back to Chat
          </button>
        </div>
      </div>
    )
  }

  // --- chat picker (no chat selected) ---
  if (workspaceState === 'ready' && !activeChatId) {
    return (
      <div className="editor-view">
        <div className="editor-placeholder">
          <div className="empty-icon">📁</div>
          <p>Pick a chat directory to edit its artifacts.</p>
          {chatDirs.length === 0 ? (
            <p className="editor-placeholder-sub">
              No chat folders yet — open a chat&apos;s artifacts to create one.
            </p>
          ) : (
            <div className="chat-dir-list">
              {chatDirs.map((dir) => (
                <button
                  key={dir.id}
                  className="chat-dir-item"
                  onClick={() => setActiveChatId(dir.id)}
                >
                  <span className="chat-dir-title">{dir.title}</span>
                  <span className="chat-dir-id">{dir.id}</span>
                </button>
              ))}
            </div>
          )}
          <button className="btn-secondary" onClick={onClose}>
            ← Back to Chat
          </button>
        </div>
      </div>
    )
  }

  const markdownOpen = isMarkdown(currentFile)

  return (
    <div className="editor-view">
      <div className="editor-sidebar">
        <div className="editor-sidebar-header">
          <span>Artifacts</span>
          <div className="editor-sidebar-actions">
            <button title="New file" onClick={() => setNewFileName('')}>
              ＋
            </button>
            <button title="Refresh" onClick={() => void refreshFiles()}>
              🔄
            </button>
          </div>
        </div>
        {newFileName !== null && (
          <div className="new-file-row">
            <input
              autoFocus
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateFile()
                if (e.key === 'Escape') setNewFileName(null)
              }}
              placeholder="name.md or src/script.py"
              spellCheck={false}
            />
          </div>
        )}
        <div className="artifact-list">
          {files.length === 0 ? (
            <div className="artifact-empty">No files yet — create the first one.</div>
          ) : (
            files.map((file) => (
              <button
                key={file.path}
                className={`artifact-item${currentFile === file.path ? ' active' : ''}`}
                onClick={() => void openFile(file.path)}
                title={file.path}
              >
                {file.path}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="editor-content">
        <div className="editor-toolbar">
          <button className="editor-back" onClick={onClose} title="Back to chat">
            ←
          </button>
          <span className="editor-filename">
            {currentFile ?? 'No file open'}
            {dirty && <span className="dirty-dot">●</span>}
          </span>
          {markdownOpen && (
            <div className="mode-toggle">
              <button
                className={viewMode === 'edit' ? 'active' : ''}
                onClick={() => setViewMode('edit')}
              >
                Edit
              </button>
              <button
                className={viewMode === 'split' ? 'active' : ''}
                onClick={() => setViewMode('split')}
                title="Ctrl+K V"
              >
                Split
              </button>
              <button
                className={viewMode === 'preview' ? 'active' : ''}
                onClick={() => setViewMode('preview')}
                title="Ctrl+Shift+V"
              >
                Preview
              </button>
            </div>
          )}
          <button
            className="editor-save"
            onClick={() => void saveCurrentFile()}
            disabled={!dirty}
            title="Ctrl+S"
          >
            Save
          </button>
        </div>

        {error && (
          <div className="editor-error">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        <div className="editor-body">
          {currentFile ? (
            <>
              <div
                className="editor-pane"
                style={{ display: viewMode === 'preview' ? 'none' : 'block' }}
              >
                <CodeEditor
                  ref={editorHandleRef}
                  value={fileContent}
                  fileName={currentFile}
                  onChange={setFileContent}
                  onSave={() => void saveCurrentFile()}
                />
              </div>
              {markdownOpen && viewMode !== 'edit' && (
                <div className="editor-pane preview-pane">
                  <MarkdownPreview source={fileContent} containerRef={previewRef} />
                </div>
              )}
            </>
          ) : (
            <div className="editor-placeholder">
              <p>Select an artifact on the left, or create a new file.</p>
            </div>
          )}
        </div>

        {activeChatId && (
          <RunPanel
            chatId={activeChatId}
            currentFile={currentFile}
            skillArmed={skillArmed}
            onToggleSkill={onToggleSkill}
            saveCurrentFile={saveCurrentFile}
          />
        )}
      </div>
    </div>
  )
}
