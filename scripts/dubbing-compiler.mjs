import { weightedLength } from './generation/bailian.mjs'
import { validateDubbingContract } from './audio-plan-contract.mjs'

export const CAPABILITIES = Object.freeze({
  bailian: { instruction: new Set(['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3-flash']) },
  starrouter: { minimax: new Set(['speech-2.8-hd', 'speech-2.8-turbo']), openai: new Set(['tts-1']) },
})

const MIN_SPEED = 0.85
const MAX_SPEED = 1.15
const RUNNINGHUB_PATHS = new Set(['text', 'speed', 'instruction'])
const VERSION = /^v\d{3}$/

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value) {
  return typeof value === 'string' && value.trim()
}

function targetSpeechMs(contract) {
  return Number.isInteger(contract?.target_speech_ms) && contract.target_speech_ms > 0 ? contract.target_speech_ms : null
}

function textVersion(contract) {
  if (requiredString(contract?.text_version)) return contract.text_version
  return contract?.original_text === contract?.adapted_text ? 'original' : 'adapted'
}

function snapshotFor(input, capabilityGaps = []) {
  const contract = plainObject(input?.contract) ? input.contract : {}
  const targetRange = plainObject(contract.target_range)
    ? { start_ms: contract.target_range.start_ms, end_ms: contract.target_range.end_ms }
    : null
  return {
    contract_version: VERSION.test(input?.dubbing_contract_version || '') ? input.dubbing_contract_version : requiredString(input?.dubbing_contract_version) ? 'invalid' : 'missing',
    timing_version: requiredString(contract.timing_source?.version_id) ? contract.timing_source.version_id : null,
    target_range: targetRange,
    target_speech_ms: targetSpeechMs(contract),
    text_version: textVersion(contract),
    attempt: Number.isInteger(input?.attempt) ? input.attempt : 1,
    capability_gaps: [...capabilityGaps],
  }
}

function result(input, argumentsValue, capabilityGaps = []) {
  return {
    supported: capabilityGaps.length === 0,
    arguments: capabilityGaps.length === 0 ? argumentsValue : null,
    capability_gaps: [...capabilityGaps],
    snapshot: snapshotFor(input, capabilityGaps),
  }
}

export function unsupported(reason, input = {}) {
  return result(input, null, [reason])
}

export function calibratedSpeed(contract, attempt = 1, measuredSpeechMs) {
  if (!Number.isInteger(attempt) || attempt < 1) return Number.NaN
  if (attempt === 1 && measuredSpeechMs === undefined) return 1
  const target = targetSpeechMs(contract)
  if (!target || !Number.isInteger(measuredSpeechMs) || measuredSpeechMs <= 0) return Number.NaN
  return Number((measuredSpeechMs / target).toFixed(2))
}

function validateContract(input) {
  const voiceBinding = input?.voice_binding ?? input?.voiceBinding
  const authorizedVoiceBindings = input?.authorized_voice_bindings ?? input?.authorizedVoiceBindings
  if (!plainObject(voiceBinding) || voiceBinding.voice_id !== input?.voice || !Array.isArray(authorizedVoiceBindings)) return false
  try {
    validateDubbingContract(input.contract, {
      deliveryMode: input.delivery_mode ?? 'post_dub',
      presentation: input.presentation ?? 'visible-dialogue',
      voiceBinding,
      authorizedVoiceBindings,
    })
    return true
  } catch {
    return false
  }
}

function languageHint(text) {
  return /[\u3400-\u9fff]/u.test(text) ? 'zh' : 'en'
}

function emotionArc(performance) {
  return performance.emotion_arc
    .map((beat) => `${String(beat.at)}|${beat.emotion.trim()}|${String(beat.intensity)}`)
    .join('→')
}

function requiredDirection(contract) {
  const performance = contract.performance
  const pauses = performance.pause_plan.map((pause) => `${pause.after}后停${pause.duration_ms}毫秒`).join('、')
  return `意图：${performance.intent.trim()}；情绪弧：${emotionArc(performance)}；重音：${performance.emphasis.map((item) => item.trim()).join('、')}；停连：${pauses}`
}

function fullDirection(contract) {
  const performance = contract.performance
  return `${requiredDirection(contract)}；潜台词：${performance.subtext?.trim() || ''}；节奏：${performance.pace?.trim() || ''}；呼吸：${performance.breath?.trim() || ''}；空间：${performance.distance_and_space?.trim() || ''}`
}

function directionWithinCosyVoiceLimit(contract) {
  const direction = requiredDirection(contract)
  return weightedLength(direction) <= 100 ? direction : null
}

function singleEmotion(performance) {
  return performance.emotion_arc.length === 1 ? performance.emotion_arc[0].emotion.trim() : null
}

export function compileCosyVoice(input, speed) {
  if (!CAPABILITIES.bailian.instruction.has(input.model)) return unsupported('style-instruction', input)
  const instruction = directionWithinCosyVoiceLimit(input.contract)
  if (!instruction) return unsupported('style-instruction-length', input)
  return result(input, {
    model: input.model,
    voice: input.voice,
    input: input.contract.adapted_text,
    speed,
    language_hints: languageHint(input.contract.adapted_text),
    instruction,
  })
}

export function compileMiniMax(input, speed) {
  const emotion = singleEmotion(input.contract.performance)
  if (!emotion) return unsupported('emotion-arc', input)
  return result(input, {
    model: input.model,
    voice: input.voice,
    input: input.contract.adapted_text,
    speed,
    metadata: {
      voice_setting: { speed, emotion },
      pronunciation_dict: {},
    },
  })
}

export function compileOpenAiCompatible(input, speed) {
  return result(input, {
    model: input.model,
    voice: input.voice,
    input: input.contract.adapted_text,
    speed,
    instructions: fullDirection(input.contract),
  })
}

function mappedPath(value) {
  return typeof value === 'string' ? value.replace(/^\$\.?/, '') : ''
}

export function compileRunningHub(input, speed) {
  const mapping = input.runninghub_mapping
  if (!plainObject(mapping) || !requiredString(mapping.workflow_id) || !Array.isArray(mapping.node_info_list) || mapping.node_info_list.length === 0) return unsupported('runninghub-mapping-required', input)
  const values = {
    text: input.contract.adapted_text,
    speed,
    instruction: requiredDirection(input.contract),
  }
  const allowed = new Set()
  const nodeInfoList = []
  for (const field of mapping.node_info_list) {
    const path = mappedPath(field?.json_path)
    if (!requiredString(field?.nodeId) || !requiredString(field?.fieldName) || !RUNNINGHUB_PATHS.has(path) || allowed.has(path)) return unsupported('runninghub-mapping-invalid', input)
    allowed.add(path)
    nodeInfoList.push({ nodeId: field.nodeId, fieldName: field.fieldName, fieldValue: values[path] })
  }
  if (['text', 'speed', 'instruction'].some((path) => !allowed.has(path))) return unsupported('runninghub-mapping-incomplete', input)
  return result(input, { workflow_id: mapping.workflow_id, node_info_list: nodeInfoList })
}

export function compileDubbingRequest(input) {
  if (!plainObject(input) || !requiredString(input.provider) || !requiredString(input.model) || !requiredString(input.voice)) return unsupported('invalid-dubbing-contract', input)
  if (!requiredString(input.dubbing_contract_version)) return unsupported('dubbing-contract-version-required', input)
  if (!VERSION.test(input.dubbing_contract_version)) return unsupported('dubbing-contract-version-invalid', input)
  if (!validateContract(input)) return unsupported('invalid-dubbing-contract', input)
  const attempt = input.attempt ?? 1
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > input.contract.fit_policy?.max_paid_generations) return unsupported('attempt-out-of-policy', input)
  const speed = calibratedSpeed(input.contract, attempt, input.measured_speech_ms)
  if (!Number.isFinite(speed)) return unsupported('invalid-measured-speech-duration', input)
  if (speed < MIN_SPEED || speed > MAX_SPEED) return unsupported('speed-out-of-policy', input)
  if (input.provider === 'bailian') return compileCosyVoice(input, speed)
  if (input.provider === 'starrouter' && CAPABILITIES.starrouter.minimax.has(input.model)) return compileMiniMax(input, speed)
  if (input.provider === 'starrouter' && CAPABILITIES.starrouter.openai.has(input.model)) return compileOpenAiCompatible(input, speed)
  if (input.provider === 'runninghub') return compileRunningHub(input, speed)
  return unsupported('provider-model-not-supported', input)
}
