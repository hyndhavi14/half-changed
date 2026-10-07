import { z } from 'zod'
import { numericInput, slugSchema, uuidSchema } from './common'

const builderMachineSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(100),
  rated_power_kw: numericInput.nonnegative(),
  is_active: z.boolean(),
}).strict()

const builderProcessSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(255),
  machine_slug: slugSchema,
  duration_minutes: numericInput.positive(),
  is_active: z.boolean(),
}).strict()

export const factoryBuilderSaveSchema = z.object({
  factory_id: uuidSchema.nullish(),
  factory: z.object({
    slug: slugSchema,
    name: z.string().trim().min(1).max(255),
    industry: z.string().trim().min(1).max(100),
    currency: z.string().length(3).transform((value) => value.toUpperCase()),
    working_hours_per_day: numericInput.int().min(1).max(24),
    solar_capacity_kw: numericInput.nonnegative(),
    peak_tariff: numericInput.nonnegative(),
    off_peak_tariff: numericInput.nonnegative(),
  }).strict(),
  machines: z.array(builderMachineSchema).min(1).max(100),
  processes: z.array(builderProcessSchema).min(1).max(500),
}).strict().superRefine((payload, ctx) => {
  const machineSlugs = new Set<string>()
  for (const [index, machine] of payload.machines.entries()) {
    if (machineSlugs.has(machine.slug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['machines', index, 'slug'],
        message: 'machine slugs must be unique',
      })
    }
    machineSlugs.add(machine.slug)
  }

  const processSlugs = new Set<string>()
  for (const [index, process] of payload.processes.entries()) {
    if (processSlugs.has(process.slug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['processes', index, 'slug'],
        message: 'process slugs must be unique',
      })
    }
    processSlugs.add(process.slug)
    if (!machineSlugs.has(process.machine_slug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['processes', index, 'machine_slug'],
        message: 'process machine must belong to the submitted factory model',
      })
    }
  }

  if (!payload.machines.some((machine) => machine.is_active)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['machines'],
      message: 'at least one machine must be available',
    })
  }
  if (payload.processes.some((process) =>
    process.is_active && !payload.machines.some((machine) => machine.slug === process.machine_slug && machine.is_active),
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['processes'],
      message: 'each process must be assigned to an available machine',
    })
  }
})

export type FactoryBuilderSave = z.output<typeof factoryBuilderSaveSchema>
