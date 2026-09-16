import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { validateDubbingContract } from './audio-plan-contract.mjs'

const VERSION = /^v\d{3}$/
const SHA256 = /^[0-9a-f]{64}$/

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

async function readDerivedContract(root, reference) {
  if (!reference || typeof reference.path !== 'string' || !SHA256.test(reference.sha256 || '')) throw new Error('兜底音频缺少派生合同引用')
  const path = resolve(root, reference.path)
  const directory = resolve(root, 'episodes')
  if (!path.startsWith(`${directory}${sep}`) || !/\/audio-plan\/fallback-contracts\/line-\d{3}-[0-9a-f]{16}\.json$/.test(path)) throw new Error('兜底派生合同路径不可信')
  const actual = await realpath(path)
  if (actual !== path || !actual.startsWith(`${directory}${sep}`)) throw new Error('兜底派生合同真实路径越界')
  const record = JSON.parse(await readFile(actual, 'utf8'))
  if (createHash('sha256').update(JSON.stringify(record)).digest('hex') !== reference.sha256) throw new Error('兜底派生合同 SHA 不匹配')
  return record
}

export async function resolveGeneratedDubbingContract(rootArg, { plan, planVersion, line, audioVersion }) {
  const root = await realpath(resolve(rootArg))
  if (!line || !plan || !VERSION.test(planVersion || '')) throw new Error('配音合同解析上下文无效')
  if (line.dubbing_contract?.mode === 'generated') {
    return { contract: line.dubbing_contract, source: 'audio-plan', derived_reference: null }
  }
  if (line.dubbing_contract?.mode !== 'native-preserve' || !audioVersion) throw new Error('当前音频没有可消费的 generated 配音合同')
  const compiler = audioVersion.provenance?.parameters?.dubbing_compiler
  if (!compiler?.snapshot || !SHA256.test(compiler.sha256 || '') || fingerprint(compiler.snapshot) !== compiler.sha256) throw new Error('兜底音频配音编译快照不可信')
  const snapshot = compiler.snapshot
  if (snapshot.episode_key !== plan.episode_key || snapshot.line_index !== line.line_index || snapshot.contract_version !== planVersion) throw new Error('兜底音频编译快照与当前 audio-plan 不一致')
  const record = await readDerivedContract(root, snapshot.derived_contract)
  if (record.version !== 1 || record.episode_key !== plan.episode_key || record.line_index !== line.line_index || record.audio_plan_version !== planVersion || !record.native_audio_exception || !record.voice_binding) throw new Error('兜底派生合同未绑定当前原声异常、行或音色')
  const nativeSource = line.dubbing_contract.timing_source?.source_asset
  if (record.source_video?.asset_key !== nativeSource?.asset_key || record.source_video?.version_id !== nativeSource?.version_id) throw new Error('兜底派生合同未绑定 native-preserve 的原声来源')
  if (record.generated_contract?.timing_source?.version_id !== snapshot.timing_version || JSON.stringify(record.generated_contract?.target_range) !== JSON.stringify(snapshot.target_range)) throw new Error('兜底派生合同与编译快照的 timing 或目标区间不一致')
  validateDubbingContract(record.generated_contract, { deliveryMode: 'post_dub', presentation: line.presentation, voiceBinding: record.voice_binding, authorizedVoiceBindings: plan.voice_bindings })
  return { contract: record.generated_contract, source: 'native-fallback', derived_reference: snapshot.derived_contract, record }
}
