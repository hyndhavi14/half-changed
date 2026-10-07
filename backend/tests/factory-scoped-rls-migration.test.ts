import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join('supabase', 'migrations', '0008_factory_scoped_authenticated_rls.sql'),
  'utf8',
)

describe('factory-scoped authenticated RLS migration', () => {
  it('replaces the broad APERC tariff policy with factory-scoped access', () => {
    expect(migration).toContain(
      'drop policy if exists aperc_scenario_tariffs_authenticated_all on public.aperc_scenario_tariffs;',
    )
    expect(migration).toContain('create policy aperc_scenario_tariffs_factory_scope')
    expect(migration).toContain('using (public.byteme_has_factory_access(factory_id))')
  })

  it('keeps anonymous table access out of the migration', () => {
    expect(migration).not.toMatch(/grant\s+[^;]*\bto\s+anon\b/i)
    expect(migration).not.toMatch(/create policy[^;]*\bto\s+anon\b/i)
  })

  it('checks every table with authenticated factory data for unscoped policies', () => {
    expect(migration).toContain("'aperc_scenario_tariffs'")
    expect(migration).toContain("roles::text[] @> array['authenticated']::text[]")
    expect(migration).toContain("btrim(coalesce(qual, ''), '() ') = 'true'")
    expect(migration).toContain("btrim(coalesce(with_check, ''), '() ') = 'true'")
  })
})
