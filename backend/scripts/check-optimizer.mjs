#!/usr/bin/env node
// Checks the local Python optimizer setup the backend will use, and says exactly what to fix.
// Read-only: it reads backend/.env.local (or .env) and starts Python; it changes nothing.
//   npm run optimizer:check
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const backendDir = process.cwd()

function readEnvFile(file) {
  if (!existsSync(file)) return {}
  const values = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const index = line.indexOf('=')
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[line.slice(0, index).trim()] = value
  }
  return values
}

const env = { ...readEnvFile(join(backendDir, '.env')), ...readEnvFile(join(backendDir, '.env.local')), ...process.env }
// Same reduced environment the backend gives Python (lib/optimizer/pythonSubprocess.ts), so this
// check fails exactly when the backend would.
const PYTHON_ENVIRONMENT_KEYS = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PYTHONUSERBASE']
const pythonEnv = { PYTHONIOENCODING: 'utf-8' }
for (const key of PYTHON_ENVIRONMENT_KEYS) if (process.env[key]) pythonEnv[key] = process.env[key]
let failed = false
const ok = (text) => console.log(`  OK    ${text}`)
const bad = (text, fix) => {
  failed = true
  console.log(`  FAIL  ${text}`)
  if (fix) console.log(`        Fix: ${fix}`)
}

console.log('\nByteMe optimizer check\n')

if (env.BYTEME_OPTIMIZER_ENABLED === 'true') ok('BYTEME_OPTIMIZER_ENABLED=true')
else bad(`BYTEME_OPTIMIZER_ENABLED is "${env.BYTEME_OPTIMIZER_ENABLED ?? '(not set)'}"`, 'add BYTEME_OPTIMIZER_ENABLED=true to backend\\.env.local')

const transport = (env.BYTEME_OPTIMIZER_TRANSPORT ?? 'http').trim().toLowerCase()
if (transport === 'python-subprocess') ok('BYTEME_OPTIMIZER_TRANSPORT=python-subprocess')
else bad(`BYTEME_OPTIMIZER_TRANSPORT is "${transport}"`, 'add BYTEME_OPTIMIZER_TRANSPORT=python-subprocess to backend\\.env.local')

const timeout = Number(env.BYTEME_OPTIMIZER_TIMEOUT_MS ?? 180000)
if (Number.isFinite(timeout) && timeout >= 180000 && timeout <= 300000) ok(`timeout ${timeout} ms`)
else bad(`BYTEME_OPTIMIZER_TIMEOUT_MS is ${env.BYTEME_OPTIMIZER_TIMEOUT_MS}`, 'set BYTEME_OPTIMIZER_TIMEOUT_MS=300000 (two solves of up to 60 s each)')

const python = (env.BYTEME_OPTIMIZER_PYTHON_EXECUTABLE ?? '').trim()
const workdir = (env.BYTEME_OPTIMIZER_PYTHON_WORKING_DIRECTORY ?? '').trim() || resolve(backendDir, '..')
if (!python) {
  bad('BYTEME_OPTIMIZER_PYTHON_EXECUTABLE is not set', 'set it to the full path of python.exe, e.g. C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python312\\python.exe (find it with: py -0p)')
} else if (/path[\\/]to/i.test(python)) {
  bad(`BYTEME_OPTIMIZER_PYTHON_EXECUTABLE is still the placeholder "${python}"`, 'replace it with the real path of python.exe (find it with: py -0p)')
}

if (existsSync(join(workdir, 'optimizer', 'public_api.py'))) ok(`working directory contains the optimizer package: ${workdir}`)
else bad(`no optimizer\\public_api.py inside the working directory ${workdir}`, 'remove BYTEME_OPTIMIZER_PYTHON_WORKING_DIRECTORY from backend\\.env.local (the default is the project root), or set it to the folder that contains the optimizer folder')

if (python && !/path[\\/]to/i.test(python)) {
  const probe = [
    'import json, sys',
    'info = {"python": sys.version.split()[0], "executable": sys.executable}',
    'try:',
    '    import ortools',
    '    from ortools.sat.python import cp_model',
    '    m = cp_model.CpModel(); x = m.NewIntVar(0, 10, "x"); m.Maximize(x)',
    '    s = cp_model.CpSolver(); info["ortools"] = ortools.__version__; info["solve"] = s.StatusName(s.Solve(m))',
    'except Exception as e:',
    '    info["ortools_error"] = type(e).__name__ + ": " + str(e)',
    'try:',
    '    import optimizer.public_api',
    '    info["optimizer"] = "importable"',
    'except Exception as e:',
    '    info["optimizer_error"] = type(e).__name__ + ": " + str(e)',
    'print(json.dumps(info))',
  ].join('\n')
  const result = spawnSync(python, ['-c', probe], { cwd: existsSync(workdir) ? workdir : backendDir, env: pythonEnv, encoding: 'utf8', timeout: 60000, windowsHide: true })
  if (result.error) {
    bad(`could not start ${python} (${result.error.code ?? result.error.message})`, 'set BYTEME_OPTIMIZER_PYTHON_EXECUTABLE to the full path of an installed python.exe (find it with: py -0p)')
  } else if (result.status !== 0) {
    const text = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim()
    bad(`${python} exited with code ${result.status}: ${text.split(/\r?\n/).slice(-2).join(' ')}`, /Microsoft Store|was not found/i.test(text) || result.status === 9009
      ? 'this is the Microsoft Store shortcut, not a real Python. Install Python from python.org and use the full path to python.exe'
      : 'check the Python installation')
  } else {
    let info = {}
    try { info = JSON.parse(result.stdout.trim().split(/\r?\n/).pop()) } catch { /* reported below */ }
    if (info.python) ok(`Python ${info.python} at ${info.executable}`)
    const [major, minor] = String(info.python ?? '0.0').split('.').map(Number)
    if (major === 3 && minor < 9) bad(`Python ${info.python} is too old`, 'use Python 3.10 or newer')
    if (info.ortools) ok(`OR-Tools ${info.ortools} works (test solve: ${info.solve})`)
    else if (/Application Control|4551/i.test(info.ortools_error ?? '')) bad(
      `OR-Tools is blocked by Windows Application Control (error 4551): ${info.ortools_error}`,
      'this is a Windows security policy. Do not try to bypass it. Run the backend on a computer or environment where OR-Tools is allowed (another PC, or a Linux environment such as GitHub Codespaces), or ask the administrator to allow OR-Tools.',
    )
    else if (/DLL load failed/i.test(info.ortools_error ?? '')) bad(`OR-Tools native library failed to load: ${info.ortools_error}`, `reinstall it: "${python}" -m pip install --force-reinstall ortools, and install the Microsoft Visual C++ Redistributable`)
    else bad(`OR-Tools is not usable: ${info.ortools_error ?? 'unknown'}`, `"${python}" -m pip install ortools`)
    if (info.optimizer) ok('optimizer package imports')
    else bad(`optimizer package does not import: ${info.optimizer_error ?? 'unknown'}`, 'fix the working directory (see above) or the missing module named in the error')
  }
}

console.log(failed ? '\nResult: NOT READY — fix the FAIL lines, then restart the backend (Ctrl+C, npm run dev).\n' : '\nResult: READY — restart the backend if it is running, then press Run optimization.\n')
process.exit(failed ? 1 : 0)
