import type { NextRequest } from 'next/server'
import { ok, withErrorHandling } from '@/lib/http'
import { getPublicSolarShiftScenario } from '@/lib/services/public-solarshift'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Context {
  params: { scenario: string }
}

export const GET = withErrorHandling(async (_request: NextRequest, { params }: Context) => {
  const data = await getPublicSolarShiftScenario(params.scenario)
  const response = ok(data)
  response.headers.set('Cache-Control', 'public, max-age=60, s-maxage=300')
  return response
})
