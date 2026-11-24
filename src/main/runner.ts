// Tier-1 process runner: spawn via /bin/bash -c with a guarded cwd, stream
// stdout/stderr, report the exit code, stop on demand, enforce timeoutSec.
// No stdin — interactive programs do not fit tier 1 (documented in the run
// panel and the run.json skill). The IPC surface (start/stop/stream events)
// is designed once so a future tier-2 PTY terminal reuses it.

import { spawn } from 'child_process'

export interface StartOptions {
  command: string
  cwd: string
  env?: Record<string, string>
  timeoutSec?: number
  onOutput: (stream: 'stdout' | 'stderr', data: string) => void
  onExit: (code: number | null, signal: string | null) => void
}

interface RunningProcess {
  child: ReturnType<typeof spawn>
  timeout: NodeJS.Timeout | null
  killTimer: NodeJS.Timeout | null
  exited: boolean
}

const running = new Map<string, RunningProcess>()
let nextId = 1

const MAX_TIMEOUT_SEC = 3600
const SIGKILL_GRACE_MS = 3000

export function startProcess(opts: StartOptions): string {
  const id = `run-${Date.now()}-${nextId++}`
  const child = spawn('/bin/bash', ['-c', opts.command], {
    cwd: opts.cwd,
    detached: true, // own process group, so stop/timeout/quit can kill the tree
    // No stdin in tier 1: readers get immediate EOF instead of hanging.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(opts.env ?? {}) }
  })

  const entry: RunningProcess = { child, timeout: null, killTimer: null, exited: false }
  running.set(id, entry)

  child.stdout?.on('data', (chunk: Buffer) => opts.onOutput('stdout', chunk.toString('utf8')))
  child.stderr?.on('data', (chunk: Buffer) => opts.onOutput('stderr', chunk.toString('utf8')))

  const finish = (code: number | null, signal: string | null): void => {
    if (entry.exited) return
    entry.exited = true
    if (entry.timeout) clearTimeout(entry.timeout)
    if (entry.killTimer) clearTimeout(entry.killTimer)
    running.delete(id)
    opts.onExit(code, signal)
  }

  child.on('error', (error) => {
    // Spawn itself failed (e.g. cwd vanished): 'exit' is not guaranteed to
    // follow an 'error', so the failure is reported here as output + exit.
    opts.onOutput('stderr', `Failed to start: ${error.message}\n`)
    finish(null, null)
  })

  child.on('exit', finish)

  if (opts.timeoutSec !== undefined && Number.isFinite(opts.timeoutSec) && opts.timeoutSec > 0) {
    const sec = Math.min(opts.timeoutSec, MAX_TIMEOUT_SEC)
    entry.timeout = setTimeout(() => {
      opts.onOutput('stderr', `\n[Timed out after ${sec}s — stopping]\n`)
      terminate(entry)
    }, sec * 1000)
  }

  return id
}

// SIGTERM first, SIGKILL after a grace period. The child is spawned
// detached, so the signal goes to its whole process group: grandchildren
// (compound commands, wrappers) die with it instead of being orphaned.
function terminate(entry: RunningProcess): void {
  if (entry.exited) return
  const pid = entry.child.pid
  if (pid === undefined) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  entry.killTimer = setTimeout(() => {
    if (!entry.exited) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }, SIGKILL_GRACE_MS)
}

export function stopProcess(id: string): boolean {
  const entry = running.get(id)
  if (!entry) return false
  terminate(entry)
  return true
}

// App quit must not leave orphaned processes behind: SIGKILL the whole
// group immediately — the main process is exiting, so a SIGTERM grace
// timer would never fire.
export function stopAllProcesses(): void {
  for (const entry of running.values()) {
    if (entry.exited) continue
    const pid = entry.child.pid
    if (pid === undefined) continue
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}
