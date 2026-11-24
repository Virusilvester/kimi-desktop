/*
 * Unit tests for the tier-1 process runner: lifecycle, stop, timeout and
 * the spawn-error path, exercised with real short-lived bash processes.
 * Run: npm run test:unit
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { startProcess, stopProcess } from '../.tmp/unit-build/main/runner.js'

// Start a process and collect its output until exit.
function runCollect(opts) {
  return new Promise((resolve) => {
    const output = []
    const id = startProcess({
      ...opts,
      onOutput: (_stream, data) => output.push(data),
      onExit: (code, signal) => resolve({ id, code, signal, output: output.join('') })
    })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('a short command streams output and exits 0', async () => {
  const result = await runCollect({ command: 'echo hello-runner', cwd: '/tmp' })
  assert.equal(result.code, 0)
  assert.ok(result.output.includes('hello-runner'))
})

test('stop of an unknown id returns false', () => {
  assert.equal(stopProcess('run-nope'), false)
})

test('stop kills the whole process group (grandchildren included)', async () => {
  const pidFile = '/tmp/runner-gc.pid'
  let id
  const exited = new Promise((resolve) => {
    id = startProcess({
      command: `sleep 30 & echo $! > ${pidFile}; wait`,
      cwd: '/tmp',
      onOutput: () => {},
      onExit: (code, signal) => resolve({ code, signal })
    })
  })
  await sleep(150)
  assert.equal(stopProcess(id), true)
  const { code, signal } = await exited
  assert.equal(code, null)
  assert.equal(signal, 'SIGTERM')
  // The grandchild must die with the group, not survive as an orphan.
  const gcPid = Number(fs.readFileSync(pidFile, 'utf8').trim())
  let grandchildGone = false
  for (let i = 0; i < 20 && !grandchildGone; i++) {
    try {
      process.kill(gcPid, 0)
      await sleep(50)
    } catch {
      grandchildGone = true
    }
  }
  fs.rmSync(pidFile, { force: true })
  assert.ok(grandchildGone, 'grandchild survived the group kill')
})

test('timeoutSec stops the process and reports it', async () => {
  const result = await runCollect({ command: 'sleep 30', cwd: '/tmp', timeoutSec: 1 })
  assert.ok(result.output.includes('Timed out after 1s'))
  assert.equal(result.code, null)
})

test('a spawn failure reports output and an exit (no stuck running entry)', async () => {
  const result = await runCollect({ command: 'echo never', cwd: '/nonexistent-dir-xyz' })
  assert.equal(result.code, null)
  assert.equal(result.signal, null)
  assert.ok(result.output.includes('Failed to start'))
})
