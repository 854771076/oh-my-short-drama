import { weightedLength } from './generation/bailian.mjs'

export const CAPABILITIES = Object.freeze({
  bailian: { instruction: new Set(['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3-flash']) },
  starrouter: { minimax: new Set(['speech-2.8-hd', 'speech-2.8-turbo']), openai: new Set(['tts-1']) },
})

const MIN_SPEED = 0.85
const MAX_SPEED = 1.15
const RUNNINGHUB_PATHS = new Set(['text', 'speed', 'instruction'])

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
    contract_version: requiredString(input?.dubbing_contract_version) ? input.dubbing_contract_version : requiredString(input?.contract_version) ? input.contract_version : requiredString(contract.contract_version) ? contract.contract_version : null,
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

function validateContract(contract) {
  const performance = contract?.performance
  const fitPolicy = contract?.fit_policy
  const targetRange = contract?.target_range
  if (contract?.mode !== 'generated' || !targetSpeechMs(contract) || !requiredString(contract?.adapted_text) || !plainObject(performance) || !plainObject(targetRange) || !plainObject(fitPolicy)) return false
  if (!Number.isInteger(targetRange.start_ms) || !Number.isInteger(targetRange.end_ms) || targetRange.start_ms < 0 || targetRange.end_ms <= targetRange.start_ms || contract.target_speech_ms > targetRange.end_ms - targetRange.start_ms) return false
  if (fitPolicy.max_paid_generations !== 3 || fitPolicy.provider_speed_min !== MIN_SPEED || fitPolicy.provider_speed_max !== MAX_SPEED || fitPolicy.max_post_tempo_percent !== 3 || typeof fitPolicy.text_adaptation_allowed !== 'boolean') return false
  return requiredString(performance.intent)
    && requiredString(performance.subtext)
    && Array.isArray(performance.emotion_arc) && performance.emotion_arc.length > 0
    && performance.emotion_arc.every((beat) => requiredString(beat?.emotion))
    && Array.isArray(performance.emphasis) && performance.emphasis.length > 0 && performance.emphasis.every(requiredString)
    && Array.isArray(performance.pause_plan) && performance.pause_plan.length > 0
    && performance.pause_plan.every((pause) => requiredString(pause?.after) && Number.isInteger(pause.duration_ms) && pause.duration_ms > 0)
    && requiredString(performance.pace)
    && requiredString(performance.breath)
    && requiredString(performance.distance_and_space)
}

function languageHint(text) {
  return /[\u3400-\u9fff]/u.test(text) ? 'zh' : 'en'
}

function emotionTurn(performance) {
  const beats = performance.emotion_arc
  const first = beats[0].emotion.trim()
  const last = beats.at(-1).emotion.trim()
  return first === last ? first : `${first}→${last}`
}

function requiredDirection(contract) {
  const performance = contract.performance
  const pauses = performance.pause_plan.map((pause) => `${pause.after}后停${pause.duration_ms}毫秒`).join('、')
  return `意图：${performance.intent.trim()}；情绪：${emotionTurn(performance)}；重音：${performance.emphasis.map((item) => item.trim()).join('、')}；停连：${pauses}`
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
  const emotions = [...new Set(performance.emotion_arc.map((beat) => beat.emotion.trim()))]
  return emotions.length === 1 ? emotions[0] : null
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
    instruction: directionWithinCosyVoiceLimit(input.contract),
  }
  if (!values.instruction) return unsupported('style-instruction-length', input)
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
  if (!plainObject(input) || !requiredString(input.provider) || !requiredString(input.model) || !requiredString(input.voice) || !validateContract(input.contract)) return unsupported('invalid-dubbing-contract', input)
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
