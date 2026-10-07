/**
 * GET  /api/v1/factories/:factoryId/optimization-requests — list requests
 * POST /api/v1/factories/:factoryId/optimization-requests — run an optimization
 *
 * POST assembles a generic factory problem and submits it to the optimizer
 * adapter. Until the optimizer's real interface is configured it answers 503
 * and records the request as `not_configured`. It NEVER returns a fabricated
 * schedule or a made-up cost figure.
 *
 * `dry_run: true` builds and stores the same payload without contacting
 * anything, which is how the payload gets reviewed and tested against the
 * Python optimizer before the interface is agreed.
 */

import type { NextRequest } from 'next/server'
import { withFactoryAccess } from '@/lib/auth'
import {
  created,
  errorResponse,
  ok,
  parseBody,
  parseSearchParams,
  parseUuidParam,
} from '@/lib/http'
import {
  optimizationRequestCreateSchema,
  optimizationRequestListQuerySchema,
} from '@/lib/schemas/optimization'
import { parseSort } from '@/lib/schemas/common'
import { listOptimizationRequests } from '@/lib/repositories/optimization'
import { runOptimization } from '@/lib/services/optimization'
import { assertFactoryExists } from '@/lib/services/factories'
import { isAppError } from '@/lib/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Context {
  params: { factoryId: string }
}

export const GET = withFactoryAccess(async (request: NextRequest, { params }: Context) => {
  const factoryId = parseUuidParam(params.factoryId, 'factoryId')
  const query = parseSearchParams(request.nextUrl.searchParams, optimizationRequestListQuerySchema)
  const sort = parseSort(query.sort, { column: 'created_at', ascending: false })

  const result = await listOptimizationRequests(
    factoryId,
    { limit: query.limit, offset: query.offset, sortColumn: sort.column, sortAscending: sort.ascending },
    { status: query.status },
  )

  return ok(result.rows, { total: result.total ?? undefined, limit: query.limit, offset: query.offset })
})

export const POST = withFactoryAccess(async (request: NextRequest, { params }: Context) => {
  const factoryId = parseUuidParam(params.factoryId, 'factoryId')
  await assertFactoryExists(factoryId)

  const body = await parseBody(request, optimizationRequestCreateSchema)

  try {
    const result = await runOptimization(factoryId, body)

    if (body.dry_run) {
      return created({
        request: result.request,
        solution: null,
        schedules: [],
        note: 'Payload built and stored. No optimizer was contacted and no solution was produced.',
      })
    }

    return created({
      request: result.request,
      solution: result.solution,
      schedules: result.schedules,
    })
  } catch (error) {
    // A 503 or 502 from the adapter is a legitimate outcome of POST, not a
    // crash: return the recorded error body with its real status rather than
    // collapsing it into a generic 500.
    if (isAppError(error)) return errorResponse(error)
    throw error
  }
})