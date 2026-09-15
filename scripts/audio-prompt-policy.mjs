import { validateAudioLine, validateAudioStrategy } from './audio-plan-contract.mjs'

function eligibleCandidates(candidates, visualCapabilities) {
  if (!Array.isArray(candidates)) throw new Error('视频 Provider 候选列表必填')
  return candidates.filter((candidate) => candidate && typeof candidate.provider === 'string' && typeof candidate.model === 'string' && visualCapabilities.every((capability) => candidate.capabilities?.[capability] === true))
}

export function selectVideoProviderForAudio({ requestedProvider, visualCapabilities = [], audioStrategy, candidates }) {
  validateAudioStrategy({ ...audioStrategy, fallback_reasons: audioStrategy?.fallback_reasons || ['provider-no-native-audio', 'voice-identity-drift', 'speech-intelligibility-failed', 'narration-performance-failed', 'audio-sync-failed', 'native-ambience-failed'] })
  const eligible = eligibleCandidates(candidates, visualCapabilities)
  if (requestedProvider) {
    const locked = eligible.find((candidate) => candidate.provider === requestedProvider)
    if (!locked) throw new Error('锁定 Provider 不满足画面资产能力')
    const nativeAudio = locked.capabilities?.['video.native-audio'] === true
    return { provider: locked.provider, model: locked.model, native_audio: nativeAudio, reasons: [nativeAudio ? 'video.native-audio' : 'provider-no-native-audio'] }
  }
  const selected = eligible.find((candidate) => candidate.capabilities?.['video.native-audio'] === true) || eligible[0]
  if (!selected) throw new Error('没有满足画面与音频约束的视频 Provider')
  const nativeAudio = selected.capabilities?.['video.native-audio'] === true
  return { provider: selected.provider, model: selected.model, native_audio: nativeAudio, reasons: [nativeAudio ? 'video.native-audio' : 'provider-no-native-audio'] }
}

const range = (value) => Number.isInteger(value?.start_ms) && Number.isInteger(value?.end_ms) ? `${value.start_ms}–${value.end_ms} ms` : 'the confirmed shot interval'

export function validateShotAudioPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('镜头 audio_policy 必须是对象')
  if (policy.audio_strategy) validateAudioStrategy(policy.audio_strategy)
  if (!Array.isArray(policy.lines)) throw new Error('镜头 audio_policy.lines[] 必填')
  policy.lines.forEach((line, index) => validateAudioLine({ ...line, line_index: line.line_index || index + 1 }, index))
  if (policy.no_undeclared_bgm !== true) throw new Error('镜头 audio_policy 必须明确禁止未声明 BGM')
  return policy
}

export function compileAudioPolicy(shot) {
  const policy = shot?.audio_policy
  validateShotAudioPolicy(policy)
  const output = []
  for (const line of policy.lines) {
    const when = range(line.range)
    if (line.delivery_mode !== 'native') {
      output.push(`${when}: ${line.presentation} ${line.speaker || 'speaker'} performs the exact timing of ${JSON.stringify(line.content || '')}, but generate ambience and action sound only; no finished speech.`)
      continue
    }
    if (line.presentation === 'narration') {
      const performance = line.performance || {}
      output.push(`${when}: off-screen narration ${JSON.stringify(line.content || '')}; tone arc ${performance.tone_arc}; emotion beats ${(performance.emotion_beats || []).join(' -> ')}; pace ${performance.pace}; breath and pause ${performance.breath_and_pause}; distance and space ${performance.distance_and_space}; every visible character keeps natural closed lips.`)
    } else if (line.presentation === 'offscreen-dialogue') {
      output.push(`${when}: ${line.speaker} speaks off screen, exact words ${JSON.stringify(line.content || '')}; visible non-speakers keep natural closed lips.`)
    } else {
      output.push(`${when}: visible speaker ${line.speaker} says exact words ${JSON.stringify(line.content || '')} with synchronized natural mouth motion.`)
    }
  }
  for (const item of policy.ambience || []) output.push(`${range(item.range)}: native ambience ${item.sound}.`)
  for (const item of policy.action_sounds || []) output.push(`${range(item.range)}: synchronized physical action sound ${item.sound}.`)
  output.push('Generate no undeclared BGM; background sound here means ambience and physical action sound only. Licensed score is handled independently.')
  return output.join('\n')
}
