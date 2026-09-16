#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { adapter, applyConfiguredModelParameters, providerCatalog, providerNames, providerSupports, selfCheck as checkProviders } from './providers.mjs'
import { selfCheck as checkStarRouter } from './starrouter.mjs'
import { selfCheck as checkRunningHub } from './runninghub.mjs'
import { selfCheck as checkComfly } from './comfly.mjs'
import { selfCheck as checkBailian } from './bailian.mjs'
import { selfCheck as checkMuseTalk } from './musetalk.mjs'
import { designVoice, cloneVoice, deleteVoice, importExternalAudio, listVoices } from './voice-tools.mjs'
import { createRequestSnapshot, getDubbingAttemptContext, getTask, listTasks, recordDubbingAttemptOutcome, reserveTask, settleReservedTask } from '../task-ledger.mjs'
import { validateGenerationDocumentReference } from '../document-reference.mjs'
import { mediaHostCatalog, mediaHostNames, mediaHostExpiries } from '../media-hosting/providers.mjs'
import { listReferenceUploads, publishReferenceImage } from '../media-hosting/publish.mjs'
import { selfCheck as checkLitterbox } from '../media-hosting/litterbox.mjs'
import { selfCheck as checkTempfile } from '../media-hosting/tempfile.mjs'
import { selfCheck as checkTmpfiles } from '../media-hosting/tmpfiles.mjs'
import { selfCheck as checkUguu } from '../media-hosting/uguu.mjs'
import { validatePreviousTailBinding, validateVideoReferenceBindings } from '../reference-bindings.mjs'
import { preparePreviousTail } from '../previous-tail.mjs'
import { inspectStage, missingPrevizAssets, missingPrevizReviews, missingStoryboardAssets, missingStoryboardReviews, storyboardMedium } from '../workflow-gates.mjs'
import { validateMotionReferenceBinding } from '../previz-contract.mjs'
import { stages } from '../workflow-stages.mjs'
import { validateProject, validateVideoPrompts } from '../project-store.mjs'
import { syncTaskResult } from '../task-sync.mjs'
import { detectMedia, hasPanelBoardClaim } from '../grid-detect.mjs'
import { importAssetFile, selectedAssetVersion, verifiedAssetVersion } from '../asset-ledger.mjs'
import { operationCapability, validateMediaOperation } from '../media-operation-contract.mjs'
import { executeLocalMediaOperation } from '../media-operations.mjs'
import { putMediaOperationReview } from '../review-ledger.mjs'
import { validateNativeAudioReview } from '../native-audio-audit.mjs'
import { planAudioFallback } from '../audio-fallback.mjs'
import { resolveGeneratedDubbingContract } from '../dubbing-contract-resolution.mjs'
import { probeMedia } from '../media-tools.mjs'
import { compileMusicSearch, listMusicCatalogs, searchMusicCatalog } from '../music-catalog/providers.mjs'
import { putMusicLicense } from '../music-license-ledger.mjs'
import { compileDubbingRequest } from '../dubbing-compiler.mjs'
import { finalSpeechAlignment, putFinalSpeechAlignment, putSpeechTimingCandidate, reviewSpeechTiming, selectedSourceSpeechTiming } from '../speech-timing.mjs'
import { evaluateDubbingFit } from '../dubbing-fit.mjs'
import { putDubbingPerformanceReview } from '../dubbing-performance-review.mjs'
import { buildSubtitlesFromAudio } from '../subtitles-from-audio.mjs'

const SEEDVR25_MODEL = 'seedvr2.5-video-upscale'
const SEEDVR25_WORKFLOW_ID = '2099866760106491906'
const SEEDVR25_MAPPING = JSON.parse(await readFile(new URL('./seedvr2.5-video-upscale.mapping.json', import.meta.url), 'utf8'))
const TRUSTED_AUDIO_FALLBACK = Symbol('trusted-audio-fallback')

checkStarRouter()
await checkRunningHub()
checkComfly()
checkBailian().catch((error) => { console.error(error.message); process.exitCode = 1 })
await checkMuseTalk()
checkLitterbox()
checkTempfile(); checkTmpfiles(); checkUguu()
checkProviders()

const provider = { type: 'string', enum: providerNames }
const mediaType = { type: 'string', enum: ['image', 'video', 'audio'] }
const imageResolution = { type: 'string', enum: ['1K', '2K', '4K'] }
const imageAspectRatio = { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'] }
const audioMetadata = {
  type: 'object',
  properties: {
    voice_setting: { type: 'object' }, audio_setting: { type: 'object' }, pronunciation_dict: { type: 'object' }, timbre_weights: { type: 'array', items: { type: 'object' } },
    language_boost: { type: 'string', minLength: 1 },
    voice_modify: { type: 'object' }, subtitle_enable: { type: 'boolean' }, aigc_watermark: { type: 'boolean' }, output_format: { type: 'string', enum: ['hex', 'url'] }, stream: { const: false }, stream_options: { type: 'object' },
  },
  additionalProperties: true,
}
const workflow = {
  workflow_id: { type: 'string' },
  node_info_list: { type: 'array', items: { type: 'object' } },
  reference_paths: { type: 'array', items: { type: 'string' } },
  reference_image_paths: { type: 'array', maxItems: 9, items: { type: 'string' } },
  reference_video_paths: { type: 'array', maxItems: 2, items: { type: 'string' } },
  reference_audio_paths: { type: 'array', maxItems: 2, items: { type: 'string' } },
}
const imageWorkflow = {
  workflow_id: workflow.workflow_id,
  node_info_list: workflow.node_info_list,
  reference_paths: workflow.reference_paths,
}
const referenceManifestItem = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['image', 'video', 'audio'] },
    order: { type: 'integer', minimum: 1 },
    asset_key: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
    version_id: { type: 'string', pattern: '^v\\d{3}$' },
    role: { type: 'string', minLength: 1 },
    purpose: { type: 'string' },
    duration_seconds: { type: 'number', exclusiveMinimum: 0 },
    real_person_face: { type: 'boolean' },
    identity_binding: {
      type: 'object',
      properties: { profile_name: { type: 'string', minLength: 1 }, profile_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, appearance_id: { type: 'integer', minimum: 1 } },
      required: ['profile_name', 'profile_sha256', 'appearance_id'], additionalProperties: false,
    },
    identity_constraints: {
      type: 'object',
      properties: { age_class: { type: 'string', enum: ['adult', 'child', 'not-applicable'] }, grooming_and_makeup: { type: 'string' }, costume_signature: { type: 'string' }, memory_anchors: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1 } } },
      required: ['age_class', 'grooming_and_makeup', 'costume_signature', 'memory_anchors'], additionalProperties: false,
    },
  },
  required: ['type', 'order', 'asset_key', 'version_id', 'role'],
  additionalProperties: false,
}
const assetVersionReference = {
  type: 'object',
  properties: { asset_key: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }, version_id: { type: 'string', pattern: '^v\\d{3}$' } },
  required: ['asset_key', 'version_id'], additionalProperties: false,
}
const mediaOperationProperties = {
  project_root: { type: 'string' }, target: { type: 'string', pattern: '^shot-[a-z0-9]+(?:-[a-z0-9]+)*$' },
  operation: { type: 'string', enum: ['trim', 'replace-audio', 'stabilize', 'denoise', 'color-match', 'mask-blur', 'frame-interpolate', 'lip-sync', 'video-inpaint', 'video-upscale'] },
  provider: { type: 'string', enum: ['local', ...providerNames] }, model: { type: 'string' }, workflow_id: { type: 'string' },
  source: assetVersionReference, audio: assetVersionReference, mask: assetVersionReference,
  range: { type: 'object', properties: { start_ms: { type: 'integer', minimum: 0 }, end_ms: { type: 'integer', minimum: 1 } }, required: ['start_ms', 'end_ms'], additionalProperties: false },
  parameters: { type: 'object', description: 'lip-sync 时必须包含 audio_plan 与 face_selector={mode:"single-visible-face",character_key?}。' }, node_info_list: { type: 'array', items: { type: 'object' } }, confirmed: { type: 'boolean' },
}
const projectTracking = {
  project_root: { type: 'string', description: '短剧项目绝对路径；生成请求和任务会自动保存在项目内。' },
  target: { type: 'string', description: '本次生成对应的本地资产 key。' },
  prompt_document: { type: ['object', 'null'], description: '制作文档版本引用：视频镜号、audio-plan 行、storyboard 镜号或 asset-plan 资产；仅 other 辅助资产可为 null。' },
}
const batchImageProperties = {
  provider, model: { type: 'string' }, prompt: { type: 'string' }, size: { type: 'string' }, resolution: imageResolution, aspect_ratio: imageAspectRatio,
  seed: { type: 'integer', minimum: 1 }, n: { type: 'integer', minimum: 1, maximum: 4 }, quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'] },
  style: { type: 'string' }, background: { type: 'string', enum: ['auto', 'opaque', 'transparent'] }, moderation: { type: 'string', enum: ['auto', 'low'] },
  output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'] }, output_compression: { type: 'integer', minimum: 1 }, partial_images: { type: 'integer', minimum: 1 },
  user: { type: 'string' }, reference_manifest: { type: 'array', maxItems: 9, items: referenceManifestItem }, ...imageWorkflow,
  target: projectTracking.target, prompt_document: projectTracking.prompt_document,
}
const asrInput = {
  provider: { const: 'starrouter' }, model: { type: 'string' }, file_path: { type: 'string' }, response_format: { type: 'string', enum: ['json', 'text', 'srt', 'verbose_json', 'vtt'] }, language: { type: 'string' }, prompt: { type: 'string' }, temperature: { type: 'number', minimum: 0, maximum: 1 }, project_root: { type: 'string' }, confirmed: { const: true },
}
const bailianProvider = { type: 'string', enum: ['bailian'] }
const cosyVoiceTargetModel = { type: 'string', enum: ['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3-plus', 'cosyvoice-v3-flash', 'cosyvoice-v2'] }
const voicePrefix = { type: 'string', pattern: '^[A-Za-z0-9]{1,10}$' }
const voiceConfirmation = {
  confirmed: { const: true },
  rights_confirmed: { const: true },
  public_exposure_confirmed: { const: true },
  usage_terms_confirmed: { const: true },
}
export const tools = [
  ['list_generation_providers', '列出已注册生成 Provider 与模态能力。', {}, []],
  ['analyze_speech_timing', '把显式提供的 ASR/强制对齐结果绑定到当前 selected 来源资产并保存为未复核候选；不会调用 Provider 或创建付费任务。', {
    project_root: { type: 'string' }, source: assetVersionReference, timing: { type: 'object' },
  }, ['project_root', 'source', 'timing']],
  ['review_speech_timing', '人工复核语音时间证据并创建新的不可变 selected 版本。', {
    project_root: { type: 'string' }, episode_key: { type: 'string', pattern: '^ep-\\d{3}$' }, candidate_version: { type: 'string', pattern: '^v\\d{3}$' }, reviewed_by: { type: 'string' }, document: { type: 'object' },
  }, ['project_root', 'episode_key', 'candidate_version', 'reviewed_by', 'document']],
  ['review_dubbing_alignment', '为未选中的配音候选写入最终词级对齐，根据一帧误差机器判定适配结果并登记付费轮次。', {
    project_root: { type: 'string' }, audio: assetVersionReference, attempt: { type: 'integer', minimum: 1, maximum: 3 }, alignment: { type: 'object' }, adaptation_approved: { type: 'boolean' },
  }, ['project_root', 'audio', 'attempt', 'alignment', 'adaptation_approved']],
  ['compile_dubbing_request', '只读编译当前逐句情感配音合同，不提交付费任务。', {
    project_root: { type: 'string' }, episode_key: { type: 'string', pattern: '^ep-\\d{3}$' }, audio_plan_version: { type: 'string', pattern: '^v\\d{3}$' }, line_index: { type: 'integer', minimum: 1 }, provider, model: { type: 'string' }, voice: { type: 'string' }, attempt: { type: 'integer', minimum: 1, maximum: 3 }, measured_speech_ms: { type: 'integer', minimum: 1 }, runninghub_mapping: { type: 'object' },
  }, ['project_root', 'episode_key', 'audio_plan_version', 'line_index', 'provider', 'model', 'voice', 'attempt']],
  ['review_dubbing_performance', '保存八维情感配音审核；仅通过候选会原子选版并失效旧音频派生资产。', {
    project_root: { type: 'string' }, review: { type: 'object' },
  }, ['project_root', 'review']],
  ['build_subtitles_from_audio', '从项目内当前 selected 配音、八维审核和最终词级时间构建强绑定字幕。', {
    project_root: { type: 'string' }, episode_key: { type: 'string', pattern: '^ep-\\d{3}$' }, line_index: { type: 'integer', minimum: 1 }, fps: { type: 'number', exclusiveMinimum: 0 }, timeline_end_ms: { type: 'integer', minimum: 1 },
  }, ['project_root', 'episode_key', 'line_index', 'fps', 'timeline_end_ms']],
  ['list_music_catalogs', '列出本地授权音乐与官方音乐目录入口；不登录、不抓取或下载站点内容。', {}, []],
  ['search_music_catalog', '把剧情功能编译为选曲条件，并返回本地已授权结果或官方搜索页。', {
    catalog: { type: 'string', enum: ['local-licensed', 'pixabay', 'youtube-audio-library', 'uppbeat'] }, project_root: { type: 'string' }, query: { type: 'string' }, purpose: { type: 'string', enum: ['op', 'ed', 'bgm', 'music-video'] }, dramatic_function: { type: 'string' }, pace: { type: 'string' }, dialogue_density: { type: 'string', enum: ['low', 'medium', 'high'] }, duration_seconds: { type: ['number', 'null'] },
  }, ['catalog']],
  ['register_licensed_music', '把用户已下载且获授权的音乐文件及许可证凭证登记为未选中的本地音频候选。', {
    project_root: { type: 'string' }, target: { type: 'string', pattern: '^audio-[a-z0-9]+(?:-[a-z0-9]+)*$' }, name: { type: 'string' }, local_file: { type: 'string' }, receipt: { type: 'object' }, usage_scope: { type: 'string', enum: ['non-commercial', 'commercial-authorized'] }, rights_confirmed: { const: true }, confirmed: { const: true },
  }, ['project_root', 'target', 'local_file', 'receipt', 'usage_scope', 'rights_confirmed', 'confirmed']],
  ['list_media_hosts', '列出把本地参考素材临时转换为公网 URL 的托管服务与时效。', {}, []],
  ['list_reference_uploads', '列出项目内临时发布收据及当前有效状态。', {
    project_root: { type: 'string' }, service: { type: 'string', enum: mediaHostNames }, asset_key: { type: 'string' }, version_id: { type: 'string', pattern: '^v\\d{3}$' }, state: { type: 'string', enum: ['active', 'expired'] },
  }, ['project_root']],
  ['publish_reference_image', '把项目内 selected 图片临时发布为公开 HTTPS URL；上传前必须确认权利、公开风险和商业使用许可。', {
    service: { type: 'string', enum: mediaHostNames, default: 'tempfile' }, project_root: { type: 'string' }, asset_key: { type: 'string' }, version_id: { type: 'string', pattern: '^v\\d{3}$' }, expires_in: { type: 'string', enum: mediaHostExpiries, default: '24h' }, usage_scope: { type: 'string', enum: ['non-commercial', 'commercial-authorized'] }, force_reupload: { type: 'boolean' }, confirmed: { const: true }, rights_confirmed: { const: true }, public_exposure_confirmed: { const: true }, usage_terms_confirmed: { const: true },
  }, ['service', 'project_root', 'asset_key', 'version_id', 'expires_in', 'usage_scope', 'confirmed', 'rights_confirmed', 'public_exposure_confirmed', 'usage_terms_confirmed']],
  ['prepare_previous_tail', '从上一镜当前选中且通过审核的视频提取尾帧，并登记为下一镜首帧资产。', {
    project_root: { type: 'string' }, episode_key: { type: 'string', pattern: '^ep-\\d{3}$' }, shot_number: { type: 'integer', minimum: 2 }, continuity_version: { type: 'string', pattern: '^v\\d{3}$' },
  }, ['project_root', 'episode_key', 'shot_number', 'continuity_version']],
  ['submit_media_operation', '校验并执行本地媒体修复，或在确认后提交具备细粒度能力的远端变换任务。RunningHub SeedVR2.5 使用固定真实节点映射；confirmed=false 只返回上传、工作流与节点摘要。', mediaOperationProperties, ['project_root', 'target', 'operation', 'provider', 'source', 'parameters', 'confirmed']],
  ['get_media_operation', '查询远端媒体变换任务；完成时按请求快照自动登记不可变候选版本。', {
    project_root: { type: 'string' }, task_id: { type: 'string', minLength: 1 },
  }, ['project_root', 'task_id']],
  ['register_media_operation_output', '为已完成但尚未下载的媒体变换任务登记 Provider 输出；会复核任务、请求和来源身份。', {
    project_root: { type: 'string' }, task_id: { type: 'string', minLength: 1 }, outputs: { type: 'array', minItems: 1, items: { type: 'object', properties: { url: { type: 'string' }, b64_json: { type: 'string' }, media_type: { const: 'video' } }, additionalProperties: false } },
  }, ['project_root', 'task_id', 'outputs']],
  ['review_media_operation', '保存媒体操作专项审核；仅在 QC、完整观看和该操作所需观察全部通过后选择候选版本。', {
    project_root: { type: 'string' }, asset_key: { type: 'string', pattern: '^shot-[a-z0-9]+(?:-[a-z0-9]+)*$' }, version_id: { type: 'string', pattern: '^v\\d{3}$' },
    operation: mediaOperationProperties.operation, approved: { type: 'boolean' }, watched_full: { type: 'boolean' }, observations: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['P0', 'P1', 'P2'] }, message: { type: 'string', minLength: 1 } }, required: ['severity', 'message'], additionalProperties: false } },
    qc: { type: 'object' },
  }, ['project_root', 'asset_key', 'version_id', 'operation', 'approved', 'observations', 'issues']],
  ['list_models', '读取指定 Provider 的模型或工作流目录。', { provider }, ['provider']],
  ['generate_image', '使用用户选择的 Provider 生成图片；付费和上传本地参考文件前必须确认。', {
    provider, model: { type: 'string' }, prompt: { type: 'string' }, size: { type: 'string' }, resolution: imageResolution, aspect_ratio: imageAspectRatio, seed: { type: 'integer', minimum: 1 }, n: { type: 'integer', minimum: 1, maximum: 4 }, quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'] }, style: { type: 'string' }, background: { type: 'string', enum: ['auto', 'opaque', 'transparent'] }, moderation: { type: 'string', enum: ['auto', 'low'] }, output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'] }, output_compression: { type: 'integer', minimum: 1 }, partial_images: { type: 'integer', minimum: 1 }, user: { type: 'string' }, reference_manifest: { type: 'array', maxItems: 9, items: referenceManifestItem }, confirmed: { const: true }, ...imageWorkflow, ...projectTracking,
  }, ['provider', 'prompt', 'reference_manifest', 'confirmed', 'project_root', 'target', 'prompt_document']],
  ['submit_episode_images', '批量提交整集图片生成：先以 confirmed=false 返回逐项摘要；confirmed=true 后以最多 4 路并发执行，RunningHub 同一 API Key 由适配器限制为 2 路；单项失败不阻塞其他图片。每个 items 项目字段与 generate_image 相同。', {
    project_root: { type: 'string' }, items: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', properties: batchImageProperties, required: ['provider', 'prompt', 'reference_manifest', 'target', 'prompt_document'], additionalProperties: false } }, confirmed: { type: 'boolean' },
  }, ['project_root', 'items', 'confirmed']],
  ['generate_audio', '使用用户选择的 Provider 生成语音或提交音频工作流。已批准的 generated 配音合同会从当前 audio-plan 派生版本、音色授权和编译参数；StarRouter 使用 model/input/voice，RunningHub 使用 prompt/workflow，百炼使用 CosyVoice/qwen TTS 与已登记音色。', {
    provider, model: { type: 'string' }, input: { type: 'string' }, voice: { type: 'string' }, instructions: { type: 'string' }, speed: { type: 'number', minimum: 0.5, maximum: 2 }, response_format: { type: 'string', enum: ['mp3', 'pcm', 'flac', 'wav', 'opus'] }, language_hints: { type: 'string' }, sample_rate: { type: 'integer' }, volume: { type: 'number', minimum: 0, maximum: 100 }, pitch: { type: 'number', minimum: 0.5, maximum: 2 }, instruction: { type: 'string', maxLength: 100 }, metadata: audioMetadata, prompt: { type: 'string' }, dubbing_attempt: { type: 'integer', minimum: 1, maximum: 3 }, measured_speech_ms: { type: 'integer', minimum: 1 }, runninghub_mapping: { type: 'object' }, confirmed: { const: true }, ...workflow, ...projectTracking,
  }, ['provider', 'confirmed', 'project_root', 'target', 'prompt_document']],
  ['import_external_audio', '把用户有权使用的本地音频复制或规范化为不可变候选资产；不自动选版。', {
    project_root: { type: 'string' }, target: { type: 'string', pattern: '^audio-[a-z0-9]+(?:-[a-z0-9]+)*$' }, local_file: { type: 'string' }, name: { type: 'string' }, usage_scope: { type: 'string', enum: ['non-commercial', 'commercial-authorized'] }, rights_confirmed: { const: true }, confirmed: { const: true },
  }, ['project_root', 'target', 'local_file', 'usage_scope', 'rights_confirmed', 'confirmed']],
  ['generate_audio_fallback', '依据未通过的原生音频七维审核只生成失败区间；confirmed=false 仅返回费用与 provenance 摘要。', {
    project_root: { type: 'string' }, episode_key: { type: 'string', pattern: '^ep-\\d{3}$' }, audio_plan_version: { type: 'string', pattern: '^v\\d{3}$' }, line_index: { type: 'integer', minimum: 1 }, source_video: assetVersionReference,
    target: { type: 'string', pattern: '^audio-[a-z0-9]+(?:-[a-z0-9]+)*$' }, provider, model: { type: 'string' }, voice: { type: 'string' }, voice_binding: { type: 'object' }, reason: { type: 'string' }, range: mediaOperationProperties.range, mix_sources: { type: 'array', minItems: 1, items: { type: 'string' } }, response_format: { type: 'string' }, dubbing_attempt: { type: 'integer', minimum: 1, maximum: 3 }, measured_speech_ms: { type: 'integer', minimum: 1 }, confirmed: { type: 'boolean' }, presentation: { type: 'string' },
  }, ['project_root', 'episode_key', 'audio_plan_version', 'line_index', 'source_video', 'target', 'provider', 'model', 'voice', 'voice_binding', 'reason', 'range', 'mix_sources', 'confirmed']],
  ['transcribe_audio', '使用 StarRouter 对项目内音频执行语音转写。', asrInput, ['provider', 'model', 'file_path', 'project_root', 'confirmed']],
  ['translate_audio', '使用 StarRouter 对项目内音频执行语音翻译。', asrInput, ['provider', 'model', 'file_path', 'project_root', 'confirmed']],
  ['generate_music', '使用 StarRouter 异步生成 OP、ED、BGM 或音乐短视频配乐。', {
    provider, model: { type: 'string' }, prompt: { type: 'string' }, title: { type: 'string' }, tags: { type: 'string' }, lyrics: { type: 'string' }, make_instrumental: { type: 'boolean' }, confirmed: { const: true }, ...projectTracking,
  }, ['provider', 'model', 'prompt', 'confirmed', 'project_root', 'target', 'prompt_document']],
  ['design_voice', '在百炼账号下用文本描述设计自定义音色（默认 cosyvoice-design；qwen 为旧版）。付费操作；成功后音色登记到项目并可在 generate_audio 中作为 voice 使用。', {
    provider: bailianProvider, project_root: { type: 'string' }, flavor: { type: 'string', enum: ['cosyvoice-design', 'qwen'] },
    voice_prompt: { type: 'string', minLength: 1, maxLength: 500 }, preview_text: { type: 'string', minLength: 5, maxLength: 200 }, prefix: voicePrefix,
    target_model: cosyVoiceTargetModel, language_hints: { type: 'string' }, preferred_name: { type: 'string' }, language: { type: 'string', enum: ['zh', 'en'] },
    confirmed: { const: true },
  }, ['provider', 'project_root', 'flavor', 'voice_prompt', 'preview_text', 'prefix', 'confirmed']],
  ['clone_voice', '用一段参考音频在百炼账号下克隆音色（cosyvoice-clone）。本地音频由服务端临时公网发布（litterbox 72h），必须确认权利、公开风险与使用范围；audio_url 与 reference_audio_path 二选一。', {
    provider: bailianProvider, project_root: { type: 'string' }, prefix: voicePrefix,
    reference_audio_path: { type: 'string' }, audio_url: { type: 'string' },
    target_model: cosyVoiceTargetModel, language_hints: { type: 'string' },
    max_prompt_audio_length: { type: 'integer', minimum: 3, maximum: 30 }, enable_preprocess: { type: 'boolean' },
    usage_scope: { type: 'string', enum: ['non-commercial', 'commercial-authorized'] },
    ...voiceConfirmation,
  }, ['provider', 'project_root', 'prefix', 'confirmed', 'rights_confirmed', 'public_exposure_confirmed', 'usage_terms_confirmed', 'usage_scope']],
  ['list_voices', '列出百炼账号下已有自定义音色（CosyVoice 与 qwen 两路合并），并叠加项目本地音色登记标记。只读。', {
    provider: bailianProvider, project_root: { type: 'string' },
  }, ['provider', 'project_root']],
  ['delete_voice', '删除百炼账号下的自定义音色（按 voice_id 前缀自动分流接口），同时清理项目本地登记与预览文件。付费/破坏性操作。', {
    provider: bailianProvider, project_root: { type: 'string' }, voice_id: { type: 'string', minLength: 1 }, confirmed: { const: true },
  }, ['provider', 'project_root', 'voice_id', 'confirmed']],
  ['submit_video', '使用用户选择的 Provider 提交异步视频任务。', {
    provider, model: { type: 'string' }, prompt_profile: { type: 'string', enum: ['seedance2', 'h3', 'generic'] }, input_mode: { type: 'string', enum: ['first-last-frame', 'full-reference', 'T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA', 'generic'] }, prompt_version: { type: 'string' }, prompt: { type: 'string' }, frame_url: { type: 'string' }, images: { type: 'array', maxItems: 9, items: { type: 'string' } }, input_reference: { type: 'string' }, reference_urls: { type: 'array', items: { type: 'string' } }, reference_image_urls: { type: 'array', maxItems: 9, items: { type: 'string' } }, reference_video_urls: { type: 'array', maxItems: 3, items: { type: 'string' } }, reference_audio_urls: { type: 'array', maxItems: 3, items: { type: 'string' } }, reference_manifest: { type: 'array', maxItems: 12, items: referenceManifestItem }, reference_only: { type: 'boolean' }, duration: { type: 'integer', minimum: 1, maximum: 15 }, size: { type: 'string', enum: ['480P', '768P', '2K'] }, resolution: { type: 'string', enum: ['480p', '720p', '1080p', '480P', '768P', '1K', '2K'] }, ratio: { type: 'string', enum: ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'] }, generate_audio: { type: 'boolean' }, watermark: { type: 'boolean' }, seed: { type: 'integer', minimum: 1 }, fps: { type: 'integer', minimum: 1 }, n: { type: 'integer', minimum: 1 }, response_format: { type: 'string' }, user: { type: 'string' }, metadata: { type: 'object' }, extra_options: { type: 'object' }, confirmed: { const: true }, ...workflow, ...projectTracking,
  }, ['provider', 'prompt_profile', 'input_mode', 'prompt_version', 'prompt', 'confirmed', 'project_root', 'target', 'prompt_document']],
  ['get_generation_task', '查询指定 Provider 的异步任务；完成时自动下载为本地候选版本并回写任务账本。', { provider, task_id: { type: 'string' }, media_type: mediaType, project_root: { type: 'string' } }, ['provider', 'task_id', 'media_type', 'project_root']],
  ['ensure_reference_urls', '整集一次确认：把当前 selected 视频提示词中、需要公网 URL 的图片参考批量临时发布（有效收据自动复用，不重复上传）；RunningHub 走本地路径不需要发布。', {
    project_root: { type: 'string' }, episode_key: { type: 'string', pattern: '^ep-\\d{3}$' },
    service: { type: 'string', enum: mediaHostNames, default: 'tempfile' }, expires_in: { type: 'string', enum: mediaHostExpiries, default: '24h' }, usage_scope: { type: 'string', enum: ['non-commercial', 'commercial-authorized'] }, force_reupload: { type: 'boolean' },
    confirmed: { const: true }, rights_confirmed: { const: true }, public_exposure_confirmed: { const: true }, usage_terms_confirmed: { const: true },
  }, ['project_root', 'episode_key', 'service', 'expires_in', 'usage_scope', 'confirmed', 'rights_confirmed', 'public_exposure_confirmed', 'usage_terms_confirmed']],
  ['submit_episode_videos', '整集批量提交视频：先以 confirmed=false 取得逐镜费用摘要与校验结果；用户确认后 confirmed=true 一次性提交整集，RunningHub 同一 API Key 最多 2 路并发，单镜失败不阻塞其他镜头。', {
    project_root: { type: 'string' }, episode_key: { type: 'string', pattern: '^ep-\\d{3}$' }, shot_numbers: { type: 'array', items: { type: 'integer', minimum: 1 } }, confirmed: { type: 'boolean', description: 'false 仅返回费用摘要不提交；true 在用户看过摘要并确认费用后并发提交。' },
  }, ['project_root', 'episode_key', 'confirmed']],
  ['await_episode_tasks', '在 MCP 超时预算内并发轮询整集在途视频任务；pending 会刷新本地状态与时间，完成即自动下载登记并回写（含宫格检测标记），失败不自动重试；超时返回仍在途清单，全托管模式应立即续调。', {
    project_root: { type: 'string' }, episode_key: { type: 'string', pattern: '^ep-\\d{3}$' }, timeout_seconds: { type: 'integer', minimum: 10, maximum: 540 }, poll_interval_seconds: { type: 'integer', minimum: 3, maximum: 30 },
  }, ['project_root', 'episode_key']],
].map(([name, description, properties, required]) => ({
  name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
}))

async function enforceGenerationStage(projectRoot, name, target) {
  const root = await realpath(resolve(projectRoot))
  const state = JSON.parse(await readFile(resolve(root, '.short-drama/state.json'), 'utf8'))
  const allowed = name === 'generate_image'
    ? target?.startsWith('board-') ? ['media-production'] : target?.startsWith('other-') ? ['asset-generation', 'media-production'] : ['asset-generation']
    : ['media-production']
  if (!allowed.includes(state.stage)) throw new Error(`${name} 只能在 ${allowed.join(' 或 ')} 阶段执行；当前阶段为 ${state.stage}`)
  for (const stage of stages.slice(0, stages.indexOf(state.stage))) {
    if (!state.completed?.includes(stage)) throw new Error(`生成门禁未通过：上游阶段 ${stage} 未完成`)
    const gate = await inspectStage(root, stage)
    if (!gate.ready) throw new Error(`生成门禁未通过：${stage}：${gate.missing.join('；')}`)
  }
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`) }
function ok(id, result) { send({ jsonrpc: '2.0', id, result }) }
function fail(id, error) { send({ jsonrpc: '2.0', id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }) }

async function validateProjectInputs(projectRoot, type, target, promptDocument, providerName, args, configuredType = type) {
  const root = await realpath(resolve(projectRoot))
  const assetRoot = await realpath(resolve(root, 'assets'))
  const prefixes = { image: ['char-', 'scene-', 'prop-', 'board-', 'other-'], video: ['shot-'], audio: ['audio-'] }
  if (!prefixes[type].some((prefix) => target?.startsWith(prefix))) throw new Error(`${type} target 资产 key 无效`)
  for (const field of ['reference_paths', 'reference_image_paths', 'reference_video_paths', 'reference_audio_paths']) {
    for (const value of args[field] || []) {
      const path = await realpath(resolve(value))
      if (path !== assetRoot && !path.startsWith(`${assetRoot}${sep}`)) throw new Error(`${field} 只能上传当前项目 assets/ 内文件`)
    }
  }
  const project = validateProject(JSON.parse(await readFile(resolve(root, '.short-drama/project.json'), 'utf8')))
  const configured = project.providers?.[configuredType]
  const requestedModel = args.model || args.workflow_id
  if (!configured?.provider || configured.provider !== providerName) throw new Error(`${configuredType} Provider 必须与 project.json 已确认配置一致`)
  if (!requestedModel) throw new Error(`${configuredType} 模型或工作流必须显式解析并写入请求`)
  if (configured.model_or_workflow && configured.model_or_workflow !== requestedModel) throw new Error(`${configuredType} 模型或工作流必须与 project.json 已确认配置一致`)
  applyConfiguredModelParameters(providerName, requestedModel, configured.parameters || {}, args)
  if (type === 'image') {
    if ([...(args.reference_image_paths || []), ...(args.reference_video_paths || []), ...(args.reference_audio_paths || [])].length) throw new Error('图片生成本地参考只使用 reference_paths')
    const paths = args.reference_paths || []
    const manifest = args.reference_manifest
    if (!Array.isArray(manifest) || manifest.length !== paths.length) throw new Error('图片 reference_manifest 必须与 reference_paths 等长')
    const assets = manifest.length ? JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8')) : { assets: {} }
    for (const [index, item] of manifest.entries()) {
      if (item?.type !== 'image' || item.order !== index + 1 || typeof item.role !== 'string' || !item.role.trim()) throw new Error(`图片 reference_manifest 第 ${index + 1} 项无效`)
      const asset = assets.assets?.[item.asset_key]
      const version = asset?.versions?.find((entry) => entry.id === item.version_id)
      if (!version || asset.selectedVersionId !== item.version_id || asset.staleVersionIds?.includes(item.version_id)) throw new Error(`图片参考不是 selected 未失效版本：${item.asset_key}@${item.version_id}`)
      if (await realpath(resolve(root, version.localPath)) !== await realpath(resolve(paths[index]))) throw new Error(`图片参考路径与清单版本不一致：${item.asset_key}@${item.version_id}`)
    }
  }
  if (type !== 'video') return validateGenerationDocumentReference(root, type, target, promptDocument, args, providerName, requestedModel)
  if (!promptDocument || !/^ep-\d{3}$/.test(promptDocument.episode_key) || !/^v\d{3}$/.test(promptDocument.version_id) || !Number.isInteger(promptDocument.shot_number) || promptDocument.shot_number <= 0) throw new Error('视频生成必须引用有效的 episode/version/shot 提示词文档')
  const expectedTarget = `shot-${promptDocument.episode_key.replace('-', '')}-${String(promptDocument.shot_number).padStart(3, '0')}`
  if (target !== expectedTarget) throw new Error(`视频 target 必须为 ${expectedTarget}`)
  if (args.prompt_version !== promptDocument.version_id) throw new Error('prompt_version 必须与提示词文档版本一致')
  const selectedPath = resolve(root, 'episodes', promptDocument.episode_key, 'video-prompts', 'selected.json')
  const selected = JSON.parse(await readFile(selectedPath, 'utf8'))
  if (selected.versionId !== promptDocument.version_id) throw new Error('视频生成必须引用当前 selected 提示词版本')
  const documentPath = resolve(root, 'episodes', promptDocument.episode_key, 'video-prompts', `${promptDocument.version_id}.json`)
  if (resolve(root, selected.path) !== documentPath) throw new Error('selected 视频提示词路径无效')
  const document = JSON.parse(await readFile(documentPath, 'utf8'))
  validateVideoPrompts(document, promptDocument.episode_key)
  const shot = document.approved === true && !document.unresolved?.length && document.shots?.find((item) => item.shot_number === promptDocument.shot_number)
  if (!shot || shot.errors?.length) throw new Error('视频提示词镜头不存在、未批准或仍有错误')
  const planSelection = JSON.parse(await readFile(resolve(root, 'episodes', promptDocument.episode_key, 'production-plan', 'selected.json'), 'utf8'))
  const storyboardSelection = JSON.parse(await readFile(resolve(root, 'episodes', promptDocument.episode_key, 'storyboard', 'selected.json'), 'utf8'))
  const plan = JSON.parse(await readFile(resolve(root, planSelection.path), 'utf8'))
  const planShot = plan.shots?.find((item) => item.shot_number === promptDocument.shot_number)
  if (!planShot) throw new Error('制作计划中不存在当前视频镜头')
  const plannedShots = [planShot]
  const assets = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
  validateMotionReferenceBinding(promptDocument.episode_key, planShot, shot, assets)
  const missingBoards = await missingStoryboardAssets(root, promptDocument.episode_key, storyboardSelection.versionId, plannedShots, assets)
  if (missingBoards.length) throw new Error(`视频生成前必须先完成图片分镜镜头的生成与选版：${missingBoards.join('；')}`)
  const reviews = JSON.parse(await readFile(resolve(root, '.short-drama/shot-reviews.json'), 'utf8'))
  const missingBoardReviews = missingStoryboardReviews(promptDocument.episode_key, plannedShots, assets, reviews)
  if (missingBoardReviews.length) throw new Error(`视频生成前必须先通过图片分镜镜头的多维审计：${missingBoardReviews.join('；')}`)
  const missingPreviz = await missingPrevizAssets(root, promptDocument.episode_key, storyboardSelection.versionId, plannedShots, assets, planSelection.versionId)
  if (missingPreviz.length) throw new Error(`视频生成前必须先完成已启用的 Blender 白模分镜：${missingPreviz.join('；')}`)
  const missingPrevizReview = missingPrevizReviews(promptDocument.episode_key, plannedShots, assets, reviews)
  if (missingPrevizReview.length) throw new Error(`视频生成前必须先通过 Blender 白模分镜导演验收：${missingPrevizReview.join('；')}`)
  for (const [field, actual] of Object.entries({ provider: providerName, model_or_workflow: requestedModel, prompt_profile: args.prompt_profile, input_mode: args.input_mode, prompt: args.prompt, duration: args.duration })) {
    if (shot[field] !== actual) throw new Error(`实际视频参数与提示词文档 ${field} 不一致`)
  }
  const nativeAudio = shot.audio_policy?.mode === 'native' || shot.audio_policy?.lines?.some((line) => line.delivery_mode === 'native')
  if (nativeAudio && (!providerSupports(providerName, 'video.native-audio') || args.generate_audio !== true)) throw new Error('原生音频镜头必须使用声明 video.native-audio 能力的 Provider 并显式 generate_audio=true')
  if (!nativeAudio && args.generate_audio === true) throw new Error('非原生音频镜头不得静默开启 generate_audio')
  const manifest = Array.isArray(args.reference_manifest) ? args.reference_manifest : []
  // 多参考 Provider 可把整张分镜板当语义参考；Comfly 单参考模式在下方强制改用可追溯的单格裁图。
  const boardRefs = (planShot?.image_strategy?.panel_grid_size ?? 1) > 1
    ? manifest.filter((item) => item.type === 'image' && item.asset_key?.startsWith('board-'))
    : []
  if (boardRefs.length) {
    const framed = boardRefs.filter((item) => item.role === 'first_frame' || item.role === 'last_frame')
    if (framed.length) throw new Error(`多格分镜板不能作为首帧/尾帧像素输入：${framed.map((item) => `${item.asset_key}@${item.version_id}(${item.role})`).join('、')}；整板改用 full-reference/Ref2VA 的 reference_image 语义参考位，或用 media-tools extract-grid-cell 裁单格`)
    if (!hasPanelBoardClaim(args.prompt)) throw new Error('直接引用多格分镜板时，prompt 必须在固定反宫格声明之外原样包含分镜板时间顺序条款（见 panel_grid/panel_storyboard 视频模板）')
  }
  const expectedReferences = providerName === 'comfly'
    ? comflyStoryboardOnly(shot, promptDocument.episode_key, assets, planShot).references
    : shot.references
  if (manifest.length !== expectedReferences.length) throw new Error('实际参考素材与提示词文档数量不一致（Comfly 已按 Provider 合同仅保留分镜图）')
  for (const [index, reference] of expectedReferences.entries()) {
    const actual = manifest[index]
    for (const field of (providerName === 'comfly' ? ['type', 'asset_key', 'version_id', 'role'] : ['type', 'order', 'asset_key', 'version_id', 'role'])) if (actual?.[field] !== reference[field]) throw new Error(`实际参考素材 ${index + 1} 与提示词文档不一致`)
    const asset = assets.assets?.[reference.asset_key]
    if (asset?.selectedVersionId !== reference.version_id || asset.staleVersionIds?.includes(reference.version_id) || !asset.versions?.some((item) => item.id === reference.version_id)) throw new Error(`参考素材不是当前 selected 未失效版本：${reference.asset_key}@${reference.version_id}`)
  }
  await validatePreviousTailBinding(root, shot, manifest)
  // 宫格输入 → 宫格输出：逐份参考做启发式检测；board-* 多格分镜板是允许直接输入的叙事参考（已过八维审计），
  // other-refpack-* 是按流程登记的身份合板，均豁免；分镜板的宫格风险由分镜板条款+成片侧 grid_suspect 兜底。
  for (const reference of manifest) {
    if (reference.type === 'audio' || reference.asset_key.startsWith('other-refpack-') || reference.asset_key.startsWith('board-')) continue
    const version = assets.assets?.[reference.asset_key]?.versions?.find((item) => item.id === reference.version_id)
    if (!version?.localPath) continue
    const grid = detectMedia(resolve(root, version.localPath))
    // 只硬拦 high：门框/地平线类误报为 medium 时放行，成片侧 A4 检测仍会兜底标记 grid_suspect
    if (grid.detected && grid.confidence === 'high') throw new Error(`参考素材疑似宫格/分屏，已阻止提交：${reference.asset_key}@${reference.version_id} 命中 ${grid.lines.map((line) => `${line.line}(${line.frames}/${grid.total_frames}帧)`).join('、')}；请重新生成单格素材，或按流程裁格/登记 other-refpack-* 合板`)
  }
  await validateVideoReferenceBindings(root, providerName, args, manifest)
}

export function compileGeneratedAudioArguments({ providerArgs, line, audioPlan, audioPlanVersion, previousCompilerSnapshot, previousAttemptOutcome }) {
  if (line?.dubbing_contract?.mode === 'native-preserve') throw new Error('native-preserve 原声保留合同不得调用普通配音生成；只能经已审核的音频兜底流程派生生成合同')
  if (line?.dubbing_contract?.mode !== 'generated') throw new Error('当前 audio-plan 行缺少 generated 配音合同')
  const { dubbing_attempt: attempt = 1, measured_speech_ms: measuredSpeechMs, runninghub_mapping: runninghubMapping, ...adapterArguments } = providerArgs
  const compiled = compileDubbingRequest({
    provider: providerArgs.provider,
    model: providerArgs.model,
    voice: providerArgs.voice,
    contract: line.dubbing_contract,
    attempt,
    measured_speech_ms: measuredSpeechMs,
    runninghub_mapping: runninghubMapping,
    dubbing_contract_version: audioPlanVersion,
    voice_binding: line.voice_binding,
    authorized_voice_bindings: audioPlan.voice_bindings,
    delivery_mode: line.delivery_mode,
    presentation: line.presentation,
    previous_compiler_snapshot: previousCompilerSnapshot,
    previous_attempt_outcome: previousAttemptOutcome,
  })
  if (!compiled.supported || compiled.capability_gaps.length) throw new Error(`配音能力不匹配：${compiled.capability_gaps.join('、')}`)
  return {
    arguments: { ...adapterArguments, ...compiled.arguments },
    compiled: { ...compiled, snapshot: { ...compiled.snapshot, episode_key: line.dubbing_contract.timing_source.episode_key, line_index: line.line_index } },
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const shotTarget = (episodeKey, shotNumber) => `shot-${episodeKey.replace('-', '')}-${String(shotNumber).padStart(3, '0')}`

// 纯映射：把镜头参考清单按 Provider 合同转成提交字段；locate 把参考项解析成公网 URL 或本地路径，返回 null 表示缺失。
export function referenceInputs(providerName, shot, locate) {
  const refs = shot.references || []
  const args = {}
  const missing = []
  const take = (reference) => {
    let value
    try { value = locate(reference) } catch { value = null }
    if (!value) missing.push(`${reference.asset_key}@${reference.version_id}`)
    return value
  }
  const images = refs.filter((reference) => reference.type === 'image')
  const videos = refs.filter((reference) => reference.type === 'video')
  const audios = refs.filter((reference) => reference.type === 'audio')
  if (providerName === 'runninghub') {
    if (shot.model_or_workflow === 'minimax-h3-reference-to-video') {
      if (images.length) args.reference_image_paths = images.map(take).filter(Boolean)
      if (videos.length) args.reference_video_paths = videos.map(take).filter(Boolean)
      if (audios.length) args.reference_audio_paths = audios.map(take).filter(Boolean)
    } else args.reference_paths = refs.map(take).filter(Boolean)
    return { args, missing }
  }
  const imageValues = images.map(take)
  const videoValues = videos.map(take)
  const audioValues = audios.map(take)
  if (providerName === 'starrouter' && shot.prompt_profile === 'h3') {
    const content = [{ type: 'text', text: shot.prompt }]
    const keyframeRoles = { I2VA: ['first_frame'], L2VA: ['last_frame'], FL2VA: ['first_frame', 'last_frame'] }[shot.input_mode]
    if (shot.input_mode === 'Ref2VA') {
      content.push(...imageValues.filter(Boolean).map((url) => ({ type: 'image_url', image_url: { url }, role: 'reference_image' })))
    } else if (keyframeRoles) {
      if (images.length !== keyframeRoles.length) throw new Error(`H3 ${shot.input_mode} 关键帧参考数量必须为 ${keyframeRoles.length}`)
      content.push(...imageValues.filter(Boolean).map((url, index) => ({ type: 'image_url', image_url: { url }, role: keyframeRoles[index] })))
    }
    content.push(...videoValues.filter(Boolean).map((url) => ({ type: 'video_url', video_url: { url }, role: 'reference_video' })))
    content.push(...audioValues.filter(Boolean).map((url) => ({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })))
    args.metadata = { content }
    return { args, missing }
  }
  if (providerName === 'starrouter' && shot.prompt_profile === 'seedance2' && shot.input_mode === 'first-last-frame') {
    if (imageValues[0]) args.frame_url = imageValues[0]
    if (imageValues.slice(1).some(Boolean)) args.reference_image_urls = imageValues.slice(1).filter(Boolean)
  } else if (imageValues.some(Boolean)) {
    args.reference_image_urls = imageValues.filter(Boolean)
  }
  if (videoValues.some(Boolean)) args.reference_video_urls = videoValues.filter(Boolean)
  if (audioValues.some(Boolean)) args.reference_audio_urls = audioValues.filter(Boolean)
  return { args, missing }
}

function comflyStoryboardOnly(shot, episodeKey, assetsLedger, planShot) {
  if (shot.provider !== 'comfly') return shot
  if (storyboardMedium(planShot) === 'blender') {
    const images = (shot.references || []).filter((item) => item.type === 'image')
    if (images.length > 1 || (shot.references || []).some((item) => item.type !== 'image')) throw new Error('Comfly 在白模分镜模式下最多接收一张独立图片参考，白模视频仅作编导依据不得上传')
    return { ...shot, references: images }
  }
  const boardKey = `board-${episodeKey.replace('-', '')}-${String(shot.shot_number).padStart(3, '0')}`
  const listed = (shot.references || []).find((item) => item.type === 'image' && item.asset_key === boardKey)
  const asset = assetsLedger.assets?.[boardKey]
  const storyboard = listed || (asset?.selectedVersionId ? { type: 'image', asset_key: boardKey, version_id: asset.selectedVersionId, role: 'storyboard-reference' } : null)
  if (!storyboard) return { ...shot, references: [] }
  if ((planShot?.image_strategy?.panel_grid_size ?? 1) <= 1) return { ...shot, references: [{ ...storyboard, order: 1 }] }
  const frame = (shot.references || []).find((item) => {
    if (item.type !== 'image' || item.role !== 'storyboard-frame' || !item.asset_key?.startsWith('other-')) return false
    const frameAsset = assetsLedger.assets?.[item.asset_key]
    const version = frameAsset?.versions?.find((entry) => entry.id === item.version_id)
    return frameAsset?.selectedVersionId === item.version_id
      && version?.provenance?.origin === 'transformed'
      && version.provenance.created_by === 'codex'
      && version.provenance.source_assets?.some((source) => source.key === boardKey && source.version_id === storyboard.version_id)
  })
  if (!frame) throw new Error(`Comfly 只有一个参考图槽位，多格分镜板 ${boardKey}@${storyboard.version_id} 不得整张提交；先用 media-tools extract-grid-cell 裁出当前镜头单格，登记为 other-* transformed 资产并在提示词 references 中标记 role=storyboard-frame`)
  return { ...shot, references: [{ ...frame, order: 1 }] }
}

function applyRunninghubVideoDefaults(providerArgs) {
  if (providerArgs.provider !== 'runninghub') return
  if (providerArgs.model === 'minimax-h3-reference-to-video') {
    providerArgs.workflow_id ||= process.env.RUNNINGHUB_H3_WORKFLOW_ID || '2086743729407733762'
    if (Number.isInteger(providerArgs.duration) && providerArgs.duration < 5) providerArgs.duration = 5
  } else if (providerArgs.model !== 'krea2-normal-v1') providerArgs.workflow_id ||= process.env.RUNNINGHUB_VIDEO_WORKFLOW_ID
}

// 读取 selected 视频提示词文档，组装并逐镜校验整集提交参数；付费提交前的唯一计划入口。
async function planEpisodeVideos(projectRoot, episodeKey, shotNumbers = null) {
  const root = await realpath(resolve(projectRoot))
  if (!/^ep-\d{3}$/.test(episodeKey)) throw new Error('episode_key 必须为 ep-001 格式')
  const selection = JSON.parse(await readFile(resolve(root, 'episodes', episodeKey, 'video-prompts', 'selected.json'), 'utf8'))
  const document = JSON.parse(await readFile(resolve(root, selection.path), 'utf8'))
  const wanted = shotNumbers ? new Set(shotNumbers) : null
  if (wanted) for (const number of wanted) if (!(document.shots || []).some((shot) => shot.shot_number === number)) throw new Error(`提示词文档中不存在镜号：${number}`)
  const shots = (document.shots || []).filter((shot) => !wanted || wanted.has(shot.shot_number))
  const assetsLedger = JSON.parse(await readFile(resolve(root, '.short-drama', 'assets.json'), 'utf8'))
  const planSelection = JSON.parse(await readFile(resolve(root, 'episodes', episodeKey, 'production-plan', 'selected.json'), 'utf8'))
  const productionPlan = JSON.parse(await readFile(resolve(root, planSelection.path), 'utf8'))
  const receipts = await listReferenceUploads(root, { state: 'active' })
  const plans = []
  for (const shot of shots) {
    const target = shotTarget(episodeKey, shot.shot_number)
    const effectiveShot = comflyStoryboardOnly(shot, episodeKey, assetsLedger, productionPlan.shots?.find((item) => item.shot_number === shot.shot_number))
    const promptDocument = { episode_key: episodeKey, version_id: selection.versionId, shot_number: shot.shot_number }
    const base = { shot_number: shot.shot_number, target, provider: shot.provider, model: shot.model_or_workflow }
    try {
      const locate = (reference) => {
        const asset = assetsLedger.assets?.[reference.asset_key]
        const version = asset?.versions?.find((item) => item.id === reference.version_id)
        if (!version || asset.selectedVersionId !== reference.version_id || asset.staleVersionIds?.includes(reference.version_id)) throw new Error('not selected')
        if (shot.provider === 'runninghub') return resolve(root, version.localPath)
        const receipt = receipts.find((item) => item.asset_key === reference.asset_key && item.version_id === reference.version_id && item.sha256 === version.sha256)
        return receipt?.url || null
      }
      const { args: referenceArgs, missing } = referenceInputs(effectiveShot.provider, effectiveShot, locate)
      const providerArgs = {
        provider: effectiveShot.provider, model: shot.model_or_workflow, prompt_profile: shot.prompt_profile, input_mode: shot.input_mode,
        prompt_version: selection.versionId, prompt: shot.prompt, duration: shot.duration,
        reference_manifest: effectiveShot.references || [], ...referenceArgs, confirmed: true,
      }
      const nativeAudio = shot.audio_policy?.mode === 'native' || shot.audio_policy?.lines?.some((line) => line.delivery_mode === 'native')
      providerArgs.generate_audio = nativeAudio
      applyRunninghubVideoDefaults(providerArgs)
      await validateProjectInputs(root, 'video', target, promptDocument, shot.provider, providerArgs)
      plans.push({
        ...base, ok: true, missing_urls: missing, promptDocument, providerArgs,
        cost: { model: providerArgs.model, duration: providerArgs.duration, resolution: providerArgs.resolution || null, ratio: providerArgs.ratio || null, size: providerArgs.size || null, generate_audio: providerArgs.generate_audio ?? null, watermark: providerArgs.watermark ?? null, references: (effectiveShot.references || []).length },
      })
    } catch (error) {
      plans.push({ ...base, ok: false, error: error.message })
    }
  }
  return { episode_key: episodeKey, version_id: selection.versionId, plans }
}

function planSummary(plan) {
  return {
    episode_key: plan.episode_key,
    version_id: plan.version_id,
    shot_count: plan.plans.length,
    total_duration_seconds: plan.plans.reduce((sum, item) => sum + (item.ok ? item.cost.duration : 0), 0),
    shots: plan.plans.map((item) => item.ok
      ? { shot_number: item.shot_number, target: item.target, provider: item.provider, missing_urls: item.missing_urls, ...item.cost }
      : { shot_number: item.shot_number, target: item.target, provider: item.provider, error: item.error }),
  }
}

function publishableImageReferences(document, episodeKey, assetsLedger, productionPlan) {
  const unique = new Map()
  const skippedNonImage = []
  for (const shot of document.shots || []) {
    if (shot.provider === 'runninghub') continue
    if (shot.provider === 'comfly') {
      // Comfly 只有一个参考槽；预发布必须复用正式提交的派生清单，避免整板上传与实际单格输入分叉。
      const effective = comflyStoryboardOnly(shot, episodeKey, assetsLedger, productionPlan.shots?.find((item) => item.shot_number === shot.shot_number))
      for (const reference of effective.references || []) unique.set(`${reference.asset_key}@${reference.version_id}`, { asset_key: reference.asset_key, version_id: reference.version_id })
      continue
    }
    for (const reference of shot.references || []) {
      if (reference.type !== 'image') { skippedNonImage.push({ shot_number: shot.shot_number, asset_key: reference.asset_key, type: reference.type, reason: '批量发布仅支持图片；视频/音频参考请在单次 submit_video 中传已授权公网 URL' }); continue }
      unique.set(`${reference.asset_key}@${reference.version_id}`, { asset_key: reference.asset_key, version_id: reference.version_id })
    }
  }
  return { references: [...unique.values()], skippedNonImage }
}

async function ensureReferenceUrls(args) {
  const { project_root: projectRoot, episode_key: episodeKey, ...publishInput } = args
  const root = await realpath(resolve(projectRoot))
  const selection = JSON.parse(await readFile(resolve(root, 'episodes', episodeKey, 'video-prompts', 'selected.json'), 'utf8'))
  const document = JSON.parse(await readFile(resolve(root, selection.path), 'utf8'))
  const planSelection = JSON.parse(await readFile(resolve(root, 'episodes', episodeKey, 'production-plan', 'selected.json'), 'utf8'))
  const productionPlan = JSON.parse(await readFile(resolve(root, planSelection.path), 'utf8'))
  const assetsLedger = JSON.parse(await readFile(resolve(root, '.short-drama', 'assets.json'), 'utf8'))
  const { references, skippedNonImage } = publishableImageReferences(document, episodeKey, assetsLedger, productionPlan)
  const results = await Promise.all(references.map(async (input) => {
    try {
      const receipt = await publishReferenceImage(root, { ...publishInput, ...input })
      return { ok: true, ...input, url: receipt.url, reused: receipt.reused === true, expires_at: receipt.expires_at }
    } catch (error) {
      return { ok: false, ...input, error: error.message }
    }
  }))
  return { episode_key: episodeKey, published: results.filter((item) => item.ok), failed: results.filter((item) => !item.ok), skipped_non_image: skippedNonImage }
}

async function submitEpisodeVideos(args) {
  const { project_root: projectRoot, episode_key: episodeKey, shot_numbers: shotNumbers, confirmed } = args
  if (typeof confirmed !== 'boolean') throw new Error('confirmed 必须是布尔值：false 仅出费用摘要，true 在用户确认费用后并发提交')
  const plan = await planEpisodeVideos(projectRoot, episodeKey, shotNumbers || null)
  if (plan.plans.length && !plan.plans.some((item) => !item.ok)) await enforceGenerationStage(projectRoot, 'submit_video', plan.plans[0].target)
  if (!confirmed) return { phase: 'plan', ready: !plan.plans.some((item) => !item.ok), ...planSummary(plan) }
  const errors = plan.plans.filter((item) => !item.ok)
  if (errors.length || !plan.plans.length) throw new Error(`整集校验未通过，未提交任何镜头：\n${errors.map((item) => `第${item.shot_number}镜：${item.error}`).join('\n')}`)
  const limit = plan.plans.some((item) => item.provider === 'comfly') ? 4 : plan.plans.length
  const outcomes = await mapWithConcurrency(plan.plans, limit, async (item) => {
    const result = await submitVideoOnce(projectRoot, item.target, item.promptDocument, item.providerArgs)
    return { shot_number: item.shot_number, target: item.target, task_id: result.task_id, status: result.status, ...(result.output_version_ids ? { output_version_ids: result.output_version_ids, quality: result.output_quality || [] } : {}) }
  })
  const submitted = []
  const failed = []
  for (const [index, outcome] of outcomes.entries()) {
    const shot = plan.plans[index]
    if (outcome.status === 'fulfilled') submitted.push(outcome.value)
    else failed.push({ shot_number: shot.shot_number, target: shot.target, error: outcome.reason?.message || String(outcome.reason) })
  }
  return { phase: 'submitted', ...planSummary(plan), submitted, failed }
}

async function awaitEpisodeTasks(args) {
  const { project_root: projectRoot, episode_key: episodeKey, timeout_seconds: timeoutSeconds = 480, poll_interval_seconds: pollIntervalSeconds = 8 } = args
  const timeout = Math.min(540, Math.max(10, timeoutSeconds))
  const interval = Math.min(30, Math.max(3, pollIntervalSeconds)) * 1000
  const prefix = shotTarget(episodeKey, 1).slice(0, -3)
  const tasks = (await listTasks(projectRoot, { types: ['video'] }))
    .filter((task) => task.target.startsWith(prefix) && ['queued', 'running'].includes(task.status))
  const pending = new Map(tasks.map((task) => [task.taskId, task]))
  const completed = []
  const failed = []
  let rounds = 0
  const deadline = Date.now() + timeout * 1000
  while (pending.size && Date.now() < deadline) {
    rounds += 1
    const entries = [...pending.values()]
    const outcomes = await Promise.allSettled(entries.map(async (task) => {
      const remote = await adapter(task.provider).task({ task_id: task.taskId })
      return syncTaskResult(projectRoot, task.taskId, remote)
    }))
    for (const [index, outcome] of outcomes.entries()) {
      const task = entries[index]
      if (outcome.status === 'rejected') continue // 轮询瞬断不判失败，下一轮继续
      const result = outcome.value
      if (result.status === 'pending') {
        pending.set(task.taskId, result.local_task)
        continue
      }
      pending.delete(task.taskId)
      if (result.status === 'completed') completed.push({ shot_number: Number(task.target.slice(-3)), target: task.target, task_id: task.taskId, version_ids: result.output_version_ids || [], quality: result.output_quality || [] })
      else failed.push({ shot_number: Number(task.target.slice(-3)), target: task.target, task_id: task.taskId, error: result.error || null })
    }
    if (pending.size && Date.now() < deadline) await sleep(interval)
  }
  return {
    episode_key: episodeKey, rounds, deadline_reached: pending.size > 0,
    completed, failed,
    pending: [...pending.values()].map((task) => ({ target: task.target, task_id: task.taskId, status: task.status })),
  }
}

// 单镜提交的唯一实现路径：单工具 submit_video 与整集批量提交都走这里。
async function submitVideoOnce(projectRoot, target, promptDocument, providerArgs) {
  const providerName = providerArgs.provider
  if (typeof providerArgs.confirmed !== 'boolean') providerArgs.confirmed = true
  await enforceGenerationStage(projectRoot, 'submit_video', target)
  applyRunninghubVideoDefaults(providerArgs)
  await validateProjectInputs(projectRoot, 'video', target, promptDocument, providerName, providerArgs)
  const selectedAdapter = adapter(providerName)
  const snapshot = await createRequestSnapshot(projectRoot, { tool: 'submit_video', target, type: 'video', provider: providerName, modelOrWorkflow: providerArgs.model || providerArgs.workflow_id, promptDocument, arguments: providerArgs })
  await reserveTask(projectRoot, { taskId: snapshot.requestId, target, type: 'video', provider: providerName, requestPath: snapshot.requestPath })
  let result
  try {
    result = await selectedAdapter.submitVideo(providerArgs)
  } catch (error) {
    await settleReservedTask(projectRoot, snapshot.requestId, { status: 'failed' })
    throw error
  }
  const taskId = result.task_id || snapshot.requestId
  await settleReservedTask(projectRoot, snapshot.requestId, { taskId, status: result.status === 'submitted' ? 'queued' : 'running' })
  const tracked = { ...result, task_id: taskId, request_id: snapshot.requestId, request_path: snapshot.requestPath, request_sha256: snapshot.requestSha256 }
  return result.status === 'completed' ? syncTaskResult(projectRoot, taskId, tracked) : tracked
}

function selfCheck() {
  const refs = (types) => types.map((type, index) => ({ type, order: index + 1, asset_key: `asset-${type}-${index + 1}`, version_id: 'v001', role: 'r' }))
  const urlLocate = (reference) => `https://litter.catbox.moe/${reference.asset_key}.png`
  const missingLocate = (reference) => (reference.asset_key.includes('missing') ? null : urlLocate(reference))
  const h3 = (inputMode, references) => ({ provider: 'starrouter', model_or_workflow: 'MiniMax-H3', prompt_profile: 'h3', input_mode: inputMode, prompt: 'P', references })
  let out = referenceInputs('starrouter', h3('Ref2VA', refs(['image', 'image', 'video'])), urlLocate)
  const content = out.args.metadata.content
  if (content.filter((item) => item.type !== 'text').map((item) => item.role).join(',') !== 'reference_image,reference_image,reference_video' || content[1].image_url.url !== 'https://litter.catbox.moe/asset-image-1.png') throw new Error('H3 Ref2VA 参考映射自检失败')
  out = referenceInputs('starrouter', h3('FL2VA', refs(['image', 'image'])), urlLocate)
  if (out.args.metadata.content.filter((item) => item.type !== 'text').map((item) => item.role).join(',') !== 'first_frame,last_frame') throw new Error('H3 FL2VA 参考映射自检失败')
  out = referenceInputs('starrouter', h3('L2VA', refs(['image'])), urlLocate)
  if (out.args.metadata.content[1].role !== 'last_frame') throw new Error('H3 L2VA 参考映射自检失败')
  try { referenceInputs('starrouter', h3('I2VA', refs(['image', 'image'])), urlLocate); throw new Error('H3 关键帧数量自检失败') } catch (error) { if (!String(error.message).includes('I2VA')) throw error }
  const seedance = { provider: 'starrouter', model_or_workflow: 'dreamina-seedance-2-0-260128', prompt_profile: 'seedance2', input_mode: 'first-last-frame', prompt: 'P', references: refs(['image', 'image']) }
  out = referenceInputs('starrouter', seedance, urlLocate)
  if (out.args.frame_url !== 'https://litter.catbox.moe/asset-image-1.png' || out.args.reference_image_urls[0] !== 'https://litter.catbox.moe/asset-image-2.png') throw new Error('Seedance 首尾帧参考映射自检失败')
  out = referenceInputs('starrouter', { ...seedance, input_mode: 'full-reference' }, urlLocate)
  if (out.args.frame_url || out.args.reference_image_urls.length !== 2) throw new Error('Seedance 全参考映射自检失败')
  out = referenceInputs('comfly', { ...h3('Ref2VA', refs(['image', 'image'])), provider: 'comfly' }, urlLocate)
  if (out.args.reference_image_urls?.length !== 2 || out.args.metadata) throw new Error('Comfly 参考映射自检失败')
  const board = { type: 'image', order: 1, asset_key: 'board-ep001-001', version_id: 'v001', role: 'storyboard-reference' }
  const frame = { type: 'image', order: 2, asset_key: 'other-ep001-001-frame', version_id: 'v001', role: 'storyboard-frame' }
  const ledger = { assets: { 'board-ep001-001': { selectedVersionId: 'v001' }, 'other-ep001-001-frame': { selectedVersionId: 'v001', versions: [{ id: 'v001', provenance: { origin: 'transformed', created_by: 'codex', source_assets: [{ key: 'board-ep001-001', version_id: 'v001' }] } }] } } }
  if (comflyStoryboardOnly({ provider: 'comfly', shot_number: 1, references: [board, frame] }, 'ep-001', ledger, { image_strategy: { panel_grid_size: 4 } }).references[0].asset_key !== frame.asset_key) throw new Error('Comfly 单格参考选择自检失败')
  try { comflyStoryboardOnly({ provider: 'comfly', shot_number: 1, references: [board] }, 'ep-001', ledger, { image_strategy: { panel_grid_size: 4 } }); throw new Error('Comfly 多格分镜拦截自检失败') } catch (error) { if (!String(error.message).includes('不得整张提交')) throw error }
  if (publishableImageReferences({ shots: [{ provider: 'comfly', shot_number: 1, references: [board, frame] }] }, 'ep-001', ledger, { shots: [{ shot_number: 1, image_strategy: { panel_grid_size: 4 } }] }).references[0].asset_key !== frame.asset_key) throw new Error('Comfly 预发布未复用单格派生清单')
  out = referenceInputs('runninghub', { provider: 'runninghub', model_or_workflow: 'minimax-h3-reference-to-video', prompt_profile: 'h3', input_mode: 'Ref2VA', prompt: 'P', references: refs(['image', 'video', 'audio']) }, () => '/assets/x.png')
  if (out.args.reference_image_paths.length !== 1 || out.args.reference_video_paths.length !== 1 || out.args.reference_audio_paths.length !== 1) throw new Error('RunningHub H3 本地参考映射自检失败')
  out = referenceInputs('runninghub', { provider: 'runninghub', model_or_workflow: 'workflow-x', prompt: 'P', references: refs(['image', 'video']) }, () => '/assets/x.png')
  if (out.args.reference_paths.length !== 2) throw new Error('RunningHub 顺序本地参考映射自检失败')
  out = referenceInputs('starrouter', h3('Ref2VA', [{ type: 'image', order: 1, asset_key: 'missing-a', version_id: 'v001', role: 'r' }]), missingLocate)
  if (out.missing.join() !== 'missing-a@v001' || out.args.metadata.content.some((item) => item.type !== 'text')) throw new Error('参考缺失登记自检失败')
}

function sameReference(left, right) {
  return left?.asset_key === right?.asset_key && left?.version_id === right?.version_id
}

async function validateLipSyncEligibility(root, request, source, audio) {
  const reference = request.parameters.audio_plan
  const binding = request.parameters.audio_binding
  if (!binding || binding.asset_key !== request.audio.asset_key || binding.version_id !== request.audio.version_id || binding.sha256 !== audio.version.sha256 || binding.line_index !== reference.line_index || binding.dubbing_contract_version !== reference.version_id || !/^v\d{3}$/.test(binding.speech_timing_version || '')) throw new Error('对口型必须绑定当前配音 SHA、合同版本和 speech-timing 版本')
  const selection = JSON.parse(await readFile(resolve(root, 'episodes', reference.episode_key, 'audio-plan', 'selected.json'), 'utf8'))
  if (selection.versionId !== reference.version_id) throw new Error('对口型必须引用当前 selected audio-plan')
  const plan = JSON.parse(await readFile(resolve(root, selection.path), 'utf8'))
  const line = plan.approved === true && !plan.unresolved?.length && plan.lines?.find((item) => item.line_index === reference.line_index)
  if (!line) throw new Error('对口型所引用的 audio-plan 行不存在、未批准或仍有未决项')
  if (line.presentation !== 'visible-dialogue') throw new Error('旁白或画外音不得执行对口型')
  if (line.dubbing_contract?.mode === 'native-preserve' && !audio.version.provenance?.parameters?.dubbing_compiler) throw new Error('合格原生对白不得执行对口型；仅独立音频可用')
  const resolvedContract = await resolveGeneratedDubbingContract(root, { plan, planVersion: reference.version_id, line, audioVersion: audio.version })
  if (resolvedContract.contract.timing_source?.version_id !== binding.speech_timing_version || resolvedContract.contract.timing_source?.line_index !== binding.line_index) throw new Error('对口型必须引用当前配音合同与最终 speech-timing')
  if (resolvedContract.source === 'audio-plan') {
    if (!['post_dub', 'external_audio'].includes(line.delivery_mode)) throw new Error('合格原生对白不得执行对口型；仅独立音频可用')
    if (!sameReference(line.source_audio, request.audio)) throw new Error('对口型音频必须与 audio-plan 行的 selected 独立音频完全一致')
  }
  const shot = /^shot-ep(\d{3})-(\d{3})$/.exec(request.target)
  if (!shot || reference.episode_key !== `ep-${shot[1]}` || line.matched_shot?.shot_number !== Number(shot[2])) throw new Error('对口型 audio-plan 行必须与目标镜头完全一致')
  const targetRange = resolvedContract.contract.target_range
  if (!targetRange || targetRange.start_ms !== request.range.start_ms || targetRange.end_ms !== request.range.end_ms) throw new Error('对口型范围必须与当前配音合同 target_range 完全一致')
  const media = probeMedia(source.path)
  if (!media.has_video || request.range.end_ms > media.duration_ms) throw new Error('对口型来源视频未覆盖完整台词范围')
  const speech = probeMedia(audio.path)
  if (!speech.has_audio || speech.duration_ms < request.range.end_ms - request.range.start_ms) throw new Error('对口型独立音频未覆盖完整台词范围')
  return line
}

async function validateProjectMediaOperation(args) {
  const root = await realpath(resolve(args.project_root))
  const state = JSON.parse(await readFile(resolve(root, '.short-drama/state.json'), 'utf8'))
  if (!['media-production', 'editing'].includes(state.stage)) throw new Error(`媒体操作只能在 media-production 或 editing 阶段执行；当前阶段为 ${state.stage}`)
  const request = validateMediaOperation({ operation: args.operation, target: args.target, source: args.source, ...(args.audio ? { audio: args.audio } : {}), ...(args.mask ? { mask: args.mask } : {}), ...(args.range ? { range: args.range } : {}), parameters: args.parameters })
  const source = await selectedAssetVersion(root, request.source.asset_key)
  if (source.version.id !== request.source.version_id || source.asset.type !== 'video' || args.target !== source.asset.key) throw new Error('媒体操作 target 必须是来源的当前 selected 视频资产')
  const references = [{ role: 'source', requested: request.source, selected: source }]
  for (const [role, expectedType] of [['audio', 'audio'], ['mask', null]]) {
    if (!request[role]) continue
    const selected = await selectedAssetVersion(root, request[role].asset_key)
    if (selected.version.id !== request[role].version_id || expectedType && selected.asset.type !== expectedType) throw new Error(`媒体操作 ${role} 必须是当前 selected 资产版本`)
    if (role === 'mask' && (!['other', 'storyboard'].includes(selected.asset.type) || !/\.(?:jpe?g|png|webp)$/i.test(selected.path))) throw new Error('媒体操作 mask 必须是当前 selected 本地图像资产')
    references.push({ role, requested: request[role], selected })
  }
  if (request.operation === 'lip-sync') await validateLipSyncEligibility(root, request, source, references.find((item) => item.role === 'audio').selected)

  const capability = operationCapability(request.operation)
  const remote = args.provider !== 'local'
  if (!remote && capability !== 'transform.local') throw new Error(`${request.operation} 需要远端 ${capability} 能力`)
  if (remote && capability === 'transform.local') throw new Error(`${request.operation} 是确定性本地操作，不得伪装为远端任务`)
  if (remote && !providerSupports(args.provider, capability)) throw new Error(`${args.provider} 未声明 ${capability} 能力`)
  const seedVr25 = args.provider === 'runninghub' && request.operation === 'video-upscale' && args.model === SEEDVR25_MODEL
  if (seedVr25 && args.workflow_id && String(args.workflow_id) !== SEEDVR25_WORKFLOW_ID) throw new Error('SeedVR2.5 必须使用固定工作流 2099866760106491906')
  if (seedVr25 && args.node_info_list?.length) throw new Error('SeedVR2.5 节点覆盖由内置真实映射生成，不接受手工 node_info_list')
  const modelOrWorkflow = seedVr25 ? SEEDVR25_MODEL : args.workflow_id || args.model || (args.provider === 'musetalk' ? 'musetalk-1.5' : null)
  if (remote && !modelOrWorkflow) throw new Error('远端媒体操作必须显式提供 model 或 workflow_id')
  if (remote && args.provider === 'runninghub' && !seedVr25 && (!Array.isArray(args.node_info_list) || !args.node_info_list.length)) throw new Error('RunningHub 媒体操作 node_info_list 必填')
  return {
    root, target: args.target, provider: args.provider, remote, capability, modelOrWorkflow, model: seedVr25 ? SEEDVR25_MODEL : args.model,
    request: { ...request, source_sha256: source.version.sha256 },
    referencePaths: references.map((item) => item.selected.path),
    referencePathsByRole: Object.fromEntries(references.map((item) => [item.role, item.selected.path])),
    uploads: references.map((item) => ({ role: item.role, asset_key: item.requested.asset_key, version_id: item.requested.version_id, sha256: item.selected.version.sha256 })),
    workflow_id: seedVr25 ? SEEDVR25_WORKFLOW_ID : args.workflow_id,
    node_info_list: args.node_info_list,
    node_overrides: seedVr25 ? [SEEDVR25_MAPPING.video_input] : undefined,
  }
}

async function submitProviderMediaOperation(normalized) {
  const selected = adapter(normalized.provider)
  if (typeof selected.transform !== 'function') throw new Error(`${normalized.provider} 未实现媒体变换提交`)
  const providerArgs = { ...normalized.request, model: normalized.model, workflow_id: normalized.workflow_id, node_info_list: normalized.node_info_list, reference_paths: normalized.referencePaths, confirmed: true }
  const snapshot = await createRequestSnapshot(normalized.root, { tool: 'submit_media_operation', target: normalized.target, type: 'video', provider: normalized.provider, modelOrWorkflow: normalized.modelOrWorkflow, promptDocument: null, arguments: providerArgs })
  await reserveTask(normalized.root, { taskId: snapshot.requestId, target: normalized.target, type: 'video', provider: normalized.provider, requestPath: snapshot.requestPath })
  let result
  try {
    const invocation = normalized.provider === 'musetalk' ? {
      ...providerArgs,
      source_video_path: normalized.referencePathsByRole.source,
      source_audio_path: normalized.referencePathsByRole.audio,
      output_path: resolve(normalized.root, '.short-drama', 'provider-output', `${snapshot.requestId}.mp4`),
      face_selector: normalized.request.parameters.face_selector,
    } : normalized.model === SEEDVR25_MODEL ? { ...providerArgs, source_video_path: normalized.referencePathsByRole.source } : providerArgs
    result = await selected.transform(invocation)
  }
  catch (error) {
    await settleReservedTask(normalized.root, snapshot.requestId, { status: 'failed' })
    throw error
  }
  const taskId = result.task_id || snapshot.requestId
  await settleReservedTask(normalized.root, snapshot.requestId, { taskId, status: result.status === 'submitted' ? 'queued' : 'running' })
  const tracked = { ...result, task_id: taskId, request_id: snapshot.requestId, request_path: snapshot.requestPath, request_sha256: snapshot.requestSha256 }
  return result.status === 'completed' ? syncTaskResult(normalized.root, taskId, tracked) : tracked
}

async function submitMediaOperation(args) {
  const normalized = await validateProjectMediaOperation(args)
  if (args.confirmed !== true) return { requires_confirmation: normalized.remote, remote: normalized.remote, operation: normalized.request.operation, capability: normalized.capability, source: normalized.request.source, uploads: normalized.uploads, provider: normalized.provider, model_or_workflow: normalized.modelOrWorkflow, ...(normalized.workflow_id ? { workflow_id: normalized.workflow_id } : {}), ...(normalized.node_overrides ? { node_overrides: normalized.node_overrides } : {}) }
  if (normalized.remote) return submitProviderMediaOperation(normalized)
  const result = await executeLocalMediaOperation(normalized.root, normalized.request)
  return { status: 'completed', provider: 'local', operation: normalized.request.operation, ...result }
}

async function getMediaOperation(args) {
  const task = await getTask(args.project_root, args.task_id)
  const request = JSON.parse(await readFile(resolve(args.project_root, task.requestPath), 'utf8'))
  if (request.tool !== 'submit_media_operation') throw new Error('任务不是媒体操作任务')
  const result = await adapter(task.provider).task({ task_id: task.taskId, media_type: task.type })
  return syncTaskResult(args.project_root, task.taskId, result)
}

async function registerMediaOperationOutput(args) {
  const task = await getTask(args.project_root, args.task_id)
  if (task.status === 'completed' || task.outputVersionId) throw new Error('媒体操作任务输出已经登记')
  if (!['queued', 'running'].includes(task.status)) throw new Error(`媒体操作任务当前状态不能登记输出：${task.status}`)
  const request = JSON.parse(await readFile(resolve(args.project_root, task.requestPath), 'utf8'))
  if (request.tool !== 'submit_media_operation' || task.type !== 'video' || !Array.isArray(args.outputs) || !args.outputs.length) throw new Error('媒体操作任务或输出无效')
  return syncTaskResult(args.project_root, task.taskId, { provider: task.provider, status: 'completed', outputs: args.outputs.map((item) => ({ ...item, media_type: 'video' })) })
}

function validateFallbackBinding(presentation, binding, line) {
  if (presentation === 'narration') {
    const profile = binding?.cinematic_profile
    const complete = profile && ['tone_arc', 'emotion_beats', 'pace', 'breath_and_pause', 'distance_and_space'].every((field) => field === 'emotion_beats' ? Array.isArray(profile[field]) && profile[field].length : typeof profile[field] === 'string' && profile[field].trim())
    if (binding?.voice_role !== 'narrator' || !complete) throw new Error('旁白兜底必须使用独立 narrator 和完整电影感音色档案')
    if (binding.character_key && !line?.narrator_is_character) throw new Error('剧本未声明角色兼任叙述者，不得复用角色音色')
    if (line?.performance && JSON.stringify(profile) !== JSON.stringify(line.performance)) throw new Error('旁白 cinematic_profile 必须与 audio-plan 表演合同一致')
  } else if (binding?.voice_role !== 'character') throw new Error('角色对白兜底必须绑定 character 音色')
}

export async function persistDerivedFallbackContract(rootArg, record) {
  const root = await realpath(resolve(rootArg))
  if (!/^ep-\d{3}$/.test(record?.episode_key || '') || !Number.isInteger(record?.line_index) || record.line_index <= 0 || record.generated_contract?.mode !== 'generated' || !record.native_audio_exception || !record.voice_binding) throw new Error('派生兜底合同缺少原声失败证据、授权音色或生成合同')
  const canonical = JSON.stringify(record)
  const sha256 = createHash('sha256').update(canonical).digest('hex')
  const target = resolve(root, 'episodes', record.episode_key, 'audio-plan', 'fallback-contracts', `line-${String(record.line_index).padStart(3, '0')}-${sha256.slice(0, 16)}.json`)
  await mkdir(dirname(target), { recursive: true })
  const content = `${JSON.stringify(record, null, 2)}\n`
  try { await writeFile(target, content, { flag: 'wx' }) }
  catch (error) {
    if (error?.code !== 'EEXIST' || await readFile(target, 'utf8') !== content) throw error
  }
  return { path: relative(root, target), sha256 }
}

async function prepareAudioFallback(args) {
  if (args.presentation) validateFallbackBinding(args.presentation, args.voice_binding, null)
  const root = await realpath(resolve(args.project_root))
  if (!/^ep-\d{3}$/.test(args.episode_key || '') || !/^v\d{3}$/.test(args.audio_plan_version || '') || !Number.isInteger(args.line_index)) throw new Error('音频兜底计划引用无效')
  const selection = JSON.parse(await readFile(resolve(root, 'episodes', args.episode_key, 'audio-plan', 'selected.json'), 'utf8'))
  if (selection.versionId !== args.audio_plan_version) throw new Error('音频兜底必须引用当前 selected audio-plan')
  const plan = JSON.parse(await readFile(resolve(root, selection.path), 'utf8'))
  const line = plan.approved === true && !plan.unresolved?.length && plan.lines?.find((item) => item.line_index === args.line_index)
  if (!line) throw new Error('音频兜底行不存在、未批准或仍有未决项')
  if (line.delivery_mode !== 'native') throw new Error('只有原生音频行审核失败后才能执行音频兜底')
  validateFallbackBinding(line.presentation, args.voice_binding, line)
  if (args.presentation && args.presentation !== line.presentation) throw new Error('音频兜底 presentation 与 audio-plan 不一致')
  if (line.presentation === 'narration' && line.fallback_mode !== 'cinematic-tts') throw new Error('旁白行未批准 cinematic-tts 兜底')
  if (line.presentation !== 'narration' && line.fallback_mode !== 'post-dub') throw new Error('对白行未批准 post-dub 兜底')
  const binding = plan.voice_bindings?.find((item) => item.speaker === line.speaker && item.provider === args.provider && item.model === args.model && item.voice_id === args.voice)
  if (!binding || args.voice_binding?.provider !== args.provider || args.voice_binding?.model !== args.model || args.voice_binding?.voice_id !== args.voice) throw new Error('音频兜底 voice_binding 与已批准 audio-plan 不一致')

  const assets = JSON.parse(await readFile(resolve(root, '.short-drama', 'assets.json'), 'utf8'))
  const sourceAsset = assets.assets?.[args.source_video?.asset_key]
  const sourceVersion = sourceAsset?.versions?.find((item) => item.id === args.source_video?.version_id)
  if (sourceAsset?.type !== 'video' || !sourceVersion?.localPath || sourceAsset.staleVersionIds?.includes(sourceVersion.id)) throw new Error('音频兜底来源视频不存在或已失效')
  const sourcePath = resolve(root, sourceVersion.localPath)
  const sourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex')
  if (sourceSha256 !== sourceVersion.sha256) throw new Error('音频兜底来源视频文件已被篡改')
  const audit = JSON.parse(await readFile(resolve(root, '.short-drama', 'audio-audits', `${args.source_video.asset_key}@${args.source_video.version_id}.json`), 'utf8'))
  validateNativeAudioReview(audit)
  if (audit.approved || audit.watched_full !== true || audit.sha256 !== sourceVersion.sha256 || audit.episode_key !== args.episode_key || audit.shot_number !== line.matched_shot?.shot_number || audit.asset_key !== args.source_video.asset_key || audit.version_id !== args.source_video.version_id) throw new Error('音频兜底必须绑定同一镜头、完整听看且未通过的原生音频审核')
  const fallback = planAudioFallback(audit, [{ line_index: line.line_index, range: args.range }])
  const replacement = fallback.replacements.find((item) => item.reason === args.reason && item.range.start_ms === args.range?.start_ms && item.range.end_ms === args.range?.end_ms)
  if (!replacement) throw new Error('音频兜底 reason/range 不属于审核失败区间')
  if (!Array.isArray(args.mix_sources) || !args.mix_sources.length) throw new Error('音频兜底必须记录最终混音来源')
  const provenance = { native_audio_exception: { reason: args.reason, evidence: audit.dimensions[replacement.dimension].observation, range: { ...args.range } }, source_assets: [{ key: args.source_video.asset_key, version_id: args.source_video.version_id }], replaced_ranges: [{ ...args.range }], mix_sources: [...args.mix_sources] }
  const performanceReference = line.dubbing_contract?.performance_reference
  if (!performanceReference) throw new Error('音频兜底必须由当前 native-preserve 合同派生表演与时间证据')
  const generatedContract = {
    mode: 'generated', timing_source: line.dubbing_contract.timing_source, target_range: { ...args.range }, target_speech_ms: args.range.end_ms - args.range.start_ms,
    original_text: line.content, adapted_text: line.content, adaptation: null,
    performance: { ...performanceReference, pace: line.performance?.pace || '自然语速', distance_and_space: line.performance?.distance_and_space || '遵循原镜头空间关系' },
    fit_policy: { max_paid_generations: 3, provider_speed_min: 0.85, provider_speed_max: 1.15, max_post_tempo_percent: 3, text_adaptation_allowed: true },
  }
  const compiled = compileDubbingRequest({ provider: args.provider, model: args.model, voice: args.voice, contract: generatedContract, attempt: args.dubbing_attempt || 1, measured_speech_ms: args.measured_speech_ms, dubbing_contract_version: args.audio_plan_version, voice_binding: binding, authorized_voice_bindings: plan.voice_bindings, delivery_mode: 'post_dub', presentation: line.presentation })
  if (!compiled.supported || compiled.capability_gaps.length) throw new Error(`配音能力不匹配：${compiled.capability_gaps.join('、')}`)
  compiled.snapshot = { ...compiled.snapshot, episode_key: args.episode_key, line_index: args.line_index }
  return { root, line, binding, generatedContract, compiled, provenance, promptDocument: { kind: 'audio-plan', episode_key: args.episode_key, version_id: args.audio_plan_version, line_index: args.line_index } }
}

async function generateAudioFallback(args) {
  const prepared = await prepareAudioFallback(args)
  if (args.confirmed !== true) return { requires_confirmation: true, provider: args.provider, model: args.model, target: args.target, content: prepared.line.content, compiled: prepared.compiled.snapshot, provenance: prepared.provenance }
  const derived = await persistDerivedFallbackContract(prepared.root, {
    version: 1, episode_key: args.episode_key, line_index: args.line_index, audio_plan_version: args.audio_plan_version,
    source_video: args.source_video, native_audio_exception: prepared.provenance.native_audio_exception,
    voice_binding: prepared.binding, generated_contract: prepared.generatedContract,
  })
  const compilerSnapshot = { ...prepared.compiled.snapshot, derived_contract: derived }
  const result = await call('generate_audio', {
    provider: args.provider, ...prepared.compiled.arguments, response_format: args.response_format || 'wav', confirmed: true, dubbing_compiler_snapshot: compilerSnapshot,
    project_root: prepared.root, target: args.target, prompt_document: prepared.promptDocument,
    reference_manifest: [{ type: 'video', order: 1, asset_key: args.source_video.asset_key, version_id: args.source_video.version_id, role: 'native-audio-source' }],
    native_audio_exception: prepared.provenance.native_audio_exception, replaced_ranges: prepared.provenance.replaced_ranges, mix_sources: prepared.provenance.mix_sources,
    [TRUSTED_AUDIO_FALLBACK]: { derived_contract: derived },
  })
  return { ...result, provenance: prepared.provenance, derived_contract: derived }
}

async function registerLicensedMusic(args) {
  if (args.confirmed !== true || args.rights_confirmed !== true || !['non-commercial', 'commercial-authorized'].includes(args.usage_scope)) throw new Error('授权音乐导入必须确认本地文件、使用权和使用范围')
  if (!/^audio-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.target || '')) throw new Error('授权音乐 target 必须是 audio-* key')
  const root = await realpath(resolve(args.project_root))
  await readFile(resolve(root, '.short-drama', 'project.json'))
  const source = await realpath(resolve(args.local_file || '')).catch(() => { throw new Error('授权音乐本地文件不存在') })
  let media
  try { media = probeMedia(source) } catch { throw new Error('授权音乐必须包含可解码的真实音频流') }
  if (!media.has_audio || media.duration_ms <= 0) throw new Error('授权音乐必须包含可解码的真实音频流')
  const receipt = await putMusicLicense(root, args.receipt)
  const provenance = { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: { music_license_receipt: receipt.receipt_key, usage_scope: args.usage_scope, rights_confirmed: true } }
  return { ...await importAssetFile(root, args.target, source, provenance, args.name || receipt.title), receipt_key: receipt.receipt_key, probe: media, provenance }
}

async function currentAudioPlanLine(rootArg, episodeKey, versionId, lineIndex) {
  const root = await realpath(resolve(rootArg))
  const marker = JSON.parse(await readFile(resolve(root, 'episodes', episodeKey, 'audio-plan', 'selected.json'), 'utf8'))
  if (marker.versionId !== versionId) throw new Error('必须引用当前 selected audio-plan 版本')
  const plan = JSON.parse(await readFile(resolve(root, marker.path || `episodes/${episodeKey}/audio-plan/${versionId}.json`), 'utf8'))
  const line = plan.approved === true && !plan.unresolved?.length && plan.lines?.find((item) => item.line_index === lineIndex)
  if (!line) throw new Error('audio-plan 行不存在、未批准或仍有未决项')
  return { root, plan, line }
}

async function buildTrustedSubtitles(args) {
  if (!args.project_root) throw new Error('字幕构建必须提供项目 project_root，不接受调用者手写资产证据')
  const root = await realpath(resolve(args.project_root))
  if (!/^ep-\d{3}$/.test(args.episode_key || '') || !Number.isInteger(args.line_index) || args.line_index <= 0) throw new Error('字幕分集或行号无效')
  const planMarker = JSON.parse(await readFile(resolve(root, 'episodes', args.episode_key, 'audio-plan', 'selected.json'), 'utf8'))
  const plan = JSON.parse(await readFile(resolve(root, planMarker.path || `episodes/${args.episode_key}/audio-plan/${planMarker.versionId}.json`), 'utf8'))
  const line = plan.approved === true && !plan.unresolved?.length && plan.lines?.find((item) => item.line_index === args.line_index)
  if (!line?.dubbing_contract?.timing_source) throw new Error('字幕必须绑定当前已批准配音合同')
  const sourceTiming = await selectedSourceSpeechTiming(root, line.dubbing_contract.timing_source)
  const sourceLine = sourceTiming.document.lines.find((item) => item.line_index === args.line_index)
  if (!sourceLine || !Array.isArray(sourceLine.words) || !sourceLine.words.length) throw new Error('字幕必须绑定合同指定的已复核词级 speech-timing')
  const assets = JSON.parse(await readFile(resolve(root, '.short-drama', 'assets.json'), 'utf8'))
  const reviews = JSON.parse(await readFile(resolve(root, '.short-drama', 'dubbing-reviews.json'), 'utf8').catch((error) => error?.code === 'ENOENT' ? '{"reviews":{}}' : Promise.reject(error)))
  const approvedCandidates = Object.values(reviews.reviews || {}).filter((review) => {
    const candidate = assets.assets?.[review.asset_key]
    return review.approved === true && review.episode_key === args.episode_key && review.line_index === args.line_index && review.audio_plan_version === planMarker.versionId && candidate?.type === 'audio' && candidate.selectedVersionId === review.version_id && !candidate.staleVersionIds?.includes(review.version_id)
  })
  const sourceOffset = (sourceLine.timeline_mapping?.timeline_at_ms || 0) - (sourceLine.timeline_mapping?.source_in_ms || 0)
  const mappedSourceLine = { ...sourceLine, start_ms: sourceLine.start_ms + sourceOffset, end_ms: sourceLine.end_ms + sourceOffset, words: sourceLine.words.map((word) => ({ ...word, start_ms: word.start_ms + sourceOffset, end_ms: word.end_ms + sourceOffset })) }
  if (line.dubbing_contract.mode === 'native-preserve' && approvedCandidates.length === 0) {
    const source = line.dubbing_contract.timing_source.source_asset
    const asset = assets.assets?.[source.asset_key]
    const version = asset?.versions?.find((item) => item.id === source.version_id)
    if (asset?.type !== 'video' || asset.selectedVersionId !== source.version_id || asset.staleVersionIds?.includes(source.version_id) || version?.sha256 !== source.sha256) throw new Error('原生声轨字幕必须绑定当前 selected、未失效的 timing 来源视频')
    return buildSubtitlesFromAudio({
      audio: { ...source, line_index: args.line_index },
      timing: { version_id: sourceTiming.version_id, lines: [mappedSourceLine] },
      contracts: [{ line_index: args.line_index, content: line.content, speaker: line.speaker, dubbing_contract_version: planMarker.versionId, dubbing_contract: line.dubbing_contract }],
      fps: args.fps,
      timeline_end_ms: args.timeline_end_ms,
    })
  }
  if (!['generated', 'native-preserve'].includes(line.dubbing_contract.mode)) throw new Error('字幕合同模式无效')
  if (approvedCandidates.length !== 1) throw new Error('字幕必须精确命中一个当前 selected 配音及其八维审核')
  const [approved] = approvedCandidates
  const asset = approved && assets.assets?.[approved.asset_key]
  const version = asset?.versions?.find((item) => item.id === approved.version_id)
  if (asset?.type !== 'audio' || asset.selectedVersionId !== approved.version_id || asset.staleVersionIds?.includes(approved.version_id) || version?.sha256 !== approved.asset_sha256) throw new Error('字幕必须来自当前 selected、未失效且已通过八维审核的配音')
  const resolvedContract = await resolveGeneratedDubbingContract(root, { plan, planVersion: planMarker.versionId, line, audioVersion: version })
  const alignment = await finalSpeechAlignment(root, { asset_key: approved.asset_key, version_id: approved.version_id, sha256: approved.asset_sha256 })
  if (approved.timing_version_id !== alignment.version_id || alignment.document.audio_plan_version !== planMarker.versionId || alignment.document.line_index !== args.line_index) throw new Error('字幕必须绑定当前配音的最终词级对齐')
  const alignmentSource = alignment.document.source_timing
  const contractSource = resolvedContract.contract.timing_source
  if (alignmentSource.version_id !== contractSource.version_id || alignmentSource.line_index !== contractSource.line_index || alignmentSource.source_asset.asset_key !== contractSource.source_asset.asset_key || alignmentSource.source_asset.version_id !== contractSource.source_asset.version_id || alignmentSource.source_asset.sha256 !== contractSource.source_asset.sha256) throw new Error('最终词级对齐未绑定合同指定源 timing')
  const offset = alignment.document.timeline_mapping.timeline_at_ms - alignment.document.timeline_mapping.audio_in_ms
  const alignedWords = alignment.document.words.map((word) => ({ ...word, start_ms: word.start_ms + offset, end_ms: word.end_ms + offset }))
  const alignedLine = { line_index: args.line_index, start_ms: alignedWords[0].start_ms, end_ms: alignedWords.at(-1).end_ms, words: alignedWords, evidence: '最终 selected 配音词级对齐' }
  return buildSubtitlesFromAudio({
    audio: { asset_key: approved.asset_key, version_id: approved.version_id, sha256: approved.asset_sha256, line_index: args.line_index },
    timing: { version_id: alignment.version_id, lines: [alignedLine] },
    contracts: [{ line_index: args.line_index, content: line.content, speaker: line.speaker, dubbing_contract_version: planMarker.versionId, dubbing_contract: resolvedContract.contract }],
    fps: args.fps,
    timeline_end_ms: args.timeline_end_ms,
  })
}

async function compileCurrentDubbingRequest(args) {
  const loaded = await currentAudioPlanLine(args.project_root, args.episode_key, args.audio_plan_version, args.line_index)
  const previous = args.attempt === 3 ? await getDubbingAttemptContext(loaded.root, { episode_key: args.episode_key, line_index: args.line_index, attempt: 2 }) : null
  const compiled = compileGeneratedAudioArguments({
    providerArgs: { provider: args.provider, model: args.model, voice: args.voice, dubbing_attempt: args.attempt, ...(args.measured_speech_ms === undefined ? {} : { measured_speech_ms: args.measured_speech_ms }), ...(args.runninghub_mapping === undefined ? {} : { runninghub_mapping: args.runninghub_mapping }) },
    line: loaded.line,
    audioPlan: loaded.plan,
    audioPlanVersion: args.audio_plan_version,
    previousCompilerSnapshot: previous?.compiler,
    previousAttemptOutcome: previous?.outcome,
  })
  if (!compiled.compiled) throw new Error('当前 audio-plan 行不是 generated 配音合同')
  return { ...compiled.compiled, arguments: compiled.arguments }
}

async function reviewDubbingAlignment(args) {
  const verified = await verifiedAssetVersion(args.project_root, args.audio?.asset_key, args.audio?.version_id)
  if (verified.asset.type !== 'audio') throw new Error('最终对齐必须绑定音频候选')
  const document = structuredClone(args.alignment)
  const context = await getDubbingAttemptContext(args.project_root, { episode_key: document.episode_key, line_index: document.line_index, attempt: args.attempt })
  if (context.task.status !== 'completed' || context.task.target !== verified.asset.key || context.task.outputVersionId !== verified.version.id || verified.version.provenance?.task_id !== context.task.taskId) throw new Error('最终对齐未绑定已完成的配音生成任务')
  if (document.audio_asset?.asset_key !== verified.asset.key || document.audio_asset?.version_id !== verified.version.id || document.audio_asset?.sha256 !== verified.version.sha256) throw new Error('最终对齐音频 SHA 或版本不匹配')
  if (document.audio_plan_version !== context.compiler.contract_version || document.source_timing?.version_id !== context.compiler.timing_version) throw new Error('最终对齐未绑定请求快照的合同或 timing 版本')
  const textSha256 = createHash('sha256').update(String(document.text || '')).digest('hex')
  if (context.compiler.text_sha256 !== textSha256) throw new Error('最终对齐文本与持久化编译快照不一致')
  const stored = await putFinalSpeechAlignment(args.project_root, document)
  const fit = evaluateDubbingFit({ contract: { target_range: context.compiler.target_range }, alignment: { actual_start_ms: stored.timeline_range.start_ms, actual_end_ms: stored.timeline_range.end_ms }, timeline_fps: document.timeline_fps })
  const outcome = await recordDubbingAttemptOutcome(args.project_root, {
    episode_key: document.episode_key, line_index: document.line_index, attempt: context.compiler.attempt,
    alignment_version: stored.version_id, fit_passed: fit.passed, adaptation_approved: args.adaptation_approved,
    audio_asset: document.audio_asset,
  })
  return { alignment: stored, fit, outcome }
}

export async function call(name, args = {}) {
  if (name === 'list_generation_providers') return providerCatalog()
  if (name === 'analyze_speech_timing') {
    const selected = await selectedAssetVersion(args.project_root, args.source?.asset_key)
    if (selected.version.id !== args.source?.version_id) throw new Error('语音时间分析必须绑定当前 selected 来源资产')
    return putSpeechTimingCandidate(args.project_root, { ...structuredClone(args.timing), source_asset: { asset_key: selected.asset.key, version_id: selected.version.id, sha256: selected.version.sha256 }, reviewed: false })
  }
  if (name === 'review_speech_timing') {
    const { project_root: projectRoot, ...input } = args
    return reviewSpeechTiming(projectRoot, input)
  }
  if (name === 'review_dubbing_alignment') return reviewDubbingAlignment(args)
  if (name === 'compile_dubbing_request') return compileCurrentDubbingRequest(args)
  if (name === 'review_dubbing_performance') return putDubbingPerformanceReview(args.project_root, args.review)
  if (name === 'build_subtitles_from_audio') return buildTrustedSubtitles(args)
  if (name === 'list_music_catalogs') return listMusicCatalogs()
  if (name === 'search_music_catalog') {
    const compiled = args.query ? null : compileMusicSearch(args)
    return { ...(compiled ? { compiled } : {}), ...await searchMusicCatalog({ ...args, query: args.query || compiled.query }) }
  }
  if (name === 'register_licensed_music') return registerLicensedMusic(args)
  if (name === 'list_media_hosts') return mediaHostCatalog()
  if (name === 'prepare_previous_tail') return preparePreviousTail({ projectRoot: args.project_root, episodeKey: args.episode_key, shotNumber: args.shot_number, continuityVersion: args.continuity_version })
  if (name === 'submit_media_operation') return submitMediaOperation(args)
  if (name === 'get_media_operation') return getMediaOperation(args)
  if (name === 'register_media_operation_output') return registerMediaOperationOutput(args)
  if (name === 'review_media_operation') {
    const { project_root: projectRoot, ...review } = args
    return putMediaOperationReview(projectRoot, review)
  }
  if (name === 'import_external_audio') return importExternalAudio(args)
  if (name === 'generate_audio_fallback') return generateAudioFallback(args)
  if (name === 'list_reference_uploads') {
    const { project_root: projectRoot, ...filters } = args
    return listReferenceUploads(projectRoot, filters)
  }
  if (name === 'publish_reference_image') {
    const { project_root: projectRoot, ...input } = args
    return publishReferenceImage(projectRoot, input)
  }
  if (name === 'design_voice') return designVoice(args)
  if (name === 'clone_voice') return cloneVoice(args)
  if (name === 'list_voices') return listVoices(args)
  if (name === 'delete_voice') return deleteVoice(args)
  if (name === 'ensure_reference_urls') return ensureReferenceUrls(args)
  if (name === 'submit_episode_videos') return submitEpisodeVideos(args)
  if (name === 'submit_episode_images') return submitEpisodeImages(args)
  if (name === 'await_episode_tasks') return awaitEpisodeTasks(args)
  if (name === 'submit_video') {
    const { project_root: projectRoot, target, prompt_document: promptDocument, ...providerArgs } = args
    return submitVideoOnce(projectRoot, target, promptDocument, providerArgs)
  }
  const selected = adapter(args.provider)
  const actions = { list_models: 'models', generate_image: 'image', generate_audio: 'audio', generate_music: 'music', transcribe_audio: 'transcribe', translate_audio: 'translate', submit_video: 'submitVideo', get_generation_task: 'task' }
  const action = actions[name]
  if (!action) throw new Error(`未知工具：${name}`)
  if (name === 'get_generation_task') {
    const { project_root: projectRoot, ...providerArgs } = args
    return syncTaskResult(projectRoot, args.task_id, await selected[action](providerArgs))
  }
  if (['transcribe_audio', 'translate_audio'].includes(name)) {
    if (args.provider !== 'starrouter') throw new Error(`${name} 当前仅支持 StarRouter`)
    const [root, file] = await Promise.all([realpath(resolve(args.project_root)), realpath(resolve(args.file_path))])
    const assetRoot = await realpath(resolve(root, 'assets'))
    if (file !== assetRoot && !file.startsWith(`${assetRoot}${sep}`)) throw new Error('ASR 只能读取当前项目 assets/ 内文件')
    const { project_root, file_path, ...providerArgs } = args
    return selected[action]({ ...providerArgs, file_path: file })
  }
  if (!['generate_image', 'generate_audio', 'generate_music'].includes(name)) return selected[action](args)
  if (typeof selected[action] !== 'function') throw new Error(`${args.provider} 不支持 ${name}`)
  const { project_root: projectRoot, target, prompt_document: promptDocument, dubbing_compiler_snapshot: fallbackCompilerSnapshot, [TRUSTED_AUDIO_FALLBACK]: trustedAudioFallback, ...rawProviderArgs } = args
  let providerArgs = { ...rawProviderArgs }
  await enforceGenerationStage(projectRoot, name, target)
  if (args.provider === 'runninghub') {
    const workflowEnv = name === 'generate_image' ? 'RUNNINGHUB_IMAGE_WORKFLOW_ID' : 'RUNNINGHUB_AUDIO_WORKFLOW_ID'
    if (providerArgs.model !== 'krea2-normal-v1') providerArgs.workflow_id ||= process.env[workflowEnv]
  }
  const type = name === 'generate_image' ? 'image' : 'audio'
  const documentReference = await validateProjectInputs(projectRoot, type, target, promptDocument, args.provider, providerArgs, name === 'generate_music' ? 'music' : type)
  if (trustedAudioFallback && (!fallbackCompilerSnapshot?.derived_contract || JSON.stringify(fallbackCompilerSnapshot.derived_contract) !== JSON.stringify(trustedAudioFallback.derived_contract))) throw new Error('兜底配音缺少已持久化的派生合同绑定')
  const previousDubbing = name === 'generate_audio' && documentReference?.line && !trustedAudioFallback && providerArgs.dubbing_attempt === 3
    ? await getDubbingAttemptContext(projectRoot, { episode_key: promptDocument.episode_key, line_index: promptDocument.line_index, attempt: 2 })
    : null
  const compiledAudio = name === 'generate_audio' && documentReference?.line && !trustedAudioFallback
    ? compileGeneratedAudioArguments({ providerArgs, line: documentReference.line, audioPlan: documentReference.document, audioPlanVersion: promptDocument.version_id, previousCompilerSnapshot: previousDubbing?.compiler, previousAttemptOutcome: previousDubbing?.outcome })
    : null
  if (compiledAudio) providerArgs = compiledAudio.arguments
  const snapshot = await createRequestSnapshot(projectRoot, { tool: name, target, type, provider: args.provider, modelOrWorkflow: providerArgs.model || providerArgs.workflow_id, promptDocument, arguments: providerArgs, ...((compiledAudio?.compiled || fallbackCompilerSnapshot) ? { dubbing_compiler: compiledAudio?.compiled?.snapshot || fallbackCompilerSnapshot } : {}) })
  await reserveTask(projectRoot, { taskId: snapshot.requestId, target, type, provider: args.provider, requestPath: snapshot.requestPath })
  let result
  try {
    result = await selected[action](providerArgs)
  } catch (error) {
    await settleReservedTask(projectRoot, snapshot.requestId, { status: 'failed' })
    throw error
  }
  const taskId = result.task_id || snapshot.requestId
  await settleReservedTask(projectRoot, snapshot.requestId, { taskId, status: result.status === 'submitted' ? 'queued' : 'running' })
  const tracked = { ...result, task_id: taskId, request_id: snapshot.requestId, request_path: snapshot.requestPath, request_sha256: snapshot.requestSha256 }
  return result.status === 'completed' ? syncTaskResult(projectRoot, taskId, tracked) : tracked
}

async function submitEpisodeImages({ project_root: projectRoot, items, confirmed }) {
  if (!Array.isArray(items) || !items.length) throw new Error('items 必须是非空图片任务数组')
  if (typeof confirmed !== 'boolean') throw new Error('confirmed 必须是布尔值：false 仅出摘要，true 并发提交')
  const checks = await Promise.all(items.map(async (item, index) => {
    try {
      const selected = adapter(item.provider)
      if (typeof selected.image !== 'function') throw new Error(`${item.provider} 不支持 generate_image`)
      const { target, prompt_document: promptDocument, ...rawProviderArgs } = item
      const providerArgs = { ...rawProviderArgs, confirmed: true }
      await enforceGenerationStage(projectRoot, 'generate_image', target)
      if (item.provider === 'runninghub' && providerArgs.model !== 'krea2-normal-v1') providerArgs.workflow_id ||= process.env.RUNNINGHUB_IMAGE_WORKFLOW_ID
      await validateProjectInputs(projectRoot, 'image', target, promptDocument, item.provider, providerArgs)
      return { index, ok: true, target, provider: item.provider, model: providerArgs.model || providerArgs.workflow_id, prompt_document: promptDocument, parameters: Object.fromEntries(['resolution', 'aspect_ratio', 'size', 'n', 'quality'].filter((key) => providerArgs[key] !== undefined).map((key) => [key, providerArgs[key]])) }
    } catch (error) { return { index, ok: false, target: item.target || null, provider: item.provider || null, error: error.message } }
  }))
  const errors = checks.filter((item) => !item.ok)
  if (!confirmed) return { phase: 'plan', ready: errors.length === 0, count: items.length, items: checks }
  if (errors.length) throw new Error(`整批图片校验未通过，未提交任何任务：\n${errors.map((item) => `${item.target || `第${item.index + 1}项`}：${item.error}`).join('\n')}`)
  const outcomes = await mapWithConcurrency(items, 4, (item) => call('generate_image', { ...item, project_root: projectRoot, confirmed: true }))
  return { phase: 'submitted', count: items.length, submitted: outcomes.flatMap((outcome, index) => outcome.status === 'fulfilled' ? [{ index, target: items[index].target, ...outcome.value }] : []), failed: outcomes.flatMap((outcome, index) => outcome.status === 'rejected' ? [{ index, target: items[index].target, error: outcome.reason?.message || String(outcome.reason) }] : []) }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  async function consume() {
    while (cursor < items.length) {
      const index = cursor++
      try { results[index] = { status: 'fulfilled', value: await worker(items[index], index) } }
      catch (reason) { results[index] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume))
  return results
}

function serve() {
  createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message.method === 'notifications/initialized') return
    try {
      if (message.method === 'initialize') return ok(message.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'drama-generation', version: '0.4.0' } })
      if (message.method === 'tools/list') return ok(message.id, { tools })
      if (message.method === 'tools/call') return ok(message.id, { content: [{ type: 'text', text: JSON.stringify(await call(message.params?.name, message.params?.arguments)) }] })
      fail(message.id, new Error(`不支持的方法：${message.method}`))
    } catch (error) { fail(message.id, error) }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === '--self-check') {
    selfCheck()
    console.log('ok')
  } else serve()
}
