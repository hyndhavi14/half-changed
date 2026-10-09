import assert from 'node:assert/strict'
import test from 'node:test'
import { solarShiftScope } from '../src/data/solarShiftScope.ts'

test('SolarShift is enabled only for the Demo Chocolate Factory', () => {
  assert.equal(solarShiftScope({ slug: 'demo-chocolate-factory' }).enabled, true)
  assert.equal(solarShiftScope({ slug: 'demo-chocolate-factory' }).after, 'After SolarShift')
  for (const slug of ['demo-pharmaceutical-factory', 'demo-beverage-factory', 'demo-furniture-factory', '', null]) {
    const scope = solarShiftScope({ slug })
    assert.equal(scope.enabled, false)
    assert.equal(scope.mover, 'the optimizer')
    assert.equal(scope.after, 'Optimized')
  }
})
