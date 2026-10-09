import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpstreamError } from '@/lib/errors'
import { classifyPythonFailure, invokePython, PYTHON_ENVIRONMENT_KEYS, PythonSubprocessOptimizerTransport } from '@/lib/optimizer/pythonSubprocess'
import {
  canonicalSevenDayPythonProblem,
  pythonTestProblem,
} from './helpers/pythonProblem'
import type { spawn } from 'node:child_process'

const testPythonExecutable = process.env.BYTEME_TEST_PYTHON_EXECUTABLE

function childProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn(() => true)
  return child as unknown as ChildProcessWithoutNullStreams & { kill: ReturnType<typeof vi.fn> }
}

const fakeSpawn = (child: ChildProcessWithoutNullStreams) =>
  vi.fn(() => child) as unknown as typeof spawn

describe('Python subprocess transport protocol', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes one JSON request to stdin and parses one JSON response from stdout', async () => {
    const child = childProcess()
    let stdinText = ''
    const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'backend-secret-must-not-be-inherited'
    vi.stubEnv('NODE_ENV', 'test')
    child.stdin.on('data', (chunk: Buffer) => {
      stdinText += chunk.toString('utf8')
    })
    child.stdin.on('finish', () => {
      child.stdout.emit('data', Buffer.from('{"status":"OPTIMAL"}'))
      child.emit('close', 0)
    })
    const spawnProcess = fakeSpawn(child)

    let result: unknown
    try {
      result = await invokePython(
        'python-test',
        'C:\\optimizer',
        1000,
        { factory: { factory_id: 'canonical-uuid' } },
        'request-reference',
        undefined,
        spawnProcess,
      )
    } finally {
      if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey
    }

    expect(result).toEqual({ status: 'OPTIMAL' })
    expect(JSON.parse(stdinText)).toEqual({
      request: { factory: { factory_id: 'canonical-uuid' } },
      correlation_id: 'request-reference',
    })
    expect(spawnProcess).toHaveBeenCalledWith(
      'python-test',
      ['-c', expect.stringContaining('objective=objective')],
      expect.objectContaining({
        cwd: 'C:\\optimizer',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: expect.objectContaining({
          NODE_ENV: 'test',
          PYTHONIOENCODING: 'utf-8',
        }),
      }),
    )
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        env: expect.not.objectContaining({
          SUPABASE_SERVICE_ROLE_KEY: expect.anything(),
        }),
      }),
    )
  })

  it('rejects a non-zero exit without exposing stderr contents', async () => {
    const child = childProcess()
    child.stdin.on('finish', () => {
      child.stderr.emit('data', Buffer.from('private traceback details'))
      child.emit('close', 2)
    })

    await expect(invokePython(
      'python-test',
      'C:\\optimizer',
      1000,
      {},
      'req',
      undefined,
      fakeSpawn(child),
    )).rejects.toMatchObject({
      status: 502,
      details: { reason: 'process_failed', exit_code: 2 },
    })
  })

  it('names a missing OR-Tools install without exposing the traceback', async () => {
    const child = childProcess()
    child.stdin.on('finish', () => {
      child.stderr.emit('data', Buffer.from("Traceback (most recent call last):\n  File \"C:\\Users\\secret\\x.py\"\nModuleNotFoundError: No module named 'ortools'"))
      child.emit('close', 1)
    })
    const failure = invokePython('python-test', 'C:\\optimizer', 1000, {}, 'req', undefined, fakeSpawn(child))
    await expect(failure).rejects.toMatchObject({ status: 502, details: { reason: 'missing_ortools', exit_code: 1 } })
    await expect(failure).rejects.toThrow(/pip install ortools/)
    await expect(failure).rejects.not.toThrow(/secret/)
  })

  it('passes the Windows per-user site-packages locations but no secrets to Python', () => {
    expect(PYTHON_ENVIRONMENT_KEYS).toEqual(expect.arrayContaining(['APPDATA', 'LOCALAPPDATA', 'PATH', 'SystemRoot']))
    expect(PYTHON_ENVIRONMENT_KEYS.some((key) => /KEY|SECRET|TOKEN|SUPABASE/i.test(key))).toBe(false)
  })

  it('classifies the common Windows Python failures', () => {
    expect(classifyPythonFailure(3, "ImportError: No module named 'optimizer'").reason).toBe('optimizer_package_not_found')
    expect(classifyPythonFailure(3, "ImportError: No module named 'ortools.sat'").reason).toBe('missing_ortools')
    expect(classifyPythonFailure(9009, '').reason).toBe('python_not_found')
    expect(classifyPythonFailure(3, "ImportError: No module named 'ortools.sat.python.cp_model_helper' | DLL load failed while importing cp_model_helper: An Application Control policy has blocked this file.").reason).toBe('blocked_by_application_control')
    expect(classifyPythonFailure(1, 'OSError: [WinError 4551] An Application Control policy has blocked this file').reason).toBe('blocked_by_application_control')
    expect(classifyPythonFailure(3, "ImportError: No module named 'ortools' | DLL load failed while importing _pywrapcp: The specified module could not be found.").reason).toBe('native_library_failed')
    expect(classifyPythonFailure(1, 'Python was not found; run without arguments to install from the Microsoft Store').reason).toBe('python_not_found')
    expect(classifyPythonFailure(2, 'ValueError: optimizer runner failed')).toEqual({ reason: 'optimizer_exception', message: 'Python optimizer raised ValueError while solving.' })
    expect(classifyPythonFailure(1, 'segfault').reason).toBe('process_failed')
  })

  it('rejects malformed JSON output', async () => {
    const child = childProcess()
    child.stdin.on('finish', () => {
      child.stdout.emit('data', Buffer.from('not-json'))
      child.emit('close', 0)
    })

    await expect(invokePython(
      'python-test',
      'C:\\optimizer',
      1000,
      {},
      'req',
      undefined,
      fakeSpawn(child),
    )).rejects.toMatchObject({ status: 502, details: { reason: 'invalid_json' } })
  })

  it('kills and reports a timed-out process', async () => {
    vi.useFakeTimers()
    const child = childProcess()
    child.kill.mockImplementation(() => {
      child.emit('close', null)
      return true
    })
    const pending = invokePython(
      'python-test',
      'C:\\optimizer',
      100,
      {},
      'req',
      undefined,
      fakeSpawn(child),
    )
    const observed = expect(pending).rejects.toMatchObject({
      status: 502,
      details: { reason: 'timeout' },
    })
    await vi.advanceTimersByTimeAsync(100)
    await observed
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('rejects oversized requests before starting a process', async () => {
    const spawnProcess = vi.fn() as unknown as typeof spawn

    expect(() => invokePython(
      'python-test',
      'C:\\optimizer',
      1000,
      { content: 'x'.repeat(2 * 1024 * 1024) },
      'req',
      undefined,
      spawnProcess,
    )).toThrow(UpstreamError)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it.skipIf(!testPythonExecutable)('solves the full 168-hour Chocolate mock chain through the local subprocess adapter', async () => {
    const transport = new PythonSubprocessOptimizerTransport({
      enabled: true,
      transport: 'python-subprocess',
      pythonExecutable: testPythonExecutable,
      pythonWorkingDirectory: resolve(process.cwd(), '..'),
      baseUrl: '',
      solvePath: '',
      method: '',
      decoder: '',
      apiKey: '',
      timeoutMs: 120_000,
    })
    const problem = canonicalSevenDayPythonProblem()

    const solution = await transport.solve(problem)

    expect(solution.entries.map(({ processId }) => processId).sort()).toEqual(
      problem.processes.map(({ id }) => id).sort(),
    )
    expect(solution.entries.every(({ machineId }) => machineId === problem.machines[0]?.id)).toBe(true)
    expect(solution.entries).toHaveLength(8)
    expect(solution.entries.every(({ startsAt, endsAt }) =>
      Date.parse(startsAt) >= Date.parse(problem.horizon.start ?? '') &&
      Date.parse(endsAt) <= Date.parse(problem.horizon.end ?? ''),
    )).toBe(true)
    expect(solution.entries.map(({ processId, startsAt, endsAt, metadata }) => ({
      durationMinutes: (Date.parse(endsAt) - Date.parse(startsAt)) / 60_000,
      expectedMinutes: problem.processes.find(({ id }) => id === processId)?.durationMinutes,
      relativeStartMatchesAbsolute: Date.parse(startsAt) ===
        Date.parse(problem.horizon.start ?? '') +
          Number(metadata.optimizer_relative_start_hours) * 60 * 60 * 1000,
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        durationMinutes: 25,
        expectedMinutes: 25,
        relativeStartMatchesAbsolute: true,
      }),
      expect.objectContaining({
        durationMinutes: 35,
        expectedMinutes: 35,
        relativeStartMatchesAbsolute: true,
      }),
      expect.objectContaining({
        durationMinutes: 40,
        expectedMinutes: 40,
        relativeStartMatchesAbsolute: true,
      }),
      expect.objectContaining({
        durationMinutes: 45,
        expectedMinutes: 45,
        relativeStartMatchesAbsolute: true,
      }),
    ]))
    for (const edge of problem.dependencies) {
      const successor = solution.entries.find(({ processId }) => processId === edge.processId)
      const predecessor = solution.entries.find(({ processId }) => processId === edge.dependsOnProcessId)
      expect(Date.parse(successor!.startsAt)).toBeGreaterThanOrEqual(Date.parse(predecessor!.endsAt))
    }
    expect(solution.metrics).toMatchObject({
      api_version: '2.0',
      optimizer_status: 'OPTIMAL',
    })
    expect((solution.raw as { status: string }).status).toBe('OPTIMAL')
  }, 60_000)

})
