#!/usr/bin/env node
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { providerSetupCatalog, testProviderConnection } from './generation/providers.mjs'

const requiredModalities = ['image', 'video', 'audio']

export async function verifyProjectProviders(projectRootArg, options = {}) {
  const root = resolve(projectRootArg)
  const projectPath = resolve(root, '.short-drama/project.json')
  const project = JSON.parse(await readFile(projectPath, 'utf8'))
  const catalog = new Map((options.catalog || providerSetupCatalog()).map((item) => [item.key, item]))
  const selections = {}

  for (const modality of requiredModalities) {
    const selected = project.providers?.[modality]
    if (!selected?.provider || !selected?.model_or_workflow) throw new Error(`请先在 Dashboard 选择并保存 ${modality} Provider 与模型`)
    const provider = catalog.get(selected.provider)
    if (!provider?.configured) throw new Error(`${selected.provider} 尚未配置本机凭据或连接信息`)
    if (!provider.models?.[modality]?.some((model) => model.id === selected.model_or_workflow)) throw new Error(`${modality} Provider 模型不在当前可用目录`)
    selections[modality] = { provider: selected.provider, model_or_workflow: selected.model_or_workflow }
  }

  const tester = options.testConnection || testProviderConnection
  const providers = []
  for (const provider of [...new Set(Object.values(selections).map((item) => item.provider))]) {
    await tester(provider)
    providers.push({ provider, ok: true })
  }

  const receipt = {
    version: 1,
    checked_at: new Date().toISOString(),
    project_key: project.key,
    workflow_type: project.workflow?.type || 'standard',
    selections,
    providers,
  }
  const path = resolve(root, '.short-drama/provider-setup.json')
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
  return { ...receipt, path: relative(root, path) }
}

async function main() {
  const projectRoot = process.argv[2]
  if (projectRoot === '--self-check') return console.log('ok')
  if (!projectRoot) throw new Error('用法：provider-setup.mjs <项目目录>')
  console.log(JSON.stringify(await verifyProjectProviders(projectRoot), null, 2))
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
