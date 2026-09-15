#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKFLOW_ID = '2099866760106491906'
const INPUT_CLASSES = /(?:LoadVideo|VHS_LoadVideo|LoadVideoUpload)/i
const OUTPUT_CLASSES = /(?:SaveVideo|VideoCombine|VHS_VideoCombine)/i
const INPUT_FIELDS = ['video', 'file', 'path']
const OPTIONAL_FIELDS = new Set(['scale', 'upscale_by', 'width', 'height', 'fps', 'tile_size'])

function scalar(value) { return ['string', 'number', 'boolean'].includes(typeof value) }

function inspectSafeScalarParameters(nodes) {
  return Object.fromEntries(nodes.flatMap((node) => Object.entries(node.inputs || {}).filter(([field, value]) => OPTIONAL_FIELDS.has(field) && scalar(value)).map(([field, value]) => [`${node.node_id}.${field}`, value])))
}

export function inspectVideoUpscaleWorkflow(workflow, workflowId) {
  if (String(workflowId) !== WORKFLOW_ID) throw new Error('SeedVR2.5 工作流 ID 不一致')
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error('RunningHub 工作流导出必须是节点对象')
  const nodes = Object.entries(workflow).filter(([, node]) => node && typeof node === 'object' && !Array.isArray(node)).map(([node_id, node]) => ({ node_id, ...node }))
  const inputs = nodes.flatMap((node) => INPUT_CLASSES.test(node.class_type || '') ? INPUT_FIELDS.filter((field_name) => typeof node.inputs?.[field_name] === 'string').map((field_name) => ({ node_id: node.node_id, field_name })) : [])
  const outputs = nodes.filter((node) => OUTPUT_CLASSES.test(node.class_type || ''))
  if (inputs.length !== 1) throw new Error('无法唯一识别视频输入节点')
  if (outputs.length !== 1) throw new Error('无法唯一识别保存视频节点')
  return { workflow_id: String(workflowId), video_input: inputs[0], video_output: { node_id: outputs[0].node_id, class_type: outputs[0].class_type }, optional_parameters: inspectSafeScalarParameters(nodes) }
}

function rejectSecrets(value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const current = path ? `${path}.${key}` : key
    if (/(?:api[_-]?key|token|password|secret|authorization|cookie)/i.test(key)) throw new Error(`工作流导出包含敏感字段：${current}`)
    rejectSecrets(child, current)
  }
}

function graphCandidates(value, found = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return found
  const nodes = Object.values(value)
  if (nodes.length && nodes.every((node) => node && typeof node === 'object' && !Array.isArray(node)) && nodes.some((node) => typeof node.class_type === 'string')) found.push(value)
  for (const child of nodes) graphCandidates(child, found)
  return found
}

function exportedGraph(document) {
  if (typeof document?.data?.prompt === 'string') {
    try { document = { ...document, data: { ...document.data, prompt: JSON.parse(document.data.prompt) } } } catch { throw new Error('工作流接口的 data.prompt 字段不是有效 JSON') }
  }
  if (typeof document?.workflow === 'string') {
    try { document = { ...document, workflow: JSON.parse(document.workflow) } } catch { throw new Error('工作流导出的 workflow 字段不是有效 JSON') }
  }
  const candidates = graphCandidates(document)
  if (candidates.length !== 1) throw new Error('无法从导出文件唯一识别工作流节点图')
  return candidates[0]
}

async function main() {
  const [inputArg, workflowId, outputFlag, outputArg] = process.argv.slice(2)
  if (!inputArg || !workflowId || outputFlag !== '--output' || !outputArg) throw new Error('用法：inspect-runninghub-workflow.mjs <API 导出 JSON> 2099866760106491906 --output <mapping.json>')
  const input = await realpath(resolve(inputArg))
  const raw = await readFile(input)
  const document = JSON.parse(raw)
  rejectSecrets(document)
  const mapping = inspectVideoUpscaleWorkflow(exportedGraph(document), workflowId)
  const repository = await realpath(fileURLToPath(new URL('../../', import.meta.url)))
  const output = resolve(outputArg)
  const outputParent = await realpath(dirname(output))
  const location = relative(repository, output)
  if (location.startsWith('..') || isAbsolute(location) || !(outputParent === repository || outputParent.startsWith(`${repository}/`))) throw new Error('mapping 输出路径必须位于当前仓库内')
  const info = await stat(input)
  const value = { ...mapping, source_export_sha256: createHash('sha256').update(raw).digest('hex'), source_exported_at: info.mtime.toISOString() }
  const temporary = `${output}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, output)
  console.log(output)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
