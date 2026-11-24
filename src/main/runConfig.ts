// Run-command resolution for the tier-1 run console: the built-in extension
// table, run.json parsing/matching and placeholder substitution. Pure (no
// Electron, no fs) — unit tests compile this module with the project's tsc
// and run it under node:test (see npm run test:unit).
//
// Three levels, later wins: built-in table < run.json < free-form (the
// free-form level lives in the run panel; this module covers the first two).

export interface RunSpec {
  command: string
  env?: Record<string, string>
  cwd?: string
  timeoutSec?: number
}

export type RunSource = 'builtin' | 'run-json'

export interface ResolvedRun {
  spec: RunSpec
  source: RunSource
  matchedGlob?: string
  hint?: string
}

// Zero-configuration defaults. Multi-phase commands (&&) are the normal
// case — there is no separate "compile vs run" model. Compiled output goes
// to .bin/ (a dot-directory: hidden from the artifact list).
const BUILTIN_TEMPLATES: Record<string, string> = {
  '.js': 'node {file}',
  '.mjs': 'node {file}',
  '.cjs': 'node {file}',
  '.ts': 'node --experimental-strip-types {file}',
  '.mts': 'node --experimental-strip-types {file}',
  '.py': 'python3 {file}',
  '.c': 'mkdir -p .bin && cc {file} -o .bin/{name} && .bin/{name}',
  '.cpp': 'mkdir -p .bin && c++ {file} -o .bin/{name} && .bin/{name}',
  '.cc': 'mkdir -p .bin && c++ {file} -o .bin/{name} && .bin/{name}',
  '.go': 'go run {file}',
  '.rs': 'cargo run',
  '.sh': 'bash {file}',
  '.java': 'javac {file} && java -cp {dir} {name}'
}

const TS_HINT =
  'Type stripping needs Node >= 22.6 built with TypeScript support; ' +
  'otherwise set a run.json template (e.g. npx tsx {file})'

// --- globs -----------------------------------------------------------------
// A pattern without '/' matches the basename at any depth; with '/' it
// matches the full relative path from the chat directory. '**' crosses
// directories, '*' stays within a segment, '?' is one non-separator char.

function globToRegExp(pattern: string): RegExp {
  let out = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern.startsWith('**/', i)) {
      out += '(?:.*/)?'
      i += 3
    } else if (pattern.startsWith('**', i)) {
      out += '.*'
      i += 2
    } else if (pattern[i] === '*') {
      out += '[^/]*'
      i += 1
    } else if (pattern[i] === '?') {
      out += '[^/]'
      i += 1
    } else {
      out += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&')
      i += 1
    }
  }
  return new RegExp(`^${out}$`)
}

export function matchGlob(pattern: string, relPath: string): boolean {
  const target = pattern.includes('/') ? relPath : relPath.split('/').pop()!
  return globToRegExp(pattern).test(target)
}

const hasWildcard = (pattern: string): boolean => pattern.includes('*') || pattern.includes('?')

// Specificity: an exact (wildcard-free) match beats any pattern; otherwise
// more literal characters win ('src/*.py' over '*.py'). Ties keep the order
// of definition (first wins).
function compareCandidates(a: string, b: string): number {
  const aExact = !hasWildcard(a)
  const bExact = !hasWildcard(b)
  if (aExact !== bExact) return aExact ? -1 : 1
  return b.replace(/[*?]/g, '').length - a.replace(/[*?]/g, '').length
}

// --- run.json ---------------------------------------------------------------

interface RunJson {
  run?: Record<string, unknown>
}

export function parseRunJson(text: string): { config: RunJson | null; error?: string } {
  try {
    const data: unknown = JSON.parse(text)
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { config: null, error: 'run.json must contain a JSON object' }
    }
    return { config: data as RunJson }
  } catch (error) {
    return { config: null, error: `run.json: ${(error as Error).message}` }
  }
}

// String form = { command }. Object form: command/env/cwd/timeoutSec; unknown
// keys are ignored (forward compat). Invalid entries return null and are
// skipped by the matcher.
function toSpec(value: unknown): RunSpec | null {
  if (typeof value === 'string') return { command: value }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.command !== 'string' || record.command.length === 0) return null
  const spec: RunSpec = { command: record.command }
  if (typeof record.env === 'object' && record.env !== null && !Array.isArray(record.env)) {
    const env: Record<string, string> = {}
    for (const [key, val] of Object.entries(record.env as Record<string, unknown>)) {
      if (typeof val === 'string') env[key] = val
    }
    spec.env = env
  }
  if (typeof record.cwd === 'string') spec.cwd = record.cwd
  if (typeof record.timeoutSec === 'number' && Number.isFinite(record.timeoutSec)) {
    spec.timeoutSec = record.timeoutSec
  }
  return spec
}

export interface ResolveInput {
  relPath: string // relative to the chat directory, posix separators
  runJsonText?: string | null
}

export interface ResolveResult {
  resolved: ResolvedRun | null
  runJsonError?: string
}

export function resolveRun(input: ResolveInput): ResolveResult {
  let runJsonError: string | undefined

  if (input.runJsonText != null) {
    const { config, error } = parseRunJson(input.runJsonText)
    if (error) {
      runJsonError = error
    } else if (config?.run && typeof config.run === 'object' && !Array.isArray(config.run)) {
      const patterns = Object.keys(config.run as Record<string, unknown>)
        .filter((pattern) => matchGlob(pattern, input.relPath))
        .sort(compareCandidates)
      for (const pattern of patterns) {
        const spec = toSpec((config.run as Record<string, unknown>)[pattern])
        if (spec) {
          return { resolved: { spec, source: 'run-json', matchedGlob: pattern }, runJsonError }
        }
      }
    }
  }

  const fileName = input.relPath.split('/').pop()!
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
  const template = BUILTIN_TEMPLATES[ext]
  if (template) {
    const resolved: ResolvedRun = { spec: { command: template }, source: 'builtin' }
    if (ext === '.ts' || ext === '.mts') resolved.hint = TS_HINT
    return { resolved, runJsonError }
  }

  return { resolved: null, runJsonError }
}

// --- placeholders -------------------------------------------------------------

export interface PlaceholderContext {
  file: string // absolute path of the saved file
  dir: string // its directory
  name: string // basename without extension
  base: string // basename with extension
}

export function substitutePlaceholders(template: string, ctx: PlaceholderContext): string {
  return template
    .replaceAll('{file}', ctx.file)
    .replaceAll('{dir}', ctx.dir)
    .replaceAll('{name}', ctx.name)
    .replaceAll('{base}', ctx.base)
}
