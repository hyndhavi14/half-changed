import { useState } from 'react'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import Field from '../../components/Field/Field'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useFactory } from '../../context/useFactory'
import { saveBackendFactoryBuilder } from '../../data/backendApi'
import type {
  EnergyTariff,
  MachineType,
} from '../../data/types'
import { Link } from 'react-router-dom'
import styles from './BuilderPage.module.css'

const STEPS = [
  'Factory details',
  'Machines',
  'Processes',
  'Energy & tariff',
  'Review',
]

const INDUSTRIES = [
  'Food processing',
  'Textiles',
  'Bottling',
  'Cosmetics',
  'Metal works',
  'Other',
]

const MACHINE_TYPES: MachineType[] = [
  'mixer',
  'tank',
  'oven',
  'conveyor',
  'filler',
  'packer',
  'grinder',
  'generic',
]

interface MachineDraft {
  id: string
  slug?: string
  name: string
  power: string
  type: MachineType
  available: boolean
  editing: boolean
}

interface ProcessDraft {
  id: string
  slug?: string
  name: string
  machineId: string
  duration: string
  isActive: boolean
}

interface BuilderForm {
  name: string
  industry: string
  currency: string
  workingHours: string
  solarCapacity: string
  peakTariff: string
  offPeakTariff: string
  machines: MachineDraft[]
  processes: ProcessDraft[]
}

const INITIAL_FORM: BuilderForm = {
  name: '',
  industry: INDUSTRIES[0],
  currency: 'INR',
  workingHours: '8',
  solarCapacity: '40',
  peakTariff: '12',
  offPeakTariff: '6',
  machines: [
    { id: 'machine-1', name: 'Dough mixer', power: '40', type: 'mixer', available: true, editing: false },
    { id: 'machine-2', name: 'Heating tank', power: '25', type: 'tank', available: true, editing: false },
  ],
  processes: [
    { id: 'process-1', name: 'Mixing', machineId: 'machine-1', duration: '40', isActive: true },
  ],
}

const PLUS_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

const PENCIL_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="m14.8 5.7 3.5 3.5" stroke="currentColor" strokeWidth="1.8" />
  </svg>
)

const ARROW_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 12h15m-6-6 6 6-6 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

function formatAvailability(available: boolean) {
  return available ? 'Available' : 'Unavailable'
}

function isBuilderForm(value: unknown): value is BuilderForm {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<BuilderForm>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.industry === 'string' &&
    typeof candidate.currency === 'string' &&
    typeof candidate.workingHours === 'string' &&
    typeof candidate.solarCapacity === 'string' &&
    typeof candidate.peakTariff === 'string' &&
    typeof candidate.offPeakTariff === 'string' &&
    Array.isArray(candidate.machines) &&
    candidate.machines.every(
      (machine) =>
        typeof machine.id === 'string' &&
        (machine.slug === undefined || typeof machine.slug === 'string') &&
        typeof machine.name === 'string' &&
        typeof machine.power === 'string' &&
        MACHINE_TYPES.includes(machine.type) &&
        typeof machine.available === 'boolean' &&
        typeof machine.editing === 'boolean',
    ) &&
    Array.isArray(candidate.processes) &&
    candidate.processes.every(
      (process) =>
        typeof process.id === 'string' &&
        (process.slug === undefined || typeof process.slug === 'string') &&
        typeof process.name === 'string' &&
        typeof process.machineId === 'string' &&
        typeof process.duration === 'string' &&
        typeof process.isActive === 'boolean',
    )
  )
}

function loadSavedDraft(): {
  form: BuilderForm
  message: string
  messageIsError: boolean
} {
  try {
    const draft = window.localStorage.getItem('byteme-factory-builder-draft')
    if (!draft) return { form: INITIAL_FORM, message: '', messageIsError: false }

    const parsed: unknown = JSON.parse(draft)
    if (isBuilderForm(parsed)) {
      return { form: parsed, message: 'Saved draft restored.', messageIsError: false }
    }
    return {
      form: INITIAL_FORM,
      message: 'Saved draft data is invalid and was ignored.',
      messageIsError: true,
    }
  } catch (error) {
    return {
      form: INITIAL_FORM,
      message:
        error instanceof Error
          ? `Could not restore draft: ${error.message}`
          : 'Could not restore draft because browser storage is unavailable.',
      messageIsError: true,
    }
  }
}

function numberOr(value: unknown, fallback: string): string {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? String(parsed) : fallback
}

function uniqueSlug(value: string, fallback: string, used: Set<string>): string {
  const base = (value.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback)
    .slice(0, 63)
    .replace(/-+$/g, '')
  const safeBase = base.length >= 2 ? base : `${base || 'item'}-1`
  let candidate = safeBase
  let suffix = 2
  while (used.has(candidate)) {
    const ending = `-${suffix++}`
    candidate = `${safeBase.slice(0, 63 - ending.length)}${ending}`
  }
  used.add(candidate)
  return candidate
}

export default function BuilderPage() {
  const { backendData, loading, error, reloadFactories, setFactoryId } = useFactory()
  const [step, setStep] = useState(0)
  const [initialDraft] = useState(loadSavedDraft)
  const [form, setForm] = useState<BuilderForm>(initialDraft.form)
  const [message, setMessage] = useState(initialDraft.message)
  const [messageIsError, setMessageIsError] = useState(initialDraft.messageIsError)
  const [factoryIdToEdit, setFactoryIdToEdit] = useState<string | null>(null)
  const [factorySlugToEdit, setFactorySlugToEdit] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const startNewFactory = () => {
    setFactoryIdToEdit(null)
    setFactorySlugToEdit(null)
    setForm({ ...INITIAL_FORM, machines: INITIAL_FORM.machines.map((item) => ({ ...item })), processes: INITIAL_FORM.processes.map((item) => ({ ...item })) })
    setStep(0)
    setMessage('')
    setMessageIsError(false)
  }

  const loadSelectedFactory = () => {
    if (!backendData) return
    const storedBuilder = backendData.factory.config.builder
    const builderConfig = typeof storedBuilder === 'object' && storedBuilder !== null && !Array.isArray(storedBuilder)
      ? storedBuilder as Record<string, unknown>
      : {}
    const peak = backendData.tariffs.find((tariff) => tariff.slug === 'builder-peak')
    const offPeak = backendData.tariffs.find((tariff) => tariff.slug === 'builder-off-peak-early')
    const tariffRate = (tariff: Record<string, unknown> | undefined) =>
      tariff ? numberOr(tariff.energy_price_per_kwh, '') : ''
    setForm({
      name: backendData.factory.name,
      industry: backendData.factory.description ??
        (typeof builderConfig.industry === 'string' ? builderConfig.industry : INDUSTRIES[0]),
      currency: backendData.factory.currency,
      workingHours: numberOr(builderConfig.working_hours_per_day, '8'),
      solarCapacity: numberOr(builderConfig.solar_capacity_kw, '0'),
      peakTariff: tariffRate(peak) || '0',
      offPeakTariff: tariffRate(offPeak) || '0',
      machines: backendData.machines.map((machine) => ({
        id: machine.id,
        slug: machine.slug,
        name: machine.name,
        power: numberOr(machine.ratedPowerKw, '0'),
        type: MACHINE_TYPES.includes(machine.type as MachineType) ? machine.type as MachineType : 'generic',
        available: machine.isActive,
        editing: false,
      })),
      processes: backendData.processes.map((process) => ({
        id: process.id,
        slug: process.slug,
        name: process.name,
        machineId: process.machineId,
        duration: numberOr(process.durationMinutes, '1'),
        isActive: process.isActive,
      })),
    })
    setFactoryIdToEdit(backendData.factory.id)
    setFactorySlugToEdit(backendData.factory.slug)
    setStep(0)
    setMessage(`Editing persisted factory ${backendData.factory.name}.`)
    setMessageIsError(false)
  }

  const updateForm = <K extends keyof BuilderForm>(key: K, value: BuilderForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setMessage('')
  }

  const updateMachine = (id: string, updates: Partial<MachineDraft>) => {
    updateForm(
      'machines',
      form.machines.map((machine) =>
        machine.id === id ? { ...machine, ...updates } : machine,
      ),
    )
  }

  const addMachine = () => {
    const id = `machine-${crypto.randomUUID()}`
    updateForm('machines', [
      ...form.machines,
      { id, name: '', power: '', type: 'generic', available: true, editing: true },
    ])
  }

  const addProcess = () => {
    const availableMachine = form.machines.find((machine) => machine.available)
    const index = form.processes.length + 1
    updateForm('processes', [
      ...form.processes,
      {
        id: `process-${crypto.randomUUID()}`,
        name: `Step ${index}`,
        machineId: availableMachine?.id ?? '',
        duration: '30',
        isActive: true,
      },
    ])
  }

  const updateProcess = (id: string, updates: Partial<ProcessDraft>) => {
    updateForm(
      'processes',
      form.processes.map((process) =>
        process.id === id ? { ...process, ...updates } : process,
      ),
    )
  }

  const moveProcess = (index: number, offset: -1 | 1) => {
    const destination = index + offset
    if (destination < 0 || destination >= form.processes.length) return
    const reordered = [...form.processes]
    ;[reordered[index], reordered[destination]] = [
      reordered[destination],
      reordered[index],
    ]
    updateForm('processes', reordered)
  }

  const saveDraft = () => {
    try {
      window.localStorage.setItem('byteme-factory-builder-draft', JSON.stringify(form))
      setMessage('Draft saved on this device.')
      setMessageIsError(false)
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Could not save draft: ${error.message}`
          : 'Could not save draft because browser storage is unavailable.',
      )
      setMessageIsError(true)
    }
  }

  const saveFactory = async () => {
    const availableMachines = form.machines.filter((machine) => machine.available)
    if (!form.name.trim()) {
      setStep(0)
      setMessage('Enter a factory name before saving.')
      setMessageIsError(true)
      return
    }
    if (availableMachines.length === 0) {
      setStep(1)
      setMessage('Add at least one available machine before saving.')
      setMessageIsError(true)
      return
    }
    if (form.processes.length === 0) {
      setStep(2)
      setMessage('Add at least one process step before saving.')
      setMessageIsError(true)
      return
    }
    if (form.processes.some((process) =>
      process.isActive && !availableMachines.some((machine) => machine.id === process.machineId),
    )) {
      setStep(2)
      setMessage('Assign every process to an available machine before saving.')
      setMessageIsError(true)
      return
    }

    const usedMachineSlugs = new Set<string>()
    const machineSlugs = new Map<string, string>()
    const machines = form.machines
    for (const [index, machine] of machines.entries()) {
      machineSlugs.set(machine.id, uniqueSlug(machine.slug ?? machine.name, `machine-${index + 1}`, usedMachineSlugs))
    }
    const usedProcessSlugs = new Set<string>()
    const processes = form.processes.map((process, index) => ({
      slug: uniqueSlug(process.slug ?? process.name, `process-${index + 1}`, usedProcessSlugs),
      name: process.name.trim(),
      machine_slug: machineSlugs.get(process.machineId) ?? '',
      duration_minutes: Number(process.duration),
      is_active: process.isActive,
    }))
    const currency = form.currency.trim().toUpperCase()
    const factorySlug = factorySlugToEdit ?? uniqueSlug(form.name, 'factory', new Set())
    setSaving(true)
    setMessage('')
    setMessageIsError(false)
    try {
      const savedFactoryId = await saveBackendFactoryBuilder({
        factory_id: factoryIdToEdit,
        factory: {
          slug: factorySlug,
          name: form.name.trim(),
          industry: form.industry.trim(),
          currency,
          working_hours_per_day: Number(form.workingHours),
          solar_capacity_kw: Number(form.solarCapacity),
          peak_tariff: Number(form.peakTariff),
          off_peak_tariff: Number(form.offPeakTariff),
        },
        machines: machines.map((machine, index) => ({
          slug: machineSlugs.get(machine.id) ?? `machine-${index + 1}`,
          name: machine.name.trim(),
          type: machine.type,
          rated_power_kw: Number(machine.power),
          is_active: machine.available,
        })),
        processes,
      })
      window.localStorage.removeItem('byteme-factory-builder-draft')
      setFactoryIdToEdit(savedFactoryId)
      setMessage(factoryIdToEdit ? 'Factory changes were saved to the Backend database.' : 'Factory and manufacturing model were saved to the Backend database.')
      await reloadFactories()
      setFactoryId(savedFactoryId)
    } catch (failure) {
      setMessage(failure instanceof Error ? `Factory was not saved: ${failure.message}` : 'Factory was not saved because the Backend request failed.')
      setMessageIsError(true)
    } finally {
      setSaving(false)
    }
  }

  const renderDetails = () => (
    <Card title="Factory details" className={styles.detailsCard}>
      <div className={styles.detailsFields}>
        <Field id="builder-factory-name" label="Factory name">
          <input
            id="builder-factory-name"
            type="text"
            value={form.name}
            onChange={(event) => updateForm('name', event.currentTarget.value)}
            placeholder="e.g. Riverside Foods"
            required
          />
        </Field>
        <Field id="builder-industry" label="Industry type">
          <select
            id="builder-industry"
            value={form.industry}
            onChange={(event) => updateForm('industry', event.currentTarget.value)}
          >
            {INDUSTRIES.map((industry) => <option key={industry}>{industry}</option>)}
          </select>
        </Field>
          <Field id="builder-currency" label="Currency (ISO 4217)">
            <input
              id="builder-currency"
              type="text"
              minLength={3}
              maxLength={3}
              value={form.currency}
              onChange={(event) => updateForm('currency', event.currentTarget.value.toUpperCase())}
              required
            />
          </Field>
        <div className={styles.fieldGrid}>
          <Field id="builder-hours" label="Working hours / day">
            <input id="builder-hours" type="number" min="1" max="24" value={form.workingHours} onChange={(event) => updateForm('workingHours', event.currentTarget.value)} />
          </Field>
          <Field id="builder-solar" label="Solar capacity (kW)">
            <input id="builder-solar" type="number" min="0" value={form.solarCapacity} onChange={(event) => updateForm('solarCapacity', event.currentTarget.value)} />
          </Field>
          <Field id="builder-peak-tariff" label={`Peak tariff (${form.currency} /kWh)`}>
            <input id="builder-peak-tariff" type="number" min="0" step="0.1" value={form.peakTariff} onChange={(event) => updateForm('peakTariff', event.currentTarget.value)} />
          </Field>
          <Field id="builder-offpeak-tariff" label={`Off-peak tariff (${form.currency} /kWh)`}>
            <input id="builder-offpeak-tariff" type="number" min="0" step="0.1" value={form.offPeakTariff} onChange={(event) => updateForm('offPeakTariff', event.currentTarget.value)} />
          </Field>
        </div>
        <p className={styles.helper}>
          Tip: tariffs come from your electricity bill. You can change them later.
        </p>
      </div>
    </Card>
  )

  const renderMachines = () => (
    <Card
      title="Machines"
      action={
        <Button variant="secondary" icon={PLUS_ICON} onClick={addMachine}>
          Add machine
        </Button>
      }
    >
      <div className={styles.tableScroller}>
        <table className={styles.machineTable}>
          <thead>
            <tr>
              <th scope="col">Machine</th>
              <th scope="col">Power</th>
              <th scope="col">Type</th>
              <th scope="col">Available</th>
              <th scope="col" className="visually-hidden">Actions</th>
            </tr>
          </thead>
          <tbody>
            {form.machines.map((machine) => (
              <tr key={machine.id}>
                <th scope="row">
                  <input
                    aria-label={`${machine.name || 'New machine'} name`}
                    type="text"
                    value={machine.name}
                    disabled={!machine.editing}
                    onChange={(event) => updateMachine(machine.id, { name: event.currentTarget.value })}
                    placeholder="Machine name"
                  />
                </th>
                <td>
                  <label className={styles.powerInput}>
                    <input
                      aria-label={`${machine.name || 'New machine'} power in kW`}
                      type="number"
                      min="0"
                      value={machine.power}
                      disabled={!machine.editing}
                      onChange={(event) => updateMachine(machine.id, { power: event.currentTarget.value })}
                    />
                    <span>kW</span>
                  </label>
                </td>
                <td>
                  <select
                    aria-label={`${machine.name || 'New machine'} type`}
                    value={machine.type}
                    disabled={!machine.editing}
                    onChange={(event) => {
                      const type = MACHINE_TYPES.find(
                        (candidate) => candidate === event.currentTarget.value,
                      )
                      if (type) updateMachine(machine.id, { type })
                    }}
                  >
                    {MACHINE_TYPES.map((type) => <option key={type}>{type}</option>)}
                  </select>
                </td>
                <td>
                  <label className={styles.available}>
                    <input
                      aria-label={`${machine.name || 'New machine'} available`}
                      type="checkbox"
                      checked={machine.available}
                      onChange={(event) => updateMachine(machine.id, { available: event.currentTarget.checked })}
                    />
                    {formatAvailability(machine.available)}
                  </label>
                </td>
                <td>
                  <Button
                    variant="secondary"
                    className={styles.editButton}
                    aria-label={`${machine.editing ? 'Finish editing' : 'Edit'} ${machine.name || 'machine'}`}
                    aria-pressed={machine.editing}
                    onClick={() => updateMachine(machine.id, { editing: !machine.editing })}
                  >
                    {PENCIL_ICON}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )

  const renderProcesses = () => {
    const assignableMachines = form.machines.filter((machine) => machine.available)

    return (
      <Card
        title="Process flow"
        action={<span className={styles.processHint}>Use arrows to reorder · each step runs on one machine</span>}
      >
        <div className={styles.processFlow}>
          {form.processes.map((process, index) => (
            <div className={styles.processEntry} key={process.id}>
              <article className={`${styles.processCard} ${styles[`processColor${index % 5}`]}`}>
                <label>
                  <span className="visually-hidden">Step {index + 1} name</span>
                  <input
                    aria-label={`Step ${index + 1} name`}
                    type="text"
                    value={process.name}
                    onChange={(event) => updateProcess(process.id, { name: event.currentTarget.value })}
                  />
                </label>
                <div className={styles.processMeta}>
                  <select
                    aria-label={`Step ${index + 1} machine`}
                    value={process.machineId}
                    onChange={(event) => updateProcess(process.id, { machineId: event.currentTarget.value })}
                  >
                    {assignableMachines.map((machine) => (
                      <option key={machine.id} value={machine.id}>{machine.name || 'Unnamed machine'}</option>
                    ))}
                  </select>
                  <label>
                    <span className="visually-hidden">Step {index + 1} duration in minutes</span>
                    <input
                      aria-label={`Step ${index + 1} duration in minutes`}
                      type="number"
                      min="1"
                      value={process.duration}
                      onChange={(event) => updateProcess(process.id, { duration: event.currentTarget.value })}
                    />
                    <span>min</span>
                  </label>
                  <label>
                    <input
                      aria-label={`Step ${index + 1} active`}
                      type="checkbox"
                      checked={process.isActive}
                      onChange={(event) => updateProcess(process.id, { isActive: event.currentTarget.checked })}
                    />
                    Active
                  </label>
                </div>
                <div className={styles.processActions}>
                  <Button variant="secondary" aria-label={`Move ${process.name} up`} disabled={index === 0} onClick={() => moveProcess(index, -1)}>↑</Button>
                  <Button variant="secondary" aria-label={`Move ${process.name} down`} disabled={index === form.processes.length - 1} onClick={() => moveProcess(index, 1)}>↓</Button>
                  <Button variant="secondary" aria-label={`Remove ${process.name}`} onClick={() => updateForm('processes', form.processes.filter((item) => item.id !== process.id))}>×</Button>
                </div>
              </article>
              {index < form.processes.length - 1 && (
                <span className={styles.flowArrow}>{ARROW_ICON}</span>
              )}
            </div>
          ))}
          <button className={styles.addStep} type="button" onClick={addProcess}>
            + Add step
          </button>
        </div>
      </Card>
    )
  }

  const renderEnergy = () => (
    <Card title="Energy & tariff">
      <p className={styles.energyIntro}>
        Review the working hours, on-site solar capacity, and electricity rates
        used for this factory.
      </p>
      <div className={styles.energySummary}>
        <div><span>Working hours / day</span><strong>{form.workingHours} h</strong></div>
        <div><span>Solar capacity</span><strong>{form.solarCapacity} kW</strong></div>
        <div><span>Peak tariff</span><strong>{form.currency} {form.peakTariff} /kWh</strong></div>
        <div><span>Off-peak tariff</span><strong>{form.currency} {form.offPeakTariff} /kWh</strong></div>
      </div>
      <div className={styles.energyBands} aria-label="Daily tariff band preview">
        {Array.from({ length: 24 }, (_, hour) => {
          const tariff: EnergyTariff = hour >= 18 && hour < 22 ? 'peak' : 'off'
          return <span key={hour} className={styles[`tariff-${tariff}`]} title={`${String(hour).padStart(2, '0')}:00 · ${tariff}`} />
        })}
      </div>
      <p className={styles.energyCaption}>Off-peak · Peak tariff</p>
      <p className={styles.energyCaption}>
        Saving creates three tariff windows: off-peak 00:00–18:00, peak 18:00–22:00 and off-peak 22:00–24:00.
        Solar capacity is saved as factory configuration only. The optimizer uses stored 15-minute solar
        generation readings for the planning horizon, which this builder does not create, so add energy
        readings before running optimization for a new factory.
      </p>
    </Card>
  )

  const renderReview = () => (
    <Card title="Review factory">
      <dl className={styles.reviewGrid}>
        <div><dt>Factory name</dt><dd>{form.name.trim() || 'Add a factory name'}</dd></div>
        <div><dt>Industry</dt><dd>{form.industry}</dd></div>
        <div><dt>Working hours / day</dt><dd>{form.workingHours} h</dd></div>
        <div><dt>Solar capacity</dt><dd>{form.solarCapacity} kW</dd></div>
        <div><dt>Peak tariff</dt><dd>{form.currency} {form.peakTariff} /kWh</dd></div>
        <div><dt>Off-peak tariff</dt><dd>{form.currency} {form.offPeakTariff} /kWh</dd></div>
        <div><dt>Available machines</dt><dd>{form.machines.filter((machine) => machine.available).length}</dd></div>
        <div><dt>Process steps</dt><dd>{form.processes.length}</dd></div>
      </dl>
      <div className={styles.reviewLists}>
        <div>
          <h3>Machines</h3>
          <ul>
            {form.machines.map((machine) => (
              <li key={machine.id}>
                {machine.name || 'Unnamed machine'} · {machine.power || '0'} kW · {machine.type}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Process flow</h3>
          <ol>
            {form.processes.map((process) => (
              <li key={process.id}>{process.name || 'Unnamed step'} · {process.duration} min</li>
            ))}
          </ol>
          <p className={styles.energyCaption}>
            Steps are saved without dependencies, so the optimizer only keeps one step at a time on each machine.
          </p>
        </div>
      </div>
    </Card>
  )

  const content = [
    renderDetails(),
    renderMachines(),
    renderProcesses(),
    renderEnergy(),
    renderReview(),
  ][step]

  return (
    <div className={styles.builderPage}>
      <PageHeader
        eyebrow={backendData ? `Selected persisted factory: ${backendData.factory.name}` : loading ? 'Loading persisted factory data' : 'Factory data unavailable'}
        title="Factory builder"
        actions={<>
          <Button variant="secondary" onClick={startNewFactory}>New factory</Button>
          {backendData && (
            <Button variant="secondary" onClick={loadSelectedFactory}>Edit selected factory</Button>
          )}
        </>}
      />
      {!backendData && !loading && error && <p role="alert">{error}</p>}

      <ol className={styles.stepper} aria-label="Factory builder steps">
        {STEPS.map((label, index) => {
          const current = index === step
          const done = index < step
          return (
            <li key={label}>
              <button
                className={`${styles.stepPill} ${current ? styles.current : done ? styles.done : styles.upcoming}`}
                type="button"
                aria-current={current ? 'step' : undefined}
                onClick={() => {
                  setStep(index)
                  setMessage('')
                }}
              >
                <span className={styles.stepNumber}>{done ? '✓' : index + 1}</span>
                {label}
              </button>
            </li>
          )
        })}
      </ol>

      {content}

      {message && (
        <p className={messageIsError ? styles.errorMessage : styles.successMessage} role={messageIsError ? 'alert' : 'status'}>
          {message}
        </p>
      )}

      <footer className={styles.footer}>
        <Link className={styles.backLink} to="/">← Back to dashboard</Link>
        <div className={styles.footerActions}>
          <Button variant="secondary" onClick={saveDraft} disabled={saving}>Save draft</Button>
          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              onClick={() => {
                setStep((current) => Math.min(STEPS.length - 1, current + 1))
                setMessage('')
              }}
            >
              {step === STEPS.length - 2
                ? 'Review factory →'
                : `Next: ${STEPS[step + 1]} →`}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void saveFactory()} isLoading={saving}>Save factory</Button>
          )}
        </div>
      </footer>
    </div>
  )
}
