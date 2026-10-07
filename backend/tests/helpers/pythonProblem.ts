import {
  chocolateFactory,
  dependency,
  grindProcess,
  roastProcess,
  tariff,
  thermalMachine,
} from './fixtures'
import type { OptimizationProblem, ProblemTariff } from '@/lib/optimizer/contract'

const START = Date.parse('2026-03-02T00:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000
const QUARTER_HOUR_MS = 15 * 60 * 1000

const baseTariff: ProblemTariff = {
  id: tariff.id,
  slug: tariff.slug,
  name: tariff.name,
  currency: tariff.currency,
  startTime: '00:00',
  endTime: '23:59',
  daysOfWeek: null,
  energyPricePerKwh: 0,
  demandChargePerKw: null,
  fixedCharge: null,
  taxRate: null,
  effectiveFrom: null,
  effectiveTo: null,
  priority: 10,
}

const dayTariffs: ProblemTariff[] = [
  { ...baseTariff, slug: 'off-peak', startTime: '22:00', endTime: '07:00', energyPricePerKwh: 0.085 },
  { ...baseTariff, slug: 'shoulder', startTime: '07:00', endTime: '22:00', energyPricePerKwh: 0.142 },
  {
    ...baseTariff,
    slug: 'peak',
    startTime: '17:00',
    endTime: '22:00',
    daysOfWeek: [1, 2, 3, 4, 5],
    energyPricePerKwh: 0.218,
    priority: 20,
  },
  {
    ...baseTariff,
    slug: 'peak-sat',
    startTime: '08:00',
    endTime: '20:00',
    daysOfWeek: [6],
    energyPricePerKwh: 0.165,
    priority: 20,
  },
  { ...baseTariff, slug: 'demand', energyPricePerKwh: 0, demandChargePerKw: 18.5, fixedCharge: 145, priority: 30 },
]

export function pythonTestProblem(overrides: Partial<OptimizationProblem> = {}): OptimizationProblem {
  return {
    schemaVersion: '1.0.0',
    requestReference: 'req-test-python',
    factoryId: chocolateFactory.id,
    factory: {
      slug: chocolateFactory.slug,
      name: chocolateFactory.name,
      timezone: chocolateFactory.timezone,
      currency: chocolateFactory.currency,
      config: chocolateFactory.config,
      metadata: chocolateFactory.metadata,
    },
    horizon: {
      start: new Date(START).toISOString(),
      end: new Date(START + 24 * HOUR_MS).toISOString(),
    },
    machines: [{
      id: thermalMachine.id,
      slug: thermalMachine.slug,
      name: thermalMachine.name,
      type: thermalMachine.type,
      ratedPowerKw: thermalMachine.rated_power_kw,
      minPowerKw: thermalMachine.min_power_kw,
      maxPowerKw: thermalMachine.max_power_kw,
      minRuntimeMinutes: thermalMachine.min_runtime_minutes,
      maxRuntimeMinutes: thermalMachine.max_runtime_minutes,
      availability: thermalMachine.availability,
      metadata: thermalMachine.metadata,
    }],
    processes: [
      {
        id: roastProcess.id,
        slug: roastProcess.slug,
        name: roastProcess.name,
        description: roastProcess.description,
        durationMinutes: roastProcess.duration_minutes,
        machineId: roastProcess.machine_id,
        powerRequirementKw: roastProcess.power_requirement_kw,
        productionQuantity: roastProcess.production_quantity,
        unit: roastProcess.unit,
        metadata: roastProcess.metadata,
      },
      {
        id: grindProcess.id,
        slug: grindProcess.slug,
        name: grindProcess.name,
        description: grindProcess.description,
        durationMinutes: 60,
        machineId: grindProcess.machine_id,
        powerRequirementKw: grindProcess.power_requirement_kw,
        productionQuantity: grindProcess.production_quantity,
        unit: grindProcess.unit,
        metadata: grindProcess.metadata,
      },
    ],
    dependencies: [{
      processId: dependency.process_id,
      dependsOnProcessId: dependency.depends_on_process_id,
      dependencyType: dependency.dependency_type,
      lagMinutes: dependency.lag_minutes,
    }],
    productionOrders: [],
    energyData: Array.from({ length: 96 }, (_, index) => ({
      recordedAt: new Date(START + index * QUARTER_HOUR_MS).toISOString(),
      intervalMinutes: 15,
      consumptionKwh: 120,
      generationKwh: 0.05,
      machineId: null,
    })),
    tariffs: dayTariffs,
    objective: {},
    constraints: {},
    ...overrides,
  }
}

const sevenDayProcessIds = [
  roastProcess.id,
  grindProcess.id,
  '12121212-1212-4121-8121-121212121212',
  '23232323-2323-4232-8232-232323232323',
  '34343434-3434-4343-8343-343434343434',
  '45454545-4545-4454-8454-454545454545',
  '56565656-5656-4565-8565-565656565656',
  '67676767-6767-4676-8676-676767676767',
]

const sevenDayDurations = [120, 45, 300, 720, 60, 35, 25, 40]
const sevenDayPowers = [250, 200, 165, 60, 85, 130, 95, 38]

export function canonicalSevenDayPythonProblem(): OptimizationProblem {
  const horizonEnd = START + 168 * HOUR_MS
  const base = pythonTestProblem()
  const processes = sevenDayProcessIds.map((id, index) => ({
    ...base.processes[index % base.processes.length]!,
    id,
    slug: `demo-process-${index + 1}`,
    name: `Demo Process ${index + 1}`,
    durationMinutes: sevenDayDurations[index]!,
    machineId: thermalMachine.id,
    powerRequirementKw: sevenDayPowers[index]!,
    productionQuantity: 100 + index,
  }))

  return pythonTestProblem({
    horizon: {
      start: new Date(START).toISOString(),
      end: new Date(horizonEnd).toISOString(),
    },
    processes,
    dependencies: processes.slice(1).map((process, index) => ({
      processId: process.id,
      dependsOnProcessId: processes[index]!.id,
      dependencyType: 'finish_to_start',
      lagMinutes: 0,
    })),
    energyData: Array.from({ length: 168 * 4 }, (_, index) => {
      const hour = Math.floor(index / 4)
      const generationKwh = hour === 30 ? 0.1 : 0.05
      return {
        recordedAt: new Date(START + index * QUARTER_HOUR_MS).toISOString(),
        intervalMinutes: 15,
        consumptionKwh: 120,
        generationKwh,
        machineId: null,
      }
    }),
  })
}
