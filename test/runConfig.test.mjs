/*
 * Unit tests for the run-command resolution (built-in table, run.json
 * globs, placeholders) and the workspace path guard.
 * Run: npm run test:unit
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  matchGlob,
  parseRunJson,
  resolveRun,
  substitutePlaceholders
} from '../.tmp/unit-build/main/runConfig.js'
import { resolveInWorkspace } from '../.tmp/unit-build/main/workspace.js'

// --- matchGlob ---

test('a pattern without / matches the basename at any depth', () => {
  assert.equal(matchGlob('*.py', 'a.py'), true)
  assert.equal(matchGlob('*.py', 'src/deep/a.py'), true)
  assert.equal(matchGlob('*.py', 'a.js'), false)
})

test('a pattern with / matches the full relative path', () => {
  assert.equal(matchGlob('src/*.py', 'src/a.py'), true)
  assert.equal(matchGlob('src/*.py', 'a.py'), false)
  assert.equal(matchGlob('src/*.py', 'src/sub/a.py'), false)
})

test('** crosses directories, including zero levels', () => {
  assert.equal(matchGlob('src/**/*.test.js', 'src/a.test.js'), true)
  assert.equal(matchGlob('src/**/*.test.js', 'src/x/y.test.js'), true)
  assert.equal(matchGlob('src/**/*.test.js', 'a.test.js'), false)
})

test('? matches exactly one non-separator character', () => {
  assert.equal(matchGlob('a?.py', 'ab.py'), true)
  assert.equal(matchGlob('a?.py', 'a/py'), false)
  assert.equal(matchGlob('a?.py', 'abc.py'), false)
})

// --- parseRunJson ---

test('parseRunJson reports broken JSON and non-objects', () => {
  assert.ok(parseRunJson('{ "run": ').error)
  assert.ok(parseRunJson('[1, 2]').error)
  assert.equal(parseRunJson('{ "run": {} }').error, undefined)
})

// --- resolveRun ---

test('run.json string form wins over the built-in table', () => {
  const { resolved } = resolveRun({
    relPath: 'main.py',
    runJsonText: '{ "run": { "*.py": "source .venv/bin/activate && python {file}" } }'
  })
  assert.equal(resolved?.source, 'run-json')
  assert.equal(resolved?.spec.command, 'source .venv/bin/activate && python {file}')
  assert.equal(resolved?.matchedGlob, '*.py')
})

test('object form keeps env/cwd/timeoutSec and ignores unknown keys', () => {
  const { resolved } = resolveRun({
    relPath: 'server.py',
    runJsonText: JSON.stringify({
      run: {
        'server.py': {
          command: 'flask --app {name} run',
          env: { FLASK_ENV: 'development' },
          cwd: '{dir}',
          timeoutSec: 60,
          futureKey: 'ignored'
        }
      }
    })
  })
  assert.deepEqual(resolved?.spec, {
    command: 'flask --app {name} run',
    env: { FLASK_ENV: 'development' },
    cwd: '{dir}',
    timeoutSec: 60
  })
})

test('most specific glob wins; exact beats patterns; ties keep definition order', () => {
  const runJsonText = JSON.stringify({
    run: {
      '*.py': 'generic {file}',
      'src/*.py': 'scoped {file}',
      'src/main.py': 'exact {file}'
    }
  })
  assert.equal(
    resolveRun({ relPath: 'src/main.py', runJsonText }).resolved?.spec.command,
    'exact {file}'
  )
  assert.equal(
    resolveRun({ relPath: 'src/other.py', runJsonText }).resolved?.spec.command,
    'scoped {file}'
  )
  assert.equal(
    resolveRun({ relPath: 'tools/x.py', runJsonText }).resolved?.spec.command,
    'generic {file}'
  )

  // Equal specificity (same literal length, both match): the first defined
  // pattern wins.
  const tied = JSON.stringify({ run: { 'a*.py': 'first', 'a?.py': 'second' } })
  assert.equal(resolveRun({ relPath: 'ab.py', runJsonText: tied }).resolved?.spec.command, 'first')
})

test('invalid run.json entries are skipped, not fatal', () => {
  const runJsonText = JSON.stringify({
    run: {
      'a.py': { env: { X: '1' } }, // no command — invalid
      '*.py': 'fallback {file}'
    }
  })
  const { resolved, runJsonError } = resolveRun({ relPath: 'a.py', runJsonText })
  assert.equal(resolved?.spec.command, 'fallback {file}')
  assert.equal(runJsonError, undefined)
})

test('broken run.json falls back to the built-in table with the error surfaced', () => {
  const { resolved, runJsonError } = resolveRun({ relPath: 'a.py', runJsonText: '{ nope' })
  assert.ok(runJsonError)
  assert.equal(resolved?.source, 'builtin')
  assert.equal(resolved?.spec.command, 'python3 {file}')
})

test('built-in table covers the documented extensions, ts carries a hint', () => {
  assert.equal(resolveRun({ relPath: 'x.js' }).resolved?.spec.command, 'node {file}')
  assert.equal(resolveRun({ relPath: 'x.sh' }).resolved?.spec.command, 'bash {file}')
  assert.equal(resolveRun({ relPath: 'x.go' }).resolved?.spec.command, 'go run {file}')
  const c = resolveRun({ relPath: 'main.c' }).resolved
  assert.ok(c?.spec.command.includes('.bin/'))
  const ts = resolveRun({ relPath: 'x.ts' }).resolved
  assert.equal(ts?.spec.command, 'node --experimental-strip-types {file}')
  assert.ok(ts?.hint)
  assert.equal(resolveRun({ relPath: 'x.unknown' }).resolved, null)
})

test('nested files resolve by extension too', () => {
  assert.equal(resolveRun({ relPath: 'src/deep/x.py' }).resolved?.spec.command, 'python3 {file}')
})

// --- substitutePlaceholders ---

test('substitutePlaceholders replaces every token, repeated included', () => {
  const out = substitutePlaceholders('cc {file} -o .bin/{name} && .bin/{name} # {base} in {dir}', {
    file: '/w/c1/main.c',
    dir: '/w/c1',
    name: 'main',
    base: 'main.c'
  })
  assert.equal(out, 'cc /w/c1/main.c -o .bin/main && .bin/main # main.c in /w/c1')
})

// --- resolveInWorkspace ---

test('resolveInWorkspace resolves nested paths inside the root', () => {
  assert.equal(resolveInWorkspace('/w', 'c1/main.py'), '/w/c1/main.py')
  assert.equal(resolveInWorkspace('/w', '.'), '/w')
})

test('resolveInWorkspace refuses escapes, absolute paths and empties', () => {
  assert.throws(() => resolveInWorkspace('/w', '../etc/passwd'), /outside the workspace/)
  assert.throws(() => resolveInWorkspace('/w', 'c1/../../etc'), /outside the workspace/)
  assert.throws(() => resolveInWorkspace('/w', '/etc/passwd'), /absolute path/)
  assert.throws(() => resolveInWorkspace('/w', ''), /Empty path/)
  assert.throws(() => resolveInWorkspace('/w', 'a\0b'), /Invalid path/)
})

test('resolveInWorkspace tolerates a trailing slash and the filesystem root', () => {
  assert.equal(resolveInWorkspace('/w/', 'c1/a.py'), '/w/c1/a.py')
  assert.equal(resolveInWorkspace('/w/', '.'), '/w')
  assert.equal(resolveInWorkspace('/', 'home'), '/home')
  assert.throws(() => resolveInWorkspace('/w/', '../etc'), /outside the workspace/)
})
