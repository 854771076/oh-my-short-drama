import { readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export function credentialPath() {
  return resolve(process.env.SHORT_DRAMA_CREDENTIALS_FILE || resolve(homedir(), '.config/oh-my-short-drama/credentials.json'))
}

function legacyCredentialPath() {
  return resolve(homedir(), '.config/codex-short-drama/credentials.json')
}

function credentialPaths() {
  return process.env.SHORT_DRAMA_CREDENTIALS_FILE ? [credentialPath()] : [credentialPath(), legacyCredentialPath()]
}

export function credential(name) {
  const environment = process.env[name]?.trim()
  if (environment) return environment
  for (const path of credentialPaths()) {
    try { return JSON.parse(readFileSync(path, 'utf8'))[name]?.trim() || null }
    catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
  return null
}

export async function saveCredential(name, value) {
  const path = credentialPath(), directory = dirname(path), temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let current = {}
  try { current = JSON.parse(await readFile(path, 'utf8')) }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error
    // 旧版凭据只在新路径不存在时迁入，避免更名后丢失其他 Provider 配置。
    if (!process.env.SHORT_DRAMA_CREDENTIALS_FILE) {
      try { current = JSON.parse(await readFile(legacyCredentialPath(), 'utf8')) }
      catch (legacyError) { if (legacyError?.code !== 'ENOENT') throw legacyError }
    }
  }
  try {
    await writeFile(temporary, `${JSON.stringify({ ...current, [name]: value }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
    await chmod(path, 0o600)
  } finally { await rm(temporary, { force: true }) }
}
