import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { UpstreamError } from '../errors'
import type { OptimizerConfig } from './client'
import type { OptimizationProblem, OptimizationSolution, OptimizerTransport } from './contract'
import { buildPythonOptimizerRequest } from './pythonPayload'
import { decodePythonResponse } from './pythonResponse'

const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024
// Only non-secret variables Python needs. APPDATA / LOCALAPPDATA locate Windows per-user
// site-packages (where `pip install --user` and non-admin installs put OR-Tools); without them
// Python cannot import ortools and the run fails. PYTHONUSERBASE does the same on other systems.
export const PYTHON_ENVIRONMENT_KEYS = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PYTHONUSERBASE'] as const

export function pythonEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PYTHONIOENCODING: 'utf-8',
  }
  for (const key of PYTHON_ENVIRONMENT_KEYS) {
    const value = process.env[key]
    if (value) environment[key] = value
  }
  return environment
}

const RUNNER = [
  'import json, sys',
  'try:',
  '    from optimizer.public_api import optimize_request',
  'except ImportError as error:',
  '    detail = " ".join(str(error).split())[:300]',
  '    sys.stderr.write("ImportError: No module named " + repr(getattr(error, "name", None) or "unknown") + " | " + detail)',
  '    sys.exit(3)',
  'def unique_object(pairs):',
  '    result = {}',
  '    for key, value in pairs:',
  '        if key in result: raise ValueError("duplicate JSON property")',
  '        result[key] = value',
  '    return result',
  'try:',
  '    envelope = json.load(sys.stdin, object_pairs_hook=unique_object)',
  '    request = envelope["request"]',
  '    objective = request.get("options", {}).get("objective", "cost")',
  '    result = optimize_request(request, objective=objective, strict=False, correlation_id=envelope["correlation_id"])',
  '    sys.stdout.write(json.dumps(result, separators=(",", ":"), allow_nan=False))',
  'except Exception as error:',
  '    sys.stderr.write(type(error).__name__ + ": optimizer runner failed")',
  '    sys.exit(2)',
].join('\n')

const STDERR_TAIL_BYTES = 8 * 1024

/**
 * Turns a failed Python exit into a cause the developer can act on. Only the module
 * name or exception class is used; paths and stack traces never reach the client.
 */
export function classifyPythonFailure(code: number | null, stderrTail: string): { reason: string; message: string } {
  // Windows Application Control (WDAC / Smart App Control) refusing a native DLL, error 4551.
  // This is a security policy: it is reported, never worked around.
  if (/Application Control policy|WinError 4551|\b4551\b/i.test(stderrTail)) {
    return {
      reason: 'blocked_by_application_control',
      message: 'Windows Application Control blocked the OR-Tools native library (error 4551). This is a security policy on this computer and must not be bypassed. Run the backend and optimizer on a computer or environment where OR-Tools is allowed, or ask the administrator to allow it.',
    }
  }
  if (/DLL load failed/i.test(stderrTail)) {
    return {
      reason: 'native_library_failed',
      message: 'Python could not load a native library needed by OR-Tools (DLL load failed). Reinstall OR-Tools for this Python, or check that the Microsoft Visual C++ Redistributable is installed.',
    }
  }
  const missing = /No module named '?"?([A-Za-z0-9_.]+)/.exec(stderrTail)?.[1]
  if (missing && /^ortools(\.|$)/.test(missing)) {
    return {
      reason: 'missing_ortools',
      message: 'Python optimizer could not import OR-Tools. Install it for the configured Python executable: <python> -m pip install ortools, then restart the backend.',
    }
  }
  if (missing && /^optimizer(\.|$)/.test(missing)) {
    return {
      reason: 'optimizer_package_not_found',
      message: 'Python could not find the optimizer package. Remove BYTEME_OPTIMIZER_PYTHON_WORKING_DIRECTORY or set it to the project root folder (the one that contains the optimizer folder), then restart the backend.',
    }
  }
  if (missing) {
    return {
      reason: 'missing_python_module',
      message: `Python optimizer is missing the Python module "${missing.replace(/[^A-Za-z0-9_.]/g, '')}" in the configured Python environment.`,
    }
  }
  if (code === 9009 || /Python was not found|is not recognized as an internal or external command/i.test(stderrTail)) {
    return {
      reason: 'python_not_found',
      message: 'The configured Python executable was not found (on Windows "python" may point to the Microsoft Store shortcut). Set BYTEME_OPTIMIZER_PYTHON_EXECUTABLE to the full path of python.exe.',
    }
  }
  const failure = /^([A-Za-z_][A-Za-z0-9_]*): optimizer runner failed/m.exec(stderrTail)?.[1]
  if (failure) {
    return { reason: 'optimizer_exception', message: `Python optimizer raised ${failure} while solving.` }
  }
  return { reason: 'process_failed', message: 'Python optimizer process exited unsuccessfully.' }
}

type PythonChild = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'kill' | 'once'>

function appendWithinLimit(current: Buffer, chunk: Buffer, label: string): Buffer {
  if (current.length + chunk.length > MAX_OUTPUT_BYTES) {
    throw new UpstreamError(`Python optimizer ${label} exceeded the configured output limit.`, { reason: 'output_limit' })
  }
  return Buffer.concat([current, chunk])
}

export function invokePython(
  pythonExecutable: string,
  workingDirectory: string,
  timeoutMs: number,
  request: unknown,
  correlationId: string,
  signal?: AbortSignal,
  spawnProcess: typeof spawn = spawn,
): Promise<unknown> {
  const input = JSON.stringify({ request, correlation_id: correlationId })
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) {
    throw new UpstreamError('Python optimizer request exceeded the configured input limit.', { reason: 'input_limit' })
  }

  return new Promise((resolve, reject) => {
    let child: PythonChild
    try {
      child = spawnProcess(
        pythonExecutable,
        ['-c', RUNNER],
        {
          cwd: workingDirectory,
          env: pythonEnvironment(),
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )
    } catch {
      reject(new UpstreamError('Could not start the configured Python optimizer.', { reason: 'spawn_failed' }))
      return
    }

    let settled = false
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderrBytes = 0
    let stderrTail = ''
    let timeout = false
    let cancelled = false
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(value)
    }
    const stop = (reason: 'timeout' | 'cancelled' | 'output_limit') => {
      if (reason === 'timeout') timeout = true
      if (reason === 'cancelled') cancelled = true
      child.kill()
    }
    const abort = () => stop('cancelled')
    const timer = setTimeout(() => stop('timeout'), timeoutMs)

    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()

    child.stdout.on('data', (chunk: Buffer | string) => {
      try {
        stdout = appendWithinLimit(stdout, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), 'stdout')
      } catch (error) {
        stop('output_limit')
        finish(error as Error)
      }
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
      stderrTail = (stderrTail + (Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk)).slice(-STDERR_TAIL_BYTES)
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        stop('output_limit')
        finish(new UpstreamError('Python optimizer stderr exceeded the configured output limit.', {
          reason: 'output_limit',
        }))
      }
    })
    child.once('error', () => {
      finish(new UpstreamError('Could not start the configured Python optimizer.', { reason: 'spawn_failed' }))
    })
    child.once('close', (code) => {
      if (timeout) {
        finish(new UpstreamError('Python optimizer request timed out.', { reason: 'timeout' }))
        return
      }
      if (cancelled) {
        finish(new UpstreamError('Python optimizer request was cancelled.', { reason: 'cancelled' }))
        return
      }
      if (code !== 0) {
        const failure = classifyPythonFailure(code, stderrTail)
        // Full detail stays in the backend terminal for the developer; the client gets the cause only.
        console.error(`[optimizer] Python exited with code ${code} (${failure.reason}). stderr tail:\n${stderrTail.trim() || '(empty)'}`)
        finish(new UpstreamError(failure.message, {
          reason: failure.reason,
          exit_code: code,
        }))
        return
      }
      try {
        finish(undefined, JSON.parse(stdout.toString('utf8')) as unknown)
      } catch {
        finish(new UpstreamError('Python optimizer did not return valid JSON.', { reason: 'invalid_json' }))
      }
    })

    child.stdin.once('error', () => {
      finish(new UpstreamError('Could not send the request to the Python optimizer.', { reason: 'stdin_failed' }))
    })
    child.stdin.end(input)
  })
}

export class PythonSubprocessOptimizerTransport implements OptimizerTransport {
  readonly name = 'python-subprocess'
  readonly isConfigured = true

  constructor(private readonly config: OptimizerConfig) {}

  async solve(problem: OptimizationProblem, signal?: AbortSignal): Promise<OptimizationSolution> {
    const pythonExecutable = this.config.pythonExecutable?.trim()
    const workingDirectory = this.config.pythonWorkingDirectory?.trim()
    if (!pythonExecutable || !workingDirectory) {
      throw new UpstreamError('Python optimizer executable and working directory must be configured.')
    }

    const { request, integrationWarnings } = buildPythonOptimizerRequest(problem)
    const raw = await invokePython(
      pythonExecutable,
      workingDirectory,
      this.config.timeoutMs,
      request,
      problem.requestReference,
      signal,
    )
    return decodePythonResponse(raw, problem, integrationWarnings)
  }
}
