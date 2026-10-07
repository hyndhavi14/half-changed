/**
 * Verifies that a blank .env.local is treated as "unconfigured" rather than
 * silently accepted, and that the skeleton's key set matches what the code
 * actually reads.
 *
 * This guards the setup path: a placeholder-filled .env.local must produce a
 * clear 503/degraded health response, never a crash or a silent fake success.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ConfigurationError } from '@/lib/errors'
import { isDatabaseConfigured, serverEnv } from '@/lib/env'
import { isOptimizerConfigured, readOptimizerConfig } from '@/lib/optimizer/client'
import { factoryCreateSchema } from '@/lib/schemas/factories'

function parseEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return result
}

describe('.env.example template', () => {
  const envLocal = parseEnvFile('.env.example')

  it('contains every key lib/env.ts requires', () => {
    const schemaSource = readFileSync('lib/env.ts', 'utf8')
    const required = [...schemaSource.matchAll(/^ {2}([A-Z_]+):/gm)].map((m) => m[1] as string)

    // BYTEME_OPTIMIZER_TIMEOUT_MS has a default and need not be listed, but
    // including it is harmless.
    for (const key of required) {
      expect(Object.keys(envLocal)).toContain(key)
    }
  })

  it('contains both required Supabase keys', () => {
    // Once you fill in .env.local the values are non-empty, so this asserts
    // presence, not emptiness. What must never happen is a key being MISSING
    // and silently falling back to a built-in default.
    expect(Object.keys(envLocal)).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(Object.keys(envLocal)).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('has no leftover TODO placeholder sitting in a required slot', () => {
    // The skeleton ships "TODO:" guidance comments; a value that is literally
    // the word TODO would pass a naive truthiness check but is not usable.
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      const value = envLocal[key] ?? ''
      expect(value, `${key} must not still be a TODO placeholder`).not.toMatch(/^TODO/i)
    }
  })

  it('does not mark the optimizer as configured', () => {
    expect(envLocal.BYTEME_OPTIMIZER_ENABLED).toBe('false')
    expect(envLocal.BYTEME_OPTIMIZER_SOLVE_PATH).toBe('')
    expect(envLocal.BYTEME_OPTIMIZER_DECODER).toBe('')
  })

  it('is ignored by git so the key cannot be committed', () => {
    const gitignore = readFileSync('.gitignore', 'utf8')
    expect(gitignore).toMatch(/^\.env$/m)
    expect(gitignore).toMatch(/^\.env\.local$/m)
  })
})

describe('blank credentials are rejected, not silently accepted', () => {
  // These use explicit override objects, so they hold regardless of what the
  // developer's real .env.local contains.
  it('reports the database as unconfigured when the URL is blank', () => {
    expect(isDatabaseConfigured({ NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' })).toBe(
      false,
    )
  })

  it('reports the database as unconfigured when the key is blank', () => {
    expect(
      isDatabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: '',
      }),
    ).toBe(false)
  })

  it('throws a clear error when the service-role key is empty', () => {
    let message = ''
    try {
      serverEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('reports missing configuration as 500, not as a client 400', () => {
    let caught: unknown
    try {
      serverEnv({ NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ConfigurationError)
    expect((caught as ConfigurationError).status).toBe(500)
    expect((caught as ConfigurationError).code).toBe('configuration_error')
  })

  it('names the missing variables without echoing any environment value', () => {
    let details: unknown
    try {
      serverEnv({ NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' })
    } catch (error) {
      details = (error as ConfigurationError).details
    }

    const issues = (details as { issues: Array<{ variable: string }> }).issues
    const variables = issues.map((issue) => issue.variable)
    expect(variables).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(variables).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('throws a clear error when the project URL is not a URL', () => {
    expect(() =>
      serverEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
        SUPABASE_SERVICE_ROLE_KEY: 'some-key',
      }),
    ).toThrow()
  })
})

describe('no optimizer is claimed while the interface is unconfirmed', () => {
  it('is unconfigured with the shipped defaults', () => {
    // Uses process.env defaults; the test process sets nothing.
    const config = readOptimizerConfig()

    expect(config.enabled).toBe(false)
    expect(isOptimizerConfigured(config)).toBe(false)
  })
})

describe('sanity: the API surface still validates without a database', () => {
  it('rejects a malformed factory payload before any DB access', () => {
    const result = factoryCreateSchema.safeParse({ slug: 'Bad Slug' })
    expect(result.success).toBe(false)
  })

  it('accepts a well-formed factory payload', () => {
    const result = factoryCreateSchema.safeParse({ slug: 'automobile-plant', name: 'Plant' })
    expect(result.success).toBe(true)
  })
})