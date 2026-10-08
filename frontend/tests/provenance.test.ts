import assert from 'node:assert/strict'
import test from 'node:test'
import { energySourceProvenance, PROVENANCE_LABEL } from '../src/data/provenance.ts'

test('classifies only explicitly measured or modeled energy sources', () => {
  assert.equal(energySourceProvenance('measured'), 'measured')
  assert.equal(energySourceProvenance('simulated'), 'modeled')
  assert.equal(energySourceProvenance('modeled_optimizer'), 'modeled')
  assert.equal(energySourceProvenance(undefined), 'unclassified')
  assert.equal(energySourceProvenance('imported'), 'unclassified')
  assert.equal(PROVENANCE_LABEL.measured, 'Measured')
  assert.equal(PROVENANCE_LABEL.unavailable, 'Not available')
})
