import { useCallback, useEffect, useRef, useState } from 'react'

type ResolvedRun = {
  spec: { command: string; env?: Record<string, string>; cwd?: string; timeoutSec?: number }
  source: 'builtin' | 'run-json'
  matchedGlob?: string
  hint?: string
}

interface RunPanelProps {
  chatId: string
  currentFile: string | null
  skillArmed: boolean
  onToggleSkill: () => void
  saveCurrentFile: () => Promise<boolean>
}

interface OutputChunk {
  stream: 'stdout' | 'stderr' | 'system'
  data: string
}

const OUTPUT_MAX_CHARS = 100_000
const HISTORY_MAX = 50

const historyKey = (chatId: string): string => `run-history:${chatId}`

function loadHistory(chatId: string): string[] {
  try {
    const raw = localStorage.getItem(historyKey(chatId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : []
  } catch {
    return []
  }
}

// Tier-1 run console: the resolved command (built-in table < run.json) is
// prefilled; editing it is the free-form level. No stdin — interactive
// programs do not fit here (the run.json skill says so too).
export default function RunPanel({
  chatId,
  currentFile,
  skillArmed,
  onToggleSkill,
  saveCurrentFile
}: RunPanelProps): React.JSX.Element {
  const [resolved, setResolved] = useState<ResolvedRun | null>(null)
  const [runJsonError, setRunJsonError] = useState<string | null>(null)
  const [command, setCommand] = useState('')
  const [chunks, setChunks] = useState<OutputChunk[]>([])
  const [runningId, setRunningId] = useState<string | null>(null)
  const [exitInfo, setExitInfo] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>(() => loadHistory(chatId))
  const runningIdRef = useRef<string | null>(null)
  const outputRef = useRef<HTMLDivElement | null>(null)

  // Resolve the command for the current file; prefill the editable command.
  useEffect(() => {
    setExitInfo(null)
    if (!currentFile) {
      setResolved(null)
      setRunJsonError(null)
      setCommand('')
      return
    }
    let cancelled = false
    window.api
      ?.procResolve(chatId, currentFile)
      .then((result) => {
        if (cancelled) return
        if (!result?.success) {
          setResolved(null)
          setRunJsonError(result?.error ?? 'Resolve failed')
          setCommand('')
          return
        }
        const next = (result.resolved ?? null) as ResolvedRun | null
        setResolved(next)
        setRunJsonError(result.runJsonError ?? null)
        setCommand(next?.spec.command ?? '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [chatId, currentFile])

  // Per-chat command history.
  useEffect(() => {
    setHistory(loadHistory(chatId))
    setChunks([])
    setExitInfo(null)
  }, [chatId])

  // Process events, filtered to the run this panel started.
  useEffect(() => {
    const offOutput = window.api?.onProcOutput?.((event) => {
      if (event.id !== runningIdRef.current) return
      setChunks((prev) => {
        const next = [...prev, { stream: event.stream, data: event.data }]
        let total = next.reduce((sum, c) => sum + c.data.length, 0)
        while (total > OUTPUT_MAX_CHARS && next.length > 1) {
          total -= next[0].data.length
          next.shift()
        }
        return next
      })
    })
    const offExit = window.api?.onProcExit?.((event) => {
      if (event.id !== runningIdRef.current) return
      runningIdRef.current = null
      setRunningId(null)
      setExitInfo(
        event.code !== null ? `exit ${event.code}` : `killed (${event.signal ?? 'signal'})`
      )
    })
    return () => {
      offOutput?.()
      offExit?.()
    }
  }, [])

  // Autoscroll the output on new chunks.
  useEffect(() => {
    const el = outputRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chunks])

  const pushHistory = useCallback(
    (cmd: string): void => {
      setHistory((prev) => {
        const next = [cmd, ...prev.filter((c) => c !== cmd)].slice(0, HISTORY_MAX)
        try {
          localStorage.setItem(historyKey(chatId), JSON.stringify(next))
        } catch {
          // storage full/blocked — history is best-effort
        }
        return next
      })
    },
    [chatId]
  )

  const handleRun = async (): Promise<void> => {
    const cmd = command.trim()
    // Re-entry guard is the ref, not the state: it is set before the first
    // await, so a second trigger (Enter + click) cannot slip past while the
    // save/start round-trips are in flight.
    if (!cmd || runningIdRef.current) return
    runningIdRef.current = 'starting'
    // Files are saved before the run.
    const saved = await saveCurrentFile()
    if (!saved) {
      runningIdRef.current = null
      return
    }

    setChunks([])
    setExitInfo(null)
    // The resolved spec's extras (env/cwd/timeoutSec) apply only while the
    // command is the resolved one; an edited command is free-form.
    const useSpec = resolved && cmd === resolved.spec.command
    let result
    try {
      result = await window.api?.procStart({
        chatId,
        command: cmd,
        ...(useSpec && resolved.spec.env ? { env: resolved.spec.env } : {}),
        ...(useSpec && resolved.spec.cwd ? { cwd: resolved.spec.cwd } : {}),
        ...(useSpec && resolved.spec.timeoutSec ? { timeoutSec: resolved.spec.timeoutSec } : {})
      })
    } catch (error) {
      result = { success: false, error: (error as Error).message }
    }
    if (!result?.success || !result.id) {
      runningIdRef.current = null
      setChunks([{ stream: 'system', data: `Failed to start: ${result?.error ?? 'unknown'}` }])
      return
    }
    runningIdRef.current = result.id
    setRunningId(result.id)
    pushHistory(cmd)
  }

  const handleStop = (): void => {
    if (runningIdRef.current) void window.api?.procStop(runningIdRef.current)
  }

  return (
    <div className="run-panel">
      <div className="run-panel-header">
        <span className="run-panel-title">Run</span>
        {resolved && (
          <span className="run-source" title={resolved.matchedGlob ?? ''}>
            {resolved.source === 'run-json' ? `run.json: ${resolved.matchedGlob}` : 'built-in'}
          </span>
        )}
        <button
          className={`run-skill-btn${skillArmed ? ' armed' : ''}`}
          onClick={onToggleSkill}
          title="run.json assistant skill: when armed, the offline chat attaches the run.json instructions to your messages"
        >
          ?
        </button>
      </div>

      {runJsonError && <div className="run-warning">⚠️ {runJsonError} — built-in table used.</div>}
      {resolved?.hint && <div className="run-hint">{resolved.hint}</div>}

      <div className="run-command-row">
        <input
          className="run-command-input"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleRun()
          }}
          placeholder={currentFile ? 'Command to run…' : 'Open a file to run it'}
          disabled={!currentFile}
          spellCheck={false}
        />
        {history.length > 0 && (
          <select
            className="run-history"
            value=""
            onChange={(e) => {
              if (e.target.value) setCommand(e.target.value)
            }}
            title="Command history (this chat)"
          >
            <option value="" disabled>
              history
            </option>
            {history.map((cmd) => (
              <option key={cmd} value={cmd}>
                {cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd}
              </option>
            ))}
          </select>
        )}
        {runningId ? (
          <button className="run-stop-btn" onClick={handleStop}>
            ■ Stop
          </button>
        ) : (
          <button
            className="run-start-btn"
            onClick={() => void handleRun()}
            disabled={!command.trim() || !currentFile}
          >
            ▶ Run
          </button>
        )}
      </div>

      <div className="run-output" ref={outputRef}>
        {chunks.length === 0 ? (
          <div className="run-output-empty">
            {currentFile ? 'Output appears here. No stdin in tier 1.' : 'No file open.'}
          </div>
        ) : (
          chunks.map((chunk, i) => (
            <pre key={i} className={`run-chunk ${chunk.stream}`}>
              {chunk.data}
            </pre>
          ))
        )}
        {exitInfo && (
          <div className={`run-exit${exitInfo === 'exit 0' ? ' ok' : ' fail'}`}>{exitInfo}</div>
        )}
      </div>
    </div>
  )
}
