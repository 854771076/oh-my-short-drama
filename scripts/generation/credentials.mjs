import { readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export function credentialPath() {
  return resolve(process.env.SHORT_DRAMA_CREDENTIALS_FILE || resolve(homedir(), '.config/codex-short-drama/credentials.json'))
}

export function credential(name) {
  const environment = process.env[name]?.trim()
  if (environment) return environment
  try { return JSON.parse(readFileSync(credentialPath(), 'utf8'))[name]?.trim() || null }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

export async function saveCredential(name, value) {
  const path = credentialPath(), directory = dirname(path), temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let current = {}
  try { current = JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error?.code !== 'ENOENT') throw error }
  try {
    await writeFile(temporary, `${JSON.stringify({ ...current, [name]: value }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
    await chmod(path, 0o600)
  } finally { await rm(temporary, { force: true }) }
}
