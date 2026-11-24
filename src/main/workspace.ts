// Workspace FS gateway: the only path from the renderer to the disk. Every
// renderer-supplied path is resolved against the workspace root and refused
// when it escapes (precedent: userDataFile() in index.ts). Dot-entries are
// hidden from listings but stay readable/writable by direct path (run.json,
// .venv, .bin).

import fs from 'fs'
import path from 'path'

export const WORKSPACE_READ_MAX_BYTES = 5 * 1024 * 1024
export const WORKSPACE_WRITE_MAX_BYTES = 5 * 1024 * 1024
const LIST_RECURSIVE_MAX_DEPTH = 6
const LIST_RECURSIVE_MAX_ENTRIES = 1000

export interface WorkspaceEntry {
  name: string
  isDirectory: boolean
  size: number
  mtimeMs: number
}

export interface WorkspaceFile {
  path: string // relative to the listed directory, posix separators
  size: number
  mtimeMs: number
}

// Resolve a renderer-supplied relative path inside the workspace root.
// Lexical check (no symlink resolution), same guarantee as userDataFile().
export function resolveInWorkspace(root: string, relPath: string): string {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('Empty path')
  }
  if (relPath.includes('\0')) {
    throw new Error('Invalid path')
  }
  if (path.isAbsolute(relPath)) {
    throw new Error(`Refused absolute path: ${relPath}`)
  }
  const base = path.resolve(root)
  const resolved = path.resolve(base, relPath)
  // base may be '/' (prefix must not become '//'); a trailing separator in
  // the root is already stripped by path.resolve.
  const prefix = base.endsWith(path.sep) ? base : base + path.sep
  if (resolved !== base && !resolved.startsWith(prefix)) {
    throw new Error(`Refused path outside the workspace: ${relPath}`)
  }
  return resolved
}

const isHidden = (name: string): boolean => name.startsWith('.')

// One directory level, dot-entries filtered, directories first then by name.
export function listEntries(root: string, relDir: string): WorkspaceEntry[] {
  const dir = resolveInWorkspace(root, relDir === '' ? '.' : relDir)
  const dirents = fs.readdirSync(dir, { withFileTypes: true })
  const entries: WorkspaceEntry[] = []
  for (const dirent of dirents) {
    if (isHidden(dirent.name)) continue
    try {
      const stat = fs.statSync(path.join(dir, dirent.name))
      entries.push({
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      })
    } catch {
      // vanished mid-listing — skip
    }
  }
  entries.sort((a, b) =>
    a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1
  )
  return entries
}

// Flat recursive file list (dot-entries filtered at every level), paths
// relative to relDir with posix separators. Capped in depth and count — the
// artifact panel of a chat directory is small by design.
export function listFilesRecursive(root: string, relDir: string): WorkspaceFile[] {
  const base = resolveInWorkspace(root, relDir === '' ? '.' : relDir)
  const files: WorkspaceFile[] = []

  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > LIST_RECURSIVE_MAX_DEPTH || files.length >= LIST_RECURSIVE_MAX_ENTRIES) return
    let dirents: fs.Dirent[]
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of dirents) {
      if (files.length >= LIST_RECURSIVE_MAX_ENTRIES) return
      if (isHidden(dirent.name)) continue
      const abs = path.join(dir, dirent.name)
      const rel = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`
      if (dirent.isDirectory()) {
        walk(abs, rel, depth + 1)
      } else {
        try {
          const stat = fs.statSync(abs)
          files.push({ path: rel, size: stat.size, mtimeMs: stat.mtimeMs })
        } catch {
          // vanished mid-listing — skip
        }
      }
    }
  }

  walk(base, '', 1)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

export function readTextFile(root: string, relPath: string): string {
  const abs = resolveInWorkspace(root, relPath)
  const stat = fs.statSync(abs)
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${relPath}`)
  }
  if (stat.size > WORKSPACE_READ_MAX_BYTES) {
    throw new Error(`File too large to open (${stat.size} bytes, cap ${WORKSPACE_READ_MAX_BYTES})`)
  }
  const buffer = fs.readFileSync(abs)
  if (buffer.includes(0)) {
    throw new Error('Binary files are not supported')
  }
  return buffer.toString('utf8')
}

export function writeTextFile(root: string, relPath: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > WORKSPACE_WRITE_MAX_BYTES) {
    throw new Error(`Content too large (cap ${WORKSPACE_WRITE_MAX_BYTES} bytes)`)
  }
  const abs = resolveInWorkspace(root, relPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
}
