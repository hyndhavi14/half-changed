import type { FrontendDependencyRef, FrontendMachineRef, FrontendProcessRef } from './backendContracts'

export interface ProcessStage {
  index: number
  processes: FrontendProcessRef[]
}

export interface ProcessStagesResult {
  stages: ProcessStage[]
  cyclic: boolean
}

export interface MachineStage {
  index: number
  machines: FrontendMachineRef[]
}

export interface MachineStagesResult {
  stages: MachineStage[]
  unassigned: FrontendMachineRef[]
}

export function processStages(
  processes: readonly FrontendProcessRef[],
  dependencies: readonly FrontendDependencyRef[],
): ProcessStagesResult {
  const processById = new Map(processes.map((process) => [process.id, process]))
  const parents = new Map<string, string[]>()
  for (const dependency of dependencies) {
    if (!processById.has(dependency.processId) || !processById.has(dependency.dependsOnProcessId)) continue
    const values = parents.get(dependency.processId) ?? []
    values.push(dependency.dependsOnProcessId)
    parents.set(dependency.processId, values)
  }
  const stageById = new Map<string, number>()
  const visiting = new Set<string>()
  let cyclic = false
  const stageOf = (id: string): number => {
    const cached = stageById.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) {
      cyclic = true
      return 0
    }
    visiting.add(id)
    const dependenciesForProcess = parents.get(id) ?? []
    const index = dependenciesForProcess.length === 0
      ? 0
      : 1 + Math.max(...dependenciesForProcess.map(stageOf))
    visiting.delete(id)
    stageById.set(id, index)
    return index
  }
  for (const process of processes) stageOf(process.id)
  if (cyclic) return { stages: [{ index: 0, processes: [...processes] }], cyclic: true }
  const groups = new Map<number, FrontendProcessRef[]>()
  for (const process of processes) {
    const index = stageById.get(process.id) ?? 0
    const group = groups.get(index) ?? []
    group.push(process)
    groups.set(index, group)
  }
  return {
    stages: [...groups].sort(([left], [right]) => left - right)
      .map(([index, stageProcesses]) => ({ index, processes: stageProcesses })),
    cyclic: false,
  }
}

export function machineStages(
  machines: readonly FrontendMachineRef[],
  processes: readonly FrontendProcessRef[],
  stages: readonly ProcessStage[],
): MachineStagesResult {
  const processStage = new Map<string, number>()
  for (const stage of stages) {
    for (const process of stage.processes) processStage.set(process.id, stage.index)
  }
  const processIdsByMachine = new Map<string, string[]>()
  for (const process of processes) {
    const ids = processIdsByMachine.get(process.machineId) ?? []
    ids.push(process.id)
    processIdsByMachine.set(process.machineId, ids)
  }
  const machinesByStage = new Map<number, FrontendMachineRef[]>()
  const unassigned: FrontendMachineRef[] = []
  for (const machine of machines) {
    const associated = processIdsByMachine.get(machine.id) ?? []
    if (associated.length === 0) {
      unassigned.push(machine)
      continue
    }
    const stageIndex = Math.min(...associated.map((id) => processStage.get(id) ?? 0))
    const group = machinesByStage.get(stageIndex) ?? []
    group.push(machine)
    machinesByStage.set(stageIndex, group)
  }
  return {
    stages: [...machinesByStage].sort(([left], [right]) => left - right)
      .map(([index, stageMachines]) => ({ index, machines: stageMachines })),
    unassigned,
  }
}
