#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, realpath, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, resolve, sep } from 'node:path'
import { validateProject } from '../project-store.mjs'
import { bailian, QWEN_TTS_MODEL, validatePreviewText, validateVoicePrefix, validateVoicePrompt, requireValid, assertPublicHttps } from './bailian.mjs'
import { addVoiceEntry, readVoiceLedger, removeVoiceEntry, previewRelativePath } from '../voice-ledger.mjs'
import { publishReferenceMedia } from '../media-hosting/publish.mjs'

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.webm'])
const MAX_REFERENCE_AUDIO_BYTES = 20 * 1024 * 1024

export function validateCloneChoice(args) {
  const hasPath = Boolean(typeof args?.reference_audio_path === 'string' && args.reference_audio_path.trim())
  const hasUrl = Boolean(typeof args?.audio_url === 'string' && args.audio_url.trim())
  if (hasPath === hasUrl) throw new Error('reference_audio_path 与 audio_url 必须二选一')
  return { mode: hasPath ? 'path' : 'url' }
}
async function assertProject(rootArg) {
  const root = await realpath(resolve(rootArg))
  validateProject(JSON.parse(await readFile(resolve(root, '.short-drama', 'project.json'), 'utf8')))
  return root
}
function targetModelOf(flavor, result, requested) {
  if (result.target_model) return result.target_model
  if (flavor === 'qwen') return QWEN_TTS_MODEL
  return requested || 'cosyvoice-v3.5-plus'
}

export async function designVoice(args) {
  const root = await assertProject(args.project_root)
  // MCP stdio 服务端不跑 JSON Schema 校验，付费门必须在代码里强制
  if (args.confirmed !== true) throw new Error('设计音色前必须取得用户确认，并传 confirmed=true')
  const flavor = args.flavor === 'qwen' ? 'qwen' : 'cosyvoice-design'
  requireValid(validateVoicePrompt(args.voice_prompt))
  requireValid(validatePreviewText(args.preview_text))
  requireValid(validateVoicePrefix(args.prefix))
  const result = await bailian.createVoiceDesign({
    flavor,
    voice_prompt: String(args.voice_prompt).trim(),
    preview_text: String(args.preview_text).trim(),
    prefix: args.prefix,
    target_model: args.target_model,
    language_hints: args.language_hints,
    preferred_name: args.preferred_name,
    language: args.language,
    confirmed: true,
  })
  if (!result.voice_id) throw new Error('BAILIAN_VOICE_INVALID_RESULT: 设计成功响应缺少 voice_id')
  let previewPath = null
  let previewWarning = ''
  if (result.preview?.data_base64) {
    const candidate = previewRelativePath(result.voice_id, result.preview.format)
    const target = resolve(root, candidate)
    try {
      // 付费云调用已成功：本地落盘失败不得抛出（否则谎称失败并诱发付费重试），降级为 preview_path=null + warning
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, Buffer.from(result.preview.data_base64, 'base64'))
      previewPath = candidate
    } catch (previewError) {
      previewWarning = `云端音色已创建，但本地试听音频保存失败：${String(previewError.message).slice(0, 200)}；可用 list_voices/delete_voice 收敛`
      await rm(target, { force: true }).catch(() => {})
      await rmdir(target).catch(() => {}) // 目标路径恰好是个空目录（EISDIR）时顺手清理
    }
  }
  const entry = {
    voice_id: result.voice_id,
    flavor,
    target_model: targetModelOf(flavor, result, args.target_model),
    prefix: args.prefix,
    name: args.preferred_name ? String(args.preferred_name) : String(args.prefix),
    source: 'design',
    preview_path: previewPath,
    upload_receipt_id: null,
    request_id: result.request_id || null,
    created_at: new Date().toISOString(),
  }
  // spec §6：云端已成功时本地账本写失败不谎称失败，带 warning 返回 voice_id
  let saved
  try { saved = await addVoiceEntry(root, entry) }
  catch (error) {
    if (previewPath) await rm(resolve(root, previewPath), { force: true }).catch(() => {})
    const ledgerWarning = `云端音色已创建，但本地登记写入失败：${String(error.message).slice(0, 200)}；可用 list_voices/delete_voice 收敛`
    return { ...entry, preview_path: null, warning: previewWarning ? `${previewWarning}；${ledgerWarning}` : ledgerWarning }
  }
  if (previewWarning) return { ...saved, preview_path: null, warning: previewWarning }
  return saved
}

export async function cloneVoice(args) {
  const root = await assertProject(args.project_root)
  if (args.confirmed !== true) throw new Error('克隆音色前必须取得用户确认，并传 confirmed=true')
  if (args.rights_confirmed !== true || args.public_exposure_confirmed !== true || args.usage_terms_confirmed !== true || !['non-commercial', 'commercial-authorized'].includes(args.usage_scope)) throw new Error('必须确认素材权利、公开暴露风险、使用范围及服务条款')
  requireValid(validateVoicePrefix(args.prefix))
  const { mode } = validateCloneChoice(args)
  let url
  let receiptId = null
  if (mode === 'url') {
    url = assertPublicHttps(String(args.audio_url).trim(), 'audio_url')
  } else {
    const assetsRoot = await realpath(resolve(root, 'assets'))
    const path = await realpath(resolve(String(args.reference_audio_path)))
    if (path !== assetsRoot && !path.startsWith(`${assetsRoot}${sep}`)) throw new Error('参考音频只能来自当前项目 assets/ 内文件')
    const extension = extname(path).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(extension)) throw new Error(`参考音频格式不支持：${extension}`)
    const file = await stat(path)
    if (!file.isFile() || file.size === 0) throw new Error('参考音频不是有效文件')
    if (file.size > MAX_REFERENCE_AUDIO_BYTES) throw new Error('参考音频不能超过 20MiB')
    const receipt = await publishReferenceMedia(root, {
      service: 'litterbox',
      local_path: path,
      expires_in: '72h',
      usage_scope: args.usage_scope,
      confirmed: true,
      rights_confirmed: true,
      public_exposure_confirmed: true,
      usage_terms_confirmed: true,
    }, 'audio')
    url = receipt.url
    receiptId = receipt.id
  }
  const result = await bailian.createVoiceClone({
    url,
    prefix: args.prefix,
    target_model: args.target_model,
    language_hints: args.language_hints,
    max_prompt_audio_length: args.max_prompt_audio_length,
    enable_preprocess: args.enable_preprocess,
    confirmed: true,
  })
  if (!result.voice_id) throw new Error('BAILIAN_VOICE_INVALID_RESULT: 克隆成功响应缺少 voice_id')
  const entry = {
    voice_id: result.voice_id,
    flavor: 'cosyvoice-clone',
    target_model: targetModelOf('cosyvoice-clone', result, args.target_model),
    prefix: args.prefix,
    name: String(args.prefix),
    source: 'clone',
    preview_path: null,
    upload_receipt_id: receiptId,
    request_id: result.request_id || null,
    created_at: new Date().toISOString(),
  }
  try { return await addVoiceEntry(root, entry) }
  catch (error) {
    return { ...entry, warning: `云端音色已创建，但本地登记写入失败：${String(error.message).slice(0, 200)}；可用 list_voices/delete_voice 收敛` }
  }
}

export async function listVoices(args) {
  const root = await assertProject(args.project_root)
  const [cloud, ledger] = await Promise.all([bailian.listCloudVoices(), readVoiceLedger(root)])
  const localById = new Map(ledger.voices.map((item) => [item.voice_id, item]))
  const voices = cloud.map((item) => ({ ...item, local: localById.get(item.voice_id) || null }))
  const cloudIds = new Set(cloud.map((item) => item.voice_id))
  return { provider: 'bailian', voices, local_only: ledger.voices.filter((item) => !cloudIds.has(item.voice_id)) }
}

export async function deleteVoice(args) {
  const root = await assertProject(args.project_root)
  if (args.confirmed !== true) throw new Error('删除音色前必须取得用户确认，并传 confirmed=true')
  const result = await bailian.deleteCloudVoice(args.voice_id)
  const removed = await removeVoiceEntry(root, args.voice_id)
  let previewDeleted = false
  if (removed?.preview_path) {
    await rm(resolve(root, removed.preview_path), { force: true })
    previewDeleted = true
  }
  return { voice_id: args.voice_id, flavor: result.flavor, request_id: result.request_id || null, local_removed: Boolean(removed), preview_deleted: previewDeleted }
}

export async function selfCheck() {
  try { validateCloneChoice({}); throw new Error('空克隆参数未被拒绝') } catch (error) { if (!String(error.message).includes('二选一')) throw error }
  try { validateCloneChoice({ reference_audio_path: '/tmp/a.wav', audio_url: 'https://x/a.wav' }); throw new Error('双来源未被拒绝') } catch (error) { if (!String(error.message).includes('二选一')) throw error }
  if (validateCloneChoice({ audio_url: 'https://x/a.wav' }).mode !== 'url' || validateCloneChoice({ reference_audio_path: '/tmp/a.wav' }).mode !== 'path') throw new Error('克隆来源判定错误')
  // 项目外/损坏项目必须在访问 Provider 前被拒绝（标志位，不能吞掉哨兵错误）
  const outside = await realpath(await mkdtemp(resolve(tmpdir(), 'short-drama-voice-tools-')))
  try {
    await mkdir(resolve(outside, '.short-drama'), { recursive: true })
    await writeFile(resolve(outside, '.short-drama', 'project.json'), '{}')
    let rejected = false
    try { await listVoices({ project_root: outside }) } catch (error) { if (!error || typeof error.message !== 'string' || !error.message) throw error; rejected = true }
    if (!rejected) throw new Error('非法项目未被拒绝')
  } finally { await rm(outside, { recursive: true, force: true }) }
}

if (import.meta.url === `file://${process.argv[1]}`) { selfCheck().then(() => console.log('ok')) }
