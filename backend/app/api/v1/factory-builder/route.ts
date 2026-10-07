import type { NextRequest } from 'next/server'
import { assertFactoryAccess, assertFactoryAdmin, authenticateRequest, withAuthentication } from '@/lib/auth'
import { created, ok, parseBody } from '@/lib/http'
import { factoryBuilderSaveSchema } from '@/lib/schemas/factory-builder'
import { client, throwIfError } from '@/lib/repositories/base'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withAuthentication(async (request: NextRequest) => {
  const user = await authenticateRequest(request)
  const body = await parseBody(request, factoryBuilderSaveSchema)

  if (body.factory_id) {
    assertFactoryAccess(user, body.factory_id)
  } else {
    assertFactoryAdmin(user)
  }

  const { data, error } = await client().rpc('save_factory_builder', {
    p_factory_id: body.factory_id ?? null,
    p_factory: body.factory,
    p_machines: body.machines,
    p_processes: body.processes,
  })
  throwIfError(error, 'save factory builder model')
  if (
    !data || typeof data !== 'object' || Array.isArray(data) ||
    typeof (data as Record<string, unknown>).factory_id !== 'string'
  ) {
    throw new Error('The factory builder save returned an invalid result.')
  }

  return body.factory_id
    ? ok(data)
    : created(data, {
        location: `/api/v1/factories/${(data as Record<string, string>).factory_id}`,
      })
})
