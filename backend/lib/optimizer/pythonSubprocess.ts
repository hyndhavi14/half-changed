import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { UpstreamError } from '../errors'
import type { OptimizerConfig } from './client'
import type { OptimizationProblem, OptimizationSolution, OptimizerTransport } from './contract'
import { buildPythonOptimizerRequest } from './pythonPayload'
import { decodePythonResponse } from './pythonResponse'

const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024
const PYTHON_ENVIRONMENT_KEYS = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE'] as const

function pythonEnvironment(): NodeJS.ProcessEnv {
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
  'from optimizer.public_api import optimize_request',
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
        finish(new UpstreamError('Python optimizer process exited unsuccessfully.', {
          reason: 'process_failed',
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
