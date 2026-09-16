const DELIVERY = new Set(['native', 'post_dub', 'external_audio'])
const PRESENTATION = new Set(['visible-dialogue', 'offscreen-dialogue', 'narration'])
const FALLBACK = new Set(['none', 'post-dub', 'cinematic-tts', 'sound-design'])
export const NATIVE_AUDIO_FAILURE_REASONS = Object.freeze(['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed'])
const FAILURE_REASONS = new Set(NATIVE_AUDIO_FAILURE_REASONS)
const PERFORMANCE_FIELDS = ['tone_arc', 'emotion_beats', 'pace', 'breath_and_pause', 'distance_and_space']
const MUSIC_PURPOSES = new Set(['op', 'ed', 'bgm', 'music-video'])

const assetReference = (value) => value && typeof value.asset_key === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.asset_key) && /^v\d{3}$/.test(value.version_id || '')

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label} 字段无效`)
}

const nonEmptyString = (value) => typeof value === 'string' && value.trim()

function validateRange(value, label) {
  exactKeys(value, ['start_ms', 'end_ms'], label)
  if (!Number.isInteger(value.start_ms) || !Number.isInteger(value.end_ms) || value.start_ms < 0 || value.end_ms <= value.start_ms) throw new Error(`${label} 无效`)
  return value
}

function validateTimingSource(value) {
  exactKeys(value, ['episode_key', 'version_id', 'line_index', 'source_asset'], 'dubbing_contract.timing_source')
  if (!/^ep-\d{3}$/.test(value.episode_key || '') || !/^v\d{3}$/.test(value.version_id || '') || !Number.isInteger(value.line_index) || value.line_index <= 0) throw new Error('dubbing_contract.timing_source 无效')
  exactKeys(value.source_asset, ['asset_key', 'version_id', 'sha256'], 'dubbing_contract.timing_source.source_asset')
  if (!assetReference(value.source_asset) || !/^[0-9a-f]{64}$/.test(value.source_asset.sha256)) throw new Error('dubbing_contract.timing_source.source_asset 无效')
  return value
}

function validateEmotionArc(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} 必填`)
  for (const [index, beat] of value.entries()) {
    exactKeys(beat, ['at', 'emotion', 'intensity'], `${label}[${index}]`)
    if (!Number.isFinite(beat.at) || beat.at < 0 || beat.at > 1 || !nonEmptyString(beat.emotion) || !Number.isFinite(beat.intensity) || beat.intensity < 0 || beat.intensity > 1) throw new Error(`${label}[${index}] 无效`)
  }
  return value
}

function validatePausePlan(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} 必填`)
  value.forEach((pause, index) => {
    exactKeys(pause, ['after', 'duration_ms'], `${label}[${index}]`)
    if (!nonEmptyString(pause.after) || !Number.isInteger(pause.duration_ms) || pause.duration_ms <= 0) throw new Error(`${label}[${index}] 无效`)
  })
  return value
}

function validatePerformanceReference(value) {
  exactKeys(value, ['intent', 'subtext', 'emotion_arc', 'emphasis', 'pause_plan', 'breath'], 'dubbing_contract.performance_reference')
  if (!nonEmptyString(value.intent) || !nonEmptyString(value.subtext) || !Array.isArray(value.emphasis) || value.emphasis.length === 0 || value.emphasis.some((item) => !nonEmptyString(item)) || !nonEmptyString(value.breath)) throw new Error('dubbing_contract.performance_reference 无效')
  validateEmotionArc(value.emotion_arc, 'dubbing_contract.performance_reference.emotion_arc')
  validatePausePlan(value.pause_plan, 'dubbing_contract.performance_reference.pause_plan')
  return value
}

function validateGeneratedPerformance(value) {
  exactKeys(value, ['intent', 'subtext', 'emotion_arc', 'pace', 'emphasis', 'pause_plan', 'breath', 'distance_and_space'], 'dubbing_contract.performance')
  for (const field of ['intent', 'subtext', 'pace', 'breath', 'distance_and_space']) if (!nonEmptyString(value[field])) throw new Error(`dubbing_contract.performance.${field} 必填`)
  if (!Array.isArray(value.emphasis) || value.emphasis.length === 0 || value.emphasis.some((item) => !nonEmptyString(item))) throw new Error('dubbing_contract.performance.emphasis 无效')
  validateEmotionArc(value.emotion_arc, 'dubbing_contract.performance.emotion_arc')
  validatePausePlan(value.pause_plan, 'dubbing_contract.performance.pause_plan')
  return value
}

function validateNativePreserve(contract, deliveryMode) {
  exactKeys(contract, ['mode', 'timing_source', 'target_range', 'performance_reference'], 'dubbing_contract.native-preserve')
  if (deliveryMode !== 'native') throw new Error('dubbing_contract.native-preserve 只能用于 native')
  validateTimingSource(contract.timing_source)
  validateRange(contract.target_range, 'dubbing_contract.target_range')
  validatePerformanceReference(contract.performance_reference)
  return contract
}

function validateGenerated(contract, voiceBinding, authorizedVoiceBindings) {
  exactKeys(contract, ['mode', 'timing_source', 'target_range', 'target_speech_ms', 'original_text', 'adapted_text', 'adaptation', 'performance', 'fit_policy'], 'dubbing_contract.generated')
  validateTimingSource(contract.timing_source)
  const targetRange = validateRange(contract.target_range, 'dubbing_contract.target_range')
  if (!Number.isInteger(contract.target_speech_ms) || contract.target_speech_ms <= 0 || contract.target_speech_ms > targetRange.end_ms - targetRange.start_ms) throw new Error('dubbing_contract.target_speech_ms 无效')
  if (!nonEmptyString(contract.original_text) || !nonEmptyString(contract.adapted_text)) throw new Error('dubbing_contract 原文与适配文本必填')
  if (contract.original_text === contract.adapted_text) {
    if (contract.adaptation !== null) throw new Error('dubbing_contract.adaptation 仅适用于文本适配')
  } else {
    exactKeys(contract.adaptation, ['reason', 'preserved_facts', 'preserved_attitude', 'approved_by'], 'dubbing_contract.adaptation')
    if (!nonEmptyString(contract.adaptation.reason) || !Array.isArray(contract.adaptation.preserved_facts) || contract.adaptation.preserved_facts.length === 0 || contract.adaptation.preserved_facts.some((item) => !nonEmptyString(item)) || !nonEmptyString(contract.adaptation.preserved_attitude) || contract.adaptation.approved_by !== 'codex') throw new Error('dubbing_contract.adaptation 无效')
  }
  validateGeneratedPerformance(contract.performance)
  exactKeys(contract.fit_policy, ['max_paid_generations', 'provider_speed_min', 'provider_speed_max', 'max_post_tempo_percent', 'text_adaptation_allowed'], 'dubbing_contract.fit_policy')
  if (contract.fit_policy.max_paid_generations !== 3) throw new Error('dubbing_contract.fit_policy.max_paid_generations 必须为 3')
  if (contract.fit_policy.provider_speed_min !== 0.85) throw new Error('dubbing_contract.fit_policy.provider_speed_min 必须为 0.85')
  if (contract.fit_policy.provider_speed_max !== 1.15) throw new Error('dubbing_contract.fit_policy.provider_speed_max 必须为 1.15')
  if (contract.fit_policy.max_post_tempo_percent !== 3) throw new Error('dubbing_contract.fit_policy.max_post_tempo_percent 必须为 3')
  if (typeof contract.fit_policy.text_adaptation_allowed !== 'boolean' || contract.original_text !== contract.adapted_text && contract.fit_policy.text_adaptation_allowed !== true) throw new Error('dubbing_contract.fit_policy.text_adaptation_allowed 无效')
  if (!voiceBinding || !nonEmptyString(voiceBinding.voice_id)) throw new Error('dubbing_contract.generated 必须绑定已授权 voice_binding')
  if (authorizedVoiceBindings && (!Array.isArray(authorizedVoiceBindings) || !authorizedVoiceBindings.some((binding) => binding?.voice_id === voiceBinding.voice_id))) throw new Error('dubbing_contract.generated voice_binding 未获项目授权')
  return contract
}

export function validateDubbingContract(contract, { deliveryMode, presentation, voiceBinding = null, authorizedVoiceBindings } = {}) {
  if (contract?.mode === 'native-preserve') return validateNativePreserve(contract, deliveryMode)
  if (contract?.mode !== 'generated') throw new Error('dubbing_contract.mode 无效')
  if (!PRESENTATION.has(presentation)) throw new Error('dubbing_contract.presentation 无效')
  return validateGenerated(contract, voiceBinding, authorizedVoiceBindings)
}

export function validateMusicTrack(track, index = 0) {
  const label = `audio-plan music_tracks[${index}]`
  if (!/^(?:op|ed|bgm|music-video)(?:-[a-z0-9]+)*$/.test(track?.key || '') || !MUSIC_PURPOSES.has(track.purpose) || !Array.isArray(track.matched_shots) || track.matched_shots.some((shot) => !Number.isInteger(shot) || shot <= 0)) throw new Error(`${label} key/purpose/matched_shots 无效`)
  if (track.source_mode === 'generated') {
    exactKeys(track, ['key', 'purpose', 'title', 'source_mode', 'prompt', 'tags', 'lyrics', 'make_instrumental', 'provider', 'model', 'matched_shots'], label)
    for (const field of ['title', 'prompt', 'tags', 'provider', 'model']) if (typeof track[field] !== 'string' || !track[field].trim()) throw new Error(`${label}.${field} 必填`)
    if (typeof track.lyrics !== 'string' || typeof track.make_instrumental !== 'boolean' || track.make_instrumental && track.lyrics.trim()) throw new Error(`${label} 生成曲目内容无效`)
    return track
  }
  if (track.source_mode === 'catalog') {
    exactKeys(track, ['key', 'purpose', 'title', 'source_mode', 'source_asset', 'license_receipt', 'intended_use', 'matched_shots'], label)
    if (typeof track.title !== 'string' || !track.title.trim() || !assetReference(track.source_asset)) throw new Error(`${label} catalog 曲目必须绑定标题和资产`)
    if (!/^music-license-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(track.license_receipt || '')) throw new Error(`${label} catalog 曲目必须绑定许可证收据`)
    const use = track.intended_use
    if (!use || typeof use !== 'object' || Array.isArray(use) || Object.keys(use).some((key) => !['commercial', 'paid_ad', 'client_project', 'broadcast', 'platform'].includes(key)) || ['commercial', 'paid_ad', 'client_project', 'broadcast'].some((key) => typeof use[key] !== 'boolean') || use.platform !== undefined && (typeof use.platform !== 'string' || !use.platform.trim())) throw new Error(`${label} intended_use 无效`)
    return track
  }
  throw new Error(`${label}.source_mode 必须为 generated 或 catalog`)
}

export function validateAudioStrategy(strategy) {
  if (strategy?.mode !== 'native-first' || strategy.provider_selection !== 'prefer-native' || strategy.fallback_allowed !== true) throw new Error('audio_strategy 必须启用 native-first、prefer-native 与受控兜底')
  if (!Array.isArray(strategy.fallback_reasons) || strategy.fallback_reasons.length !== FAILURE_REASONS.size || new Set(strategy.fallback_reasons).size !== FAILURE_REASONS.size || strategy.fallback_reasons.some((reason) => !FAILURE_REASONS.has(reason))) throw new Error('audio_strategy fallback_reasons 不完整或包含重复值')
  return strategy
}

function validatePerformance(performance) {
  if (!performance || typeof performance !== 'object' || Array.isArray(performance)) return false
  return PERFORMANCE_FIELDS.every((field) => field === 'emotion_beats'
    ? Array.isArray(performance[field]) && performance[field].length > 0 && performance[field].every((item) => typeof item === 'string' && item.trim())
    : typeof performance[field] === 'string' && performance[field].trim())
}

export function validateAudioLine(line, index = 0, context = {}) {
  if (!DELIVERY.has(line?.delivery_mode)) throw new Error(`audio-plan lines[${index}].delivery_mode 无效`)
  if (!PRESENTATION.has(line.presentation)) throw new Error(`audio-plan lines[${index}].presentation 无效`)
  if (!FALLBACK.has(line.fallback_mode)) throw new Error(`audio-plan lines[${index}].fallback_mode 无效`)
  if (line.presentation === 'narration' && !validatePerformance(line.performance)) throw new Error(`audio-plan lines[${index}] 旁白必须提供完整电影感表演合同`)
  if (line.presentation !== 'narration' && line.performance !== null) throw new Error(`audio-plan lines[${index}] 非旁白 performance 必须为 null`)
  if (line.delivery_mode === 'external_audio' && !assetReference(line.source_audio)) throw new Error(`audio-plan lines[${index}] 外部音频必须绑定资产版本`)
  if (line.source_audio !== null && !assetReference(line.source_audio)) throw new Error(`audio-plan lines[${index}].source_audio 无效`)
  if (line.voice_binding !== null && (!line.voice_binding || typeof line.voice_binding !== 'object' || typeof line.voice_binding.voice_id !== 'string' || !line.voice_binding.voice_id.trim())) throw new Error(`audio-plan lines[${index}].voice_binding 无效`)
  if (line.native_audio_exception !== null) {
    const exception = line.native_audio_exception
    if (!FAILURE_REASONS.has(exception?.reason) || !exception.evidence || !Number.isInteger(exception.range?.start_ms) || !Number.isInteger(exception.range?.end_ms) || exception.range.start_ms < 0 || exception.range.end_ms <= exception.range.start_ms || !Array.isArray(exception.mix_sources) || exception.mix_sources.length === 0) throw new Error(`audio-plan lines[${index}] 原生音频兜底证据无效`)
  }
  validateDubbingContract(line.dubbing_contract, { deliveryMode: line.delivery_mode, presentation: line.presentation, voiceBinding: line.voice_binding, authorizedVoiceBindings: context.authorizedVoiceBindings })
  if (line.dubbing_contract.timing_source.line_index !== line.line_index) throw new Error(`audio-plan lines[${index}] dubbing_contract 必须引用同一行 speech-timing`)
  return line
}

export function validateAudioPlan(document, episodeKey) {
  if (!document || document.episode_key !== episodeKey) throw new Error('audio-plan episode_key 不一致')
  validateAudioStrategy(document.audio_strategy)
  if (!Array.isArray(document.lines)) throw new Error('audio-plan lines[] 必填')
  document.lines.forEach((line, index) => validateAudioLine(line, index, { authorizedVoiceBindings: document.voice_bindings }))
  if (document.music_tracks !== undefined) {
    if (!Array.isArray(document.music_tracks)) throw new Error('audio-plan music_tracks[] 必须是数组')
    document.music_tracks.forEach(validateMusicTrack)
  }
  if (!Array.isArray(document.unresolved) || typeof document.approved !== 'boolean') throw new Error('audio-plan unresolved/approved 无效')
  if (document.approved && document.unresolved.length) throw new Error('audio-plan 存在未决项时不得批准')
  return structuredClone(document)
}

export function migrateLegacyAudioLine(input) {
  const line = structuredClone(input || {})
  const legacy = line.delivery_mode
  const alreadyCurrent = DELIVERY.has(legacy) && PRESENTATION.has(line.presentation) && FALLBACK.has(line.fallback_mode) && line.dubbing_contract
  if (alreadyCurrent) return { line, unresolved: [] }
  const presentation = legacy === 'narration' ? 'narration' : legacy === 'offscreen' || line.visible_speaker === false ? 'offscreen-dialogue' : 'visible-dialogue'
  const lineIndex = Number.isInteger(line.line_index) ? line.line_index : '?'
  const deliveryMode = DELIVERY.has(legacy) ? legacy : null
  const canReferenceNative = deliveryMode === 'native' && assetReference(line.source_audio)
  return {
    line: { ...line, delivery_mode: deliveryMode, presentation, fallback_mode: 'none', source_audio: line.source_audio || null, voice_binding: line.voice_binding || null, native_audio_exception: null, performance: line.performance || null, dubbing_contract: canReferenceNative ? { mode: 'native-preserve', timing_source: null, target_range: line.range || null, performance_reference: null } : null },
    unresolved: [`第 ${lineIndex} 行声音来源缺少配音合同与时间证据${canReferenceNative ? '，需建立 speech-timing' : ''}`],
  }
}

export function migrateLegacyAudioPlan(input) {
  const document = structuredClone(input || {})
  const migratedTracks = document.music_tracks?.map((track) => track.source_mode ? track : { ...track, source_mode: 'generated' })
  const migrated = (document.lines || []).map(migrateLegacyAudioLine)
  const unresolved = [...(document.unresolved || []), ...migrated.flatMap((item) => item.unresolved)]
  const requiresLineMigration = migrated.some((item) => item.unresolved.length)
  return {
    document: {
      ...document,
      audio_strategy: document.audio_strategy || { mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: [...NATIVE_AUDIO_FAILURE_REASONS] },
      lines: migrated.map((item) => item.line),
      ...(migratedTracks ? { music_tracks: migratedTracks } : {}),
      unresolved,
      approved: requiresLineMigration || !document.audio_strategy ? false : document.approved,
    },
    unresolved,
  }
}
