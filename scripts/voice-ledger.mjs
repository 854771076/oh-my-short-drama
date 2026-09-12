#!/usr/bin/env node
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { withFileLock } from './file-lock.mjs'

const LEDGER_RELATIVE = '.short-drama/voices.json'
const REQUIRED_FIELDS = ['voice_id', 'flavor', 'target_model', 'source', 'created_at']
const shapeBroken = () => new Error('voices.json 形状损坏')

function ledgerPath(root) { return resolve(root, LEDGER_RELATIVE) }
function emptyLedger() { return { version: 1, voices: [] } }
export function safeVoiceFileId(voiceId) { return String(voiceId).replace(/[^A-Za-z0-9._-]/g, '_') }
export function previewRelativePath(voiceId, format) {
  const extension = /^[A-Za-z0-9]{1,8}$/.test(format || '') ? format : 'wav'
  return `.short-drama/voice-previews/${safeVoiceFileId(voiceId)}.${extension}`
}

// voices.json 会随项目同步/共享，是读取信任边界：preview_path 只能指向该 voice_id 的唯一安全预览文件。
function safeStoredPreviewPath(voiceId, value, readSide) {
  const fail = () => { throw readSide ? shapeBroken() : new Error('音色预览路径非法') }
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\') || isAbsolute(value)) fail()
  const parts = value.split('/')
  if (parts.length !== 3 || parts[0] !== '.short-drama' || parts[1] !== 'voice-previews' || parts.some((part) => !part || part === '.' || part === '..')) fail()
  const extension = parts[2].includes('.') ? parts[2].slice(parts[2].lastIndexOf('.') + 1) : ''
  if (previewRelativePath(voiceId, extension) !== value) fail()
  return value
}

export async function readVoiceLedger(rootArg) {
  const root = await realpath(resolve(rootArg))
  let raw
  try { raw = await readFile(ledgerPath(root), 'utf8') } catch (error) { if (error?.code === 'ENOENT') return emptyLedger(); throw error }
  let data
  try { data = JSON.parse(raw) } catch { throw shapeBroken() }
  if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.voices)) throw shapeBroken()
  // 每行都过归一化/容器校验，下游 list/remove/delete 只拿到安全行
  data.voices = data.voices.map((row) => normalizeEntry(row, { readSide: true }))
  for (const row of data.voices) {
    if (!row.preview_path) continue
    const target = resolve(root, row.preview_path)
    let stats
    try { stats = await lstat(target) } catch (error) { if (error?.code !== 'ENOENT') throw shapeBroken(); continue }
    if (!stats.isFile()) throw shapeBroken() // 目录/符号链接占位会让云端删除后的 rm 失败
  }
  return data
}
async function writeVoiceLedger(root, data) {
  const path = ledgerPath(root)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`)
  await rename(temporary, path)
}
function normalizeEntry(entry, { readSide = false } = {}) {
  const reject = (message) => { throw readSide ? shapeBroken() : new Error(message) }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) reject('音色登记形状错误')
  for (const field of REQUIRED_FIELDS) if (!entry[field]) reject(`音色登记缺少字段：${field}`)
  if (!['design', 'clone'].includes(entry.source)) reject('音色来源无效')
  const previewRaw = entry.preview_path === undefined ? null : entry.preview_path
  let previewPath = null
  if (previewRaw !== null) {
    if (typeof previewRaw !== 'string') reject('音色预览路径非法')
    previewPath = safeStoredPreviewPath(String(entry.voice_id), previewRaw, readSide)
  }
  return {
    voice_id: String(entry.voice_id),
    flavor: String(entry.flavor),
    target_model: String(entry.target_model),
    prefix: entry.prefix ? String(entry.prefix) : null,
    name: entry.name ? String(entry.name) : null,
    source: entry.source,
    preview_path: previewPath,
    upload_receipt_id: entry.upload_receipt_id ? String(entry.upload_receipt_id) : null,
    request_id: entry.request_id ? String(entry.request_id) : null,
    created_at: entry.created_at,
  }
}
export async function addVoiceEntry(rootArg, entry) {
  const root = await realpath(resolve(rootArg))
  const normalized = normalizeEntry(entry)
  const lockKey = createHash('sha256').update('voice-ledger').digest('hex')
  await withFileLock(resolve(root, '.short-drama', 'locks', `voice-ledger-${lockKey}`), async () => {
    const ledger = await readVoiceLedger(root)
    ledger.voices = ledger.voices.filter((item) => item.voice_id !== normalized.voice_id)
    ledger.voices.push(normalized)
    await writeVoiceLedger(root, ledger)
  })
  return normalized
}
export async function removeVoiceEntry(rootArg, voiceId) {
  const root = await realpath(resolve(rootArg))
  let removed = null
  const lockKey = createHash('sha256').update('voice-ledger').digest('hex')
  await withFileLock(resolve(root, '.short-drama', 'locks', `voice-ledger-${lockKey}`), async () => {
    const ledger = await readVoiceLedger(root)
    const match = ledger.voices.find((item) => item.voice_id === voiceId)
    if (match) {
      removed = match
      ledger.voices = ledger.voices.filter((item) => item.voice_id !== voiceId)
      await writeVoiceLedger(root, ledger)
    }
  })
  return removed
}
export async function findVoiceEntry(rootArg, voiceId) {
  return (await readVoiceLedger(rootArg)).voices.find((item) => item.voice_id === voiceId) || null
}

export async function selfCheck() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'short-drama-voice-ledger-')))
  try {
    await mkdir(resolve(root, '.short-drama'), { recursive: true })
    const empty = await readVoiceLedger(root)
    if (empty.version !== 1 || empty.voices.length !== 0) throw new Error('空账本形状错误')
    const now = new Date().toISOString()
    const entry = { voice_id: 'cosyvoice-v3.5-plus-a/b', flavor: 'cosyvoice-design', target_model: 'cosyvoice-v3.5-plus', prefix: 'cv', name: 'cv', source: 'design', preview_path: null, upload_receipt_id: null, request_id: 'r1', created_at: now }
    await addVoiceEntry(root, entry)
    if (safeVoiceFileId('cosyvoice-v3.5-plus-a/b') !== 'cosyvoice-v3.5-plus-a_b') throw new Error('文件名消毒错误')
    if (previewRelativePath('x', 'mp3') !== '.short-drama/voice-previews/x.mp3') throw new Error('预览路径错误')
    const traversalPreview = previewRelativePath('x', '../../x')
    if (!traversalPreview.startsWith('.short-drama/voice-previews/') || !traversalPreview.endsWith('.wav') || traversalPreview.includes('..')) throw new Error('云端返回扩展名路径穿越未被阻断')
    if (previewRelativePath('x', 'x/y') !== '.short-drama/voice-previews/x.wav') throw new Error('非法扩展名未回退为 wav')
    if ((await readVoiceLedger(root)).voices.length !== 1) throw new Error('音色登记写入失败')
    await addVoiceEntry(root, { ...entry, request_id: 'r2' })
    if ((await readVoiceLedger(root)).voices.length !== 1 || (await readVoiceLedger(root)).voices[0].request_id !== 'r2') throw new Error('同 voice_id 覆盖失败')
    const removed = await removeVoiceEntry(root, entry.voice_id)
    if (removed?.voice_id !== entry.voice_id || (await readVoiceLedger(root)).voices.length !== 0) throw new Error('音色登记删除失败')
    if (await removeVoiceEntry(root, 'missing') !== null) throw new Error('删除不存在音色应返回 null')
    await addVoiceEntry(root, entry)
    if ((await findVoiceEntry(root, entry.voice_id))?.voice_id !== entry.voice_id || await findVoiceEntry(root, 'missing') !== null) throw new Error('findVoiceEntry 查询错误')
    await writeFile(resolve(root, '.short-drama', 'voices.json'), '{broken json\n')
    let corruptRejected = false
    try { await readVoiceLedger(root) } catch (error) { if (!String(error.message).includes('形状损坏')) throw error; corruptRejected = true }
    if (!corruptRejected) throw new Error('损坏 JSON 未被拒绝')
    // 植入账本：preview_path 穿越/绝对路径/伪装分隔符必须在读取边界被判形状损坏
    const plantedNow = new Date().toISOString()
    const plantedRow = (previewPath) => ({ voice_id: 'cosyvoice-v2-p7probe', flavor: 'cosyvoice-clone', target_model: 'cosyvoice-v2', source: 'clone', preview_path: previewPath, created_at: plantedNow })
    for (const malicious of ['../sentinel.txt', '../../etc/sentinel', '/tmp/sentinel.wav', '.short-drama/voice-previews/other.wav', '.short-drama/voice-previews/x.wav/..', `.short-drama/voice-previews/${safeVoiceFileId('cosyvoice-v2-p7probe')}.wav\\..`]) {
      await writeFile(resolve(root, '.short-drama', 'voices.json'), `${JSON.stringify({ version: 1, voices: [plantedRow(malicious)] })}\n`)
      let plantedRejected = false
      try { await readVoiceLedger(root) } catch (error) { if (!String(error.message).includes('形状损坏')) throw error; plantedRejected = true }
      if (!plantedRejected) throw new Error(`植入账本 preview_path 未被拒绝：${malicious}`)
    }
    // 目录/符号链接占位落在合法预览路径上同样拒绝；普通文件按安全行读回
    const safePreview = previewRelativePath('cosyvoice-v2-p7probe', 'wav')
    await mkdir(resolve(root, '.short-drama', 'voice-previews', 'cosyvoice-v2-p7probe.wav'), { recursive: true })
    await writeFile(resolve(root, '.short-drama', 'voices.json'), `${JSON.stringify({ version: 1, voices: [plantedRow(safePreview)] })}\n`)
    let directoryRejected = false
    try { await readVoiceLedger(root) } catch (error) { if (!String(error.message).includes('形状损坏')) throw error; directoryRejected = true }
    if (!directoryRejected) throw new Error('目录型 preview_path 未被拒绝')
    await rm(resolve(root, '.short-drama', 'voice-previews', 'cosyvoice-v2-p7probe.wav'), { recursive: true, force: true })
    await writeFile(resolve(root, safePreview), 'RIFF')
    const safeLedger = await readVoiceLedger(root)
    if (safeLedger.voices[0].preview_path !== safePreview) throw new Error('合法预览行未正常读回')
    await rm(resolve(root, safePreview), { force: true })
    await writeFile(resolve(root, '.short-drama', 'voices.json'), `${JSON.stringify({ version: 1, voices: [] })}\n`)
    await removeVoiceEntry(root, entry.voice_id)
    let missingRejected = false
    try { await addVoiceEntry(root, { voice_id: 'x' }) } catch (error) { if (!String(error.message).includes('缺少字段')) throw error; missingRejected = true }
    if (!missingRejected) throw new Error('缺字段登记未被拒绝')
  } finally { await rm(root, { recursive: true, force: true }) }
}

if (import.meta.url === `file://${process.argv[1]}`) { selfCheck().then(() => console.log('ok')) }
