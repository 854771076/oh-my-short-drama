#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { withFileLock } from './file-lock.mjs'

const LEDGER_RELATIVE = '.short-drama/voices.json'
const REQUIRED_FIELDS = ['voice_id', 'flavor', 'target_model', 'source', 'created_at']

function ledgerPath(root) { return resolve(root, LEDGER_RELATIVE) }
function emptyLedger() { return { version: 1, voices: [] } }
export function safeVoiceFileId(voiceId) { return String(voiceId).replace(/[^A-Za-z0-9._-]/g, '_') }
export function previewRelativePath(voiceId, format) { return `.short-drama/voice-previews/${safeVoiceFileId(voiceId)}.${format || 'wav'}` }

export async function readVoiceLedger(rootArg) {
  const root = await realpath(resolve(rootArg))
  let raw
  try { raw = await readFile(ledgerPath(root), 'utf8') } catch (error) { if (error?.code === 'ENOENT') return emptyLedger(); throw error }
  let data
  try { data = JSON.parse(raw) } catch { throw new Error('voices.json 形状损坏') }
  if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.voices)) throw new Error('voices.json 形状损坏')
  return data
}
async function writeVoiceLedger(root, data) {
  const path = ledgerPath(root)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`)
  await rename(temporary, path)
}
function normalizeEntry(entry) {
  for (const field of REQUIRED_FIELDS) if (!entry?.[field]) throw new Error(`音色登记缺少字段：${field}`)
  if (!['design', 'clone'].includes(entry.source)) throw new Error('音色来源无效')
  return {
    voice_id: String(entry.voice_id),
    flavor: String(entry.flavor),
    target_model: String(entry.target_model),
    prefix: entry.prefix ? String(entry.prefix) : null,
    name: entry.name ? String(entry.name) : null,
    source: entry.source,
    preview_path: entry.preview_path ? String(entry.preview_path) : null,
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
    await writeFile(resolve(root, '.short-drama', 'voices.json'), `${JSON.stringify({ version: 1, voices: [] })}\n`)
    await removeVoiceEntry(root, entry.voice_id)
    let missingRejected = false
    try { await addVoiceEntry(root, { voice_id: 'x' }) } catch (error) { if (!String(error.message).includes('缺少字段')) throw error; missingRejected = true }
    if (!missingRejected) throw new Error('缺字段登记未被拒绝')
  } finally { await rm(root, { recursive: true, force: true }) }
}

if (import.meta.url === `file://${process.argv[1]}`) { selfCheck().then(() => console.log('ok')) }
