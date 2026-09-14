import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { generationProvenance, getTask, updateTaskStatus } from './task-ledger.mjs'
import { detectMedia } from './grid-detect.mjs'

const execute = promisify(execFile)
const assetLedger = fileURLToPath(new URL('./asset-ledger.mjs', import.meta.url))

function assetType(task) {
  if (task.type === 'video') return 'video'
  if (task.type === 'audio') return 'audio'
  return task.target.startsWith('char-') ? 'character' : task.target.startsWith('scene-') ? 'scene' : task.target.startsWith('prop-') ? 'prop' : task.target.startsWith('board-') ? 'storyboard' : 'other'
}

function nextVersion(asset, offset = 0) {
  const latest = Math.max(0, ...(asset?.versions || []).map((item) => Number(item.id.slice(1)) || 0))
  return `v${String(latest + offset + 1).padStart(3, '0')}`
}

async function run(...args) { return (await execute(process.execPath, [assetLedger, ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout.trim() }

export async function syncTaskResult(rootArg, taskId, result) {
  const root = resolve(rootArg)
  const task = await getTask(root, taskId)
  if (result.status === 'pending') return { ...result, local_task: await updateTaskStatus(root, taskId, 'running') }
  if (result.status === 'failed') return { ...result, local_task: await updateTaskStatus(root, taskId, 'failed') }
  if (result.status !== 'completed' || !result.outputs?.length) throw new Error('远端任务已完成但没有可回写输出')
  if (task.status === 'completed' && task.outputVersionId) return { ...result, local_task: task, output_version_ids: [task.outputVersionId] }

  const request = JSON.parse(await readFile(resolve(root, task.requestPath), 'utf8'))
  let ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  const temporary = await mkdtemp(resolve(tmpdir(), 'short-drama-sync-'))
  try {
    if (!ledger.assets?.[task.target]) {
      const record = resolve(temporary, 'asset.json')
      await writeFile(record, `${JSON.stringify({ key: task.target, type: assetType(task), name: task.target }, null, 2)}\n`)
      await run('put', root, record)
      ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    }
    const versions = (ledger.assets[task.target].versions || []).filter((item) => item.provenance?.task_id === taskId).map((item) => item.id)
    const existingCount = versions.length
    const quality = []
    for (const [index, output] of result.outputs.entries()) {
      if (versions[index]) continue
      if (output.media_type && output.media_type !== task.type) throw new Error(`输出类型与任务不一致：${output.media_type}/${task.type}`)
      const versionId = nextVersion(ledger.assets[task.target], index - existingCount)
      const provenance = resolve(temporary, `provenance-${index}.json`)
      await writeFile(provenance, `${JSON.stringify(generationProvenance(task, request), null, 2)}\n`)
      let registered
      if (output.url) registered = JSON.parse(await run('fetch', root, task.target, output.url, versionId, '-', provenance))
      else if (output.b64_json) {
        const encoded = resolve(temporary, `output-${index}.txt`)
        await writeFile(encoded, output.b64_json)
        registered = JSON.parse(await run('decode', root, task.target, encoded, versionId, '-', provenance))
      } else throw new Error(`第 ${index + 1} 个输出无 URL 或 base64 内容`)
      // 成片宫格自动检测：只打标，不自动重生（门框/地平线可能误报，交给人工复核）
      if (task.type === 'video') {
        let flags = []
        let report = null
        try { report = detectMedia(resolve(root, registered.localPath)); if (report.detected) flags = [report.confidence === 'high' ? 'grid_high_confidence' : 'grid_suspect'] }
        catch { flags = ['grid_check_failed'] }
        quality.push({ version_id: versionId, flags, ...(report ? { grid_report: report } : {}) })
        if (flags.length) {
          const flagFile = resolve(temporary, `flags-${index}.json`)
          await writeFile(flagFile, JSON.stringify(flags))
          await run('flag-version', root, task.target, versionId, flagFile)
        }
      }
      versions.push(versionId)
    }
    return { ...result, output_version_ids: versions, output_quality: quality, local_task: await updateTaskStatus(root, taskId, 'completed', versions[0]) }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--self-check') throw new Error('仅支持 --self-check')
  if (assetType({ type: 'image', target: 'board-ep001-001' }) !== 'storyboard' || nextVersion({ versions: [{ id: 'v002' }] }) !== 'v003') throw new Error('任务回写自检失败')
  console.log('ok')
}
