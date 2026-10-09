/**
 * Server-only environment access.
 *
 * This module is the single place where `process.env` is read. Two rules:
 *
 *  1. Secrets are read from unprefixed variables only
 *     (`SUPABASE_SERVICE_ROLE_KEY`), never from a `NEXT_PUBLIC_*` name, because
 *     anything `NEXT_PUBLIC_`-prefixed is inlined into the browser bundle.
 *  2. `serverEnv` throws at request time if required variables are missing,
 *     so a misconfigured deployment fails loudly instead of silently serving
 *     broken responses.
 */

import { z } from 'zod'
import { ConfigurationError } from './errors'

/**
 * Variables that must never be readable from a browser bundle.
 *
 * `BYTEME_OFFLINE_JWT_SECRET` signs and verifies offline access tokens, so it
 * must never be mirrored into a `NEXT_PUBLIC_*` name either.
 */
const SECRET_KEYS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'BYTEME_OPTIMIZER_API_KEY',
  'BYTEME_OFFLINE_JWT_SECRET',
] as const

const serverEnvSchema = z.object({
  // Optional at the schema level and validated conditionally below: offline
  // mode runs without any Supabase credential, but online mode must have them.
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  APP_NAME: z.string().default('ByteMe'),
  APP_VERSION: z.string().default('0.1.0'),

  BYTEME_OFFLINE_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Where the offline SQLite file lives, or ':memory:'.
  BYTEME_OFFLINE_DB_PATH: z.string().default(''),

  /**
   * HS256 secret used to verify access tokens when BYTEME_OFFLINE_MODE=true.
   *
   * Deliberately NOT required by the schema: `serverEnv()` is called by
   * `isOfflineMode()`, so making it mandatory here would break every offline
   * code path that does not involve authentication. Instead the auth layer
   * fails closed with a ConfigurationError when a protected route is reached
   * without it. Mint a token with `npm run offline:token`.
   */
  BYTEME_OFFLINE_JWT_SECRET: z.string().default(''),

  BYTEME_OPTIMIZER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  BYTEME_OPTIMIZER_BASE_URL: z.string().default(''),
  BYTEME_OPTIMIZER_SOLVE_PATH: z.string().default(''),
  /** Required. ByteMe will not default the HTTP method. */
  BYTEME_OPTIMIZER_SOLVE_METHOD: z.string().default(''),
  /** Required. ByteMe will not default the response decoder. */
  BYTEME_OPTIMIZER_DECODER: z.string().default(''),
  BYTEME_OPTIMIZER_API_KEY: z.string().default(''),
  BYTEME_OPTIMIZER_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(180_000),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

/**
 * Supabase requirements.
 *
 * Online mode requires both values. Offline mode requires neither, because the
 * SQLite backend never contacts Supabase and must work with no credential and
 * no network. Returning the requirements (rather than a boolean) keeps the
 * message specific about what is missing.
 *
 * Each entry names the offending VARIABLE, never its value, so the same
 * `{ issues: [{ variable, message }] }` shape is produced whether the problem
 * was a missing key or a malformed one.
 */
function supabaseRequirements(
  source: Record<string, string | undefined>,
): Array<{ variable: string; message: string }> {
  const problems: Array<{ variable: string; message: string }> = []

  const url = source.NEXT_PUBLIC_SUPABASE_URL
  const key = source.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    problems.push({
      variable: 'NEXT_PUBLIC_SUPABASE_URL',
      message: 'NEXT_PUBLIC_SUPABASE_URL is required unless BYTEME_OFFLINE_MODE=true',
    })
  } else if (!/^https?:\/\//.test(url)) {
    problems.push({
      variable: 'NEXT_PUBLIC_SUPABASE_URL',
      message: 'NEXT_PUBLIC_SUPABASE_URL must be a valid URL',
    })
  }

  if (!key) {
    problems.push({
      variable: 'SUPABASE_SERVICE_ROLE_KEY',
      message: 'SUPABASE_SERVICE_ROLE_KEY is required unless BYTEME_OFFLINE_MODE=true',
    })
  } else if (key === 'undefined' || key.startsWith('your-')) {
    problems.push({
      variable: 'SUPABASE_SERVICE_ROLE_KEY',
      message: 'SUPABASE_SERVICE_ROLE_KEY is not configured',
    })
  }

  return problems
}

let cached: ServerEnv | null = null

function rawEnv(): Record<string, string> {
  // Next.js populates process.env at runtime for server code. In tests we can
  // pass an explicit override object.
  return process.env as unknown as Record<string, string>
}

/**
 * Reads and validates the server environment.
 *
 * @throws {ConfigurationError} when a required variable is missing or
 *         malformed. Deliberately NOT a ValidationError: a blank environment
 *         variable is a server misconfiguration, so it must not be reported to
 *         the caller as a 400 caused by their request.
 */
export function serverEnv(overrides?: Record<string, string | undefined>): ServerEnv {
  if (!overrides && cached) return cached

  const source = overrides ?? rawEnv()

  // Guard against a secret being duplicated into a NEXT_PUBLIC_ name, which
  // would leak it to the browser. We refuse rather than warn.
  assertSecretsAreNotPublic(source)

  const parsed = serverEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    APP_NAME: source.APP_NAME,
    APP_VERSION: source.APP_VERSION,
    BYTEME_OFFLINE_MODE: source.BYTEME_OFFLINE_MODE,
    BYTEME_OFFLINE_DB_PATH: source.BYTEME_OFFLINE_DB_PATH,
    BYTEME_OFFLINE_JWT_SECRET: source.BYTEME_OFFLINE_JWT_SECRET,
    BYTEME_OPTIMIZER_ENABLED: source.BYTEME_OPTIMIZER_ENABLED,
    BYTEME_OPTIMIZER_BASE_URL: source.BYTEME_OPTIMIZER_BASE_URL,
    BYTEME_OPTIMIZER_SOLVE_PATH: source.BYTEME_OPTIMIZER_SOLVE_PATH,
    BYTEME_OPTIMIZER_SOLVE_METHOD: source.BYTEME_OPTIMIZER_SOLVE_METHOD,
    BYTEME_OPTIMIZER_DECODER: source.BYTEME_OPTIMIZER_DECODER,
    BYTEME_OPTIMIZER_API_KEY: source.BYTEME_OPTIMIZER_API_KEY,
    BYTEME_OPTIMIZER_TIMEOUT_MS: source.BYTEME_OPTIMIZER_TIMEOUT_MS,
  })

  if (!parsed.success) {
    // Names and reasons only. No environment values are ever echoed back.
    const issues = parsed.error.issues.map((issue) => ({
      variable: String(issue.path[0] ?? '(root)'),
      message: issue.message,
    }))

    throw new ConfigurationError(
      `The server is missing required environment configuration: ${[
        ...new Set(issues.map((issue) => issue.variable)),
      ].join(', ')}`,
      { issues },
    )
  }

  // Supabase credentials are only mandatory on the online path.
  if (!parsed.data.BYTEME_OFFLINE_MODE) {
    const problems = supabaseRequirements(source)
    if (problems.length > 0) {
      throw new ConfigurationError(
        `The server is missing required environment configuration: ${problems
          .map((problem) => problem.message)
          .join('; ')}`,
        { issues: problems },
      )
    }
  }

  if (!overrides) cached = parsed.data
  return parsed.data
}

/** Test helper: drop the memoised environment. */
export function resetEnvCache(): void {
  cached = null
}

/**
 * True when the process can talk to Supabase at all.
 *
 * Used by `/api/v1/health` so a missing key degrades the health report instead
 * of turning every request into a crash.
 */
export function isDatabaseConfigured(overrides?: Record<string, string | undefined>): boolean {
  const source = overrides ?? rawEnv()

  // Offline mode needs no Supabase credential: the SQLite file is local.
  if (source.BYTEME_OFFLINE_MODE === 'true') return true

  return Boolean(source.NEXT_PUBLIC_SUPABASE_URL && source.SUPABASE_SERVICE_ROLE_KEY)
}

function assertSecretsAreNotPublic(source: Record<string, string | undefined>): void {
  for (const secret of SECRET_KEYS) {
    const publicCopy = source[`NEXT_PUBLIC_${secret}`]
    if (publicCopy && publicCopy.length > 0) {
      throw new Error(
        `Security violation: ${secret} must not be exposed via NEXT_PUBLIC_${secret}. ` +
          `Any NEXT_PUBLIC_* value is inlined into the browser bundle.`,
      )
    }
  }
}