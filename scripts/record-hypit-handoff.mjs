#!/usr/bin/env node
import { access, copyFile, lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { relative, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
if (args[0] === '--self-check') {
  console.log('ok')
  process.exit(0)
}
const rootIndex = args.indexOf('--project-root')
const hypitIndex = args.indexOf('--hypit-root')
const fileIndex = args.indexOf('--files')
const sourceKeyIndex = args.indexOf('--source-key')
const sourceVersionIndex = args.indexOf('--source-version')
const root = rootIndex >= 0 ? resolve(args[rootIndex + 1] || '') : null
const hypitRoot = hypitIndex >= 0 ? resolve(args[hypitIndex + 1] || '') : null
const files = fileIndex >= 0 ? args.slice(fileIndex + 1) : []
const sourceKey = sourceKeyIndex >= 0 ? args[sourceKeyIndex + 1] : null
const sourceVersion = sourceVersionIndex >= 0 ? args[sourceVersionIndex + 1] : null
if (!root || !hypitRoot || !files.length || !sourceKey || !sourceVersion) throw new Error('用法：record-hypit-handoff.mjs --project-root <项目> --hypit-root <Hypit 项目> --source-key <src-...> --source-version <vNNN> --files <文件...>')

async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex') }
function confined(base, candidate, label) {
  const local = relative(base, candidate)
  if (!local || local === '..' || local.startsWith(`..${sep}`)) throw new Error(`${label} 必须位于指定目录内`)
  return local
}
const projectRoot = await realpath(root)
const project = JSON.parse(await readFile(resolve(projectRoot, '.short-drama/project.json'), 'utf8'))
const manifest = JSON.parse(await readFile(resolve(projectRoot, 'source/manifest.json'), 'utf8'))
const source = manifest.sources?.[sourceKey]
const version = source?.versions?.find((item) => item.id === sourceVersion)
if (!source || source.kind !== 'reference-video' || source.selectedVersionId !== sourceVersion || !/^[0-9a-f]{64}$/.test(version?.sha256 || '')) throw new Error('source-key/source-version 必须是当前 selected reference-video 版本')
const hypitReal = await realpath(hypitRoot)
const entries = []
const inputRoot = resolve(projectRoot, '.short-drama/hypit/inputs')
await mkdir(inputRoot, { recursive: true })
confined(projectRoot, await realpath(inputRoot), '项目输入目录')
for (const file of files) {
  const path = resolve(hypitRoot, file)
  confined(hypitRoot, path, 'Hypit 文件路径')
  confined(hypitReal, await realpath(path), 'Hypit 文件真实路径')
  await access(path)
  const sourcePath = relative(hypitRoot, path)
  const target = resolve(inputRoot, sourcePath)
  const targetParent = resolve(target, '..')
  await mkdir(targetParent, { recursive: true })
  confined(projectRoot, await realpath(targetParent), '项目输入目录')
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error('目标文件不能是符号链接')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await copyFile(path, target)
  entries.push({ path: relative(projectRoot, target), source_path: sourcePath, sha256: await sha256(target) })
}
const report = { schema_version: 1, mode: 'intermediate-only', project_key: project.key, source_ref: { key: sourceKey, version_id: sourceVersion, sha256: version.sha256 }, files: entries }
const handoffDir = resolve(projectRoot, '.short-drama/hypit')
await mkdir(handoffDir, { recursive: true })
confined(projectRoot, await realpath(handoffDir), '项目 Hypit 目录')
const output = resolve(handoffDir, 'handoff.json')
try {
  if ((await lstat(output)).isSymbolicLink()) throw new Error('handoff 不能是符号链接')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const temporary = `${output}.tmp-${process.pid}`
await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await rename(temporary, output)
console.log(JSON.stringify({ status: 'ok', path: '.short-drama/hypit/handoff.json', files: entries.length }))
