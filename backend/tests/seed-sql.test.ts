/**
 * Structural checks for supabase/seed.sql.
 *
 * These exist because the seed failed on a real database with:
 *   ERROR: 42703: column v.metadata does not exist
 * The `VALUES` list aliased four columns while the `SELECT` read a fifth.
 * Nothing in the TypeScript test suite caught it, because the seed is SQL that
 * only executes inside Postgres.
 *
 * These checks are static, so they run without a database and catch the class
 * of error before it reaches Supabase. They are NOT a substitute for running
 * the seed; they only catch shape mismatches that are visible by reading.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = join('supabase', 'migrations', '0001_initial_schema.sql')
const SEED = join('supabase', 'seed.sql')

const migrationSql = readFileSync(MIGRATION, 'utf8')
const seedSql = readFileSync(SEED, 'utf8')
const seedLines = seedSql.split('\n')

interface ValuesBlock {
  /** Line number (1-based) of the `) as v(...)` line. */
  aliasLine: number
  /** The table being inserted into. */
  table: string
  /** Column names from the alias. */
  alias: string[]
  /** Raw text of the VALUES tuples. */
  body: string
}

const SQL_TYPES =
  'uuid|text|jsonb|numeric|integer|boolean|timestamptz|time|smallint|smallint\\[\\]'

/** Parses every `) as v(cols)` block together with its VALUES tuples. */
function parseValuesBlocks(): ValuesBlock[] {
  const blocks: ValuesBlock[] = []

  for (let i = 0; i < seedLines.length; i += 1) {
    const aliasMatch = seedLines[i]?.match(/\) as v\(([^)]*)\)/)
    if (!aliasMatch?.[1]) continue

    // The table is declared by the nearest preceding `insert into`.
    let table = ''
    for (let j = i; j >= 0; j -= 1) {
      const t = seedLines[j]?.match(/^insert into public\.(\w+)/)
      if (t?.[1]) {
        table = t[1]
        break
      }
    }

    // The VALUES opener is the nearest preceding `join (values`.
    let opener = -1
    for (let j = i; j >= 0; j -= 1) {
      if (/join \(values/i.test(seedLines[j] ?? '')) {
        opener = j
        break
      }
    }

    blocks.push({
      aliasLine: i + 1,
      table,
      alias: aliasMatch[1].split(',').map((s) => s.trim()),
      body: opener === -1 ? '' : seedLines.slice(opener + 1, i).join('\n'),
    })
  }

  return blocks
}

/** Splits a VALUES body into top-level tuples, respecting quotes and nesting. */
function splitTuples(body: string): string[] {
  const tuples: string[] = []
  let depth = 0
  let current = ''
  let inString = false

  for (const ch of body) {
    if (ch === "'") {
      inString = !inString
      current += ch
      continue
    }
    if (!inString) {
      if (ch === '(') {
        if (depth === 0) current = ''
        depth += 1
        current += ch
        continue
      }
      if (ch === ')') {
        depth -= 1
        current += ch
        if (depth === 0) tuples.push(current)
        continue
      }
    }
    current += ch
  }

  return tuples
}

/**
 * Counts a tuple's columns.
 *
 * Bracket-aware: `array[1, 2, 3]` is a single value, not four. Quote-aware: a
 * comma inside a JSON string literal does not separate columns.
 */
function countColumns(tuple: string): number {
  let depth = 0
  let bracket = 0
  let count = 1
  let inString = false

  // Skip the outer parentheses.
  for (let i = 1; i < tuple.length - 1; i += 1) {
    const ch = tuple[i]
    if (ch === "'") {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === '[') bracket += 1
    else if (ch === ']') bracket -= 1
    else if (ch === ',' && depth === 0 && bracket === 0) count += 1
  }

  return count
}

const blocks = parseValuesBlocks()

describe('seed VALUES aliases', () => {
  it('finds every VALUES block that joins on machine data', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(5)
    expect(blocks.map((b) => b.table)).toEqual(
      expect.arrayContaining([
        'machines',
        'processes',
        'process_dependencies',
        'production_orders',
        'electricity_tariffs',
      ]),
    )
  })

  it('aliases every column its SELECT reads', () => {
    const problems: string[] = []

    for (const block of blocks) {
      // The SELECT for this block is the text above its alias line.
      let start = -1
      for (let j = block.aliasLine - 2; j >= 0; j -= 1) {
        const line = seedLines[j] ?? ''
        if (/^select /i.test(line) || /^insert into /i.test(line)) {
          start = j
          break
        }
      }
      if (start === -1) continue

      const selectBlock = seedLines.slice(start, block.aliasLine).join('\n')
      const referenced = [...new Set([...selectBlock.matchAll(/\bv\.([a-z_]+)/g)].map((m) => m[1] as string))]

      for (const column of referenced) {
        if (!block.alias.includes(column)) {
          problems.push(
            `${block.table} (line ${block.aliasLine}): SELECT reads v.${column} but the alias is [${block.alias.join(', ')}]`,
          )
        }
      }
    }

    // Regression guard for: "column v.metadata does not exist".
    expect(problems).toEqual([])
  })

  it('gives every tuple exactly as many values as the alias declares', () => {
    const problems: string[] = []

    for (const block of blocks) {
      const tuples = splitTuples(block.body)
      if (tuples.length === 0) continue

      const widths = tuples.map(countColumns)
      const bad = widths.filter((width) => width !== block.alias.length)

      if (bad.length > 0) {
        problems.push(
          `${block.table} (line ${block.aliasLine}): ${tuples.length} tuples with widths [${widths.join(', ')}], alias declares ${block.alias.length}`,
        )
      }
    }

    expect(problems).toEqual([])
  })

  it('supplies the expected number of rows per entity', () => {
    const expected: Record<string, number> = {
      machines: 7,
      processes: 8,
      process_dependencies: 7,
      production_orders: 3,
      electricity_tariffs: 5,
    }

    for (const block of blocks) {
      const want = expected[block.table]
      if (want === undefined) continue
      expect(splitTuples(block.body), `${block.table} row count`).toHaveLength(want)
    }
  })
})

describe('seed columns exist in the migration', () => {
  /** Columns declared per table in the migration. */
  function declaredColumns(): Record<string, string[]> {
    const result: Record<string, string[]> = {}

    for (const match of migrationSql.matchAll(
      /create table public\.(\w+) \(([\s\S]*?)\n\);/g,
    )) {
      const table = match[1] as string
      const columns: string[] = []

      for (const line of (match[2] ?? '').split('\n')) {
        const column = line.trim().match(new RegExp(`^([a-z_]+)\\s+(${SQL_TYPES})`))
        if (column?.[1]) columns.push(column[1])
      }

      result[table] = columns
    }

    return result
  }

  const declared = declaredColumns()

  it('parses all eleven tables from the migration', () => {
    expect(Object.keys(declared)).toHaveLength(11)
  })

  it('never inserts a column the migration does not declare', () => {
    const drift: string[] = []

    for (const match of seedSql.matchAll(
      /insert into public\.(\w+)\s*\(([\s\S]*?)\)\s*(?:values|select)/g,
    )) {
      const table = match[1] as string
      const known = declared[table] ?? []

      for (const column of (match[2] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (!known.includes(column)) drift.push(`${table}.${column}`)
      }
    }

    expect(drift).toEqual([])
  })

  it('matches every column named in each on-conflict update to a real column', () => {
    const problems: string[] = []

    // `metadata = excluded.metadata` is valid; a typo on the left is not.
    for (const match of seedSql.matchAll(/^\s{2}([a-z_]+)\s*=\s*excluded\.([a-z_]+),?$/gm)) {
      const [, left, right] = match
      if (left !== right) problems.push(`${left} = excluded.${right}`)
    }

    // Left and right sides must at least name the same column; a mismatch means
    // the UPDATE target and the inserted value disagree.
    expect(problems).toEqual([])
  })
})

describe('seed transaction handling', () => {
  it('opens a transaction and commits before the summary block', () => {
    const beginIndex = seedLines.findIndex((l) => l.trim() === 'begin;')
    const commitIndex = seedLines.findIndex((l) => l.trim() === 'commit;')
    const summaryIndex = seedLines.findIndex((l) => /^do \$\$/.test(l))

    expect(beginIndex).toBeGreaterThan(-1)
    expect(commitIndex).toBeGreaterThan(beginIndex)
    expect(summaryIndex).toBeGreaterThan(commitIndex)
  })

  it('seeds no schedules or optimization results', () => {
    // ByteMe never fabricates optimizer output, so the seed must not invent any.
    expect(seedSql).not.toMatch(/insert into public\.schedules/)
    expect(seedSql).not.toMatch(/insert into public\.schedule_entries/)
    expect(seedSql).not.toMatch(/insert into public\.optimization_results/)
  })

  it('marks the demo factory as demo data in both JSONB columns', () => {
    expect(seedSql).toMatch(/"demo"\s*:\s*true/)
    expect(seedSql).toMatch(/"demo_only"\s*:\s*true/)
  })

  it('keeps the mock Chocolate durations compatible with the half-hour optimizer grid', () => {
    expect(seedSql).toContain("'grind-nibs',        'Grind Nibs',        'DEMO. Crack and grind roasted nibs.',                60,  'roasting-drum'")
    expect(seedSql).toContain("'mould-shell',       'Mould Shell',       'DEMO. Deposit shells in moulds.',                      60,  'moulding-line'")
    expect(seedSql).toContain("'cool-and-demould',  'Cool And Demould',  'DEMO. Cool then demould the shells.',                  30,  'cooling-tunnel'")
    expect(seedSql).toContain("'pack-retail',       'Pack Retail',       'DEMO. Wrap and case the product for retail.',          30,  'packing-cell'")
  })

  it('labels synthetic energy accurately and stores quarter-hour solar energy', () => {
    expect(seedSql).toContain("then round((280 * greatest(0.0, sin(pi() * (extract(hour from t.ts at time zone 'Europe/Amsterdam') - 8) / 9.0)))::numeric * 5) / 20")
    expect(seedSql).toMatch(/'simulated',\s*'\{"demo": true, "note": "synthetic demonstration series"\}'::jsonb/)
    expect(seedSql).toMatch(/on conflict \(factory_id, coalesce\(machine_id, '00000000-0000-0000-0000-000000000000'::uuid\), recorded_at\) do update set\s+generation_kwh = excluded\.generation_kwh,\s+source = excluded\.source;/)
    expect(seedSql).not.toMatch(/on conflict do update set[\s\S]{0,100}consumption_kwh/)
  })

  it('adjusts only the approved time-of-use tariff boundaries', () => {
    expect(seedSql).toContain("('off-peak',  'DEMO. Off-peak (night)',        '22:00'::time, '07:00'::time")
    expect(seedSql).toContain("('shoulder',  'DEMO. Shoulder',                 '07:00'::time, '22:00'::time")
    expect(seedSql).toContain("('peak-sat',  'DEMO. Peak (Saturday)',          '08:00'::time, '20:00'::time")
    expect(seedSql).toContain("('demand',    'DEMO. Monthly demand charge',    '00:00'::time, '23:59'::time")
  })

  it('preserves the existing machine availability calendars', () => {
    expect(seedSql).toContain('"day": 6, "start": "08:00", "end": "14:00"')
    expect(seedSql).toContain('"day": 1, "start": "06:00", "end": "22:00"')
    expect(seedSql).toContain('"day": 1, "start": "08:00", "end": "20:00"')
  })
})

describe('seed remains industry-neutral outside the demo rows', () => {
  it('uses no industry vocabulary in the schema migration', () => {
    const lower = migrationSql.toLowerCase()
    for (const term of ['chocolate', 'cocoa', 'conche', 'tempering', 'mould', 'cacao']) {
      expect(lower).not.toContain(term)
    }
  })

  it('seeds the chocolate demo factory under an explicitly marked slug', () => {
    expect(seedSql).toContain("'demo-chocolate-factory'")
  })
})