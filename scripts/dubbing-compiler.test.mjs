import test from 'node:test'
import assert from 'node:assert/strict'
import { weightedLength } from './generation/bailian.mjs'
import { compileDubbingRequest } from './dubbing-compiler.mjs'

const contract = {
  mode: 'generated',
  timing_source: { episode_key: 'ep-001', version_id: 'v002', line_index: 1, source_asset: { asset_key: 'shot-ep001-001', version_id: 'v001', sha256: 'a'.repeat(64) } },
  target_range: { start_ms: 1240, end_ms: 2080 },
  target_speech_ms: 770,
  original_text: '别回头。',
  adapted_text: '别回头。',
  adaptation: null,
  performance: {
    intent: '阻止对方看见身后的危险',
    subtext: '她害怕，但不能让对方察觉',
    emotion_arc: [{ at: 0, emotion: '克制警觉', intensity: 0.45 }, { at: 1, emotion: '压低的急迫', intensity: 0.72 }],
    pace: '短促但不抢字',
    emphasis: ['别'],
    pause_plan: [{ after: '别', duration_ms: 70 }],
    breath: '起句前轻吸气，句尾不泄气',
    distance_and_space: '近距离低声',
  },
  fit_policy: { max_paid_generations: 3, provider_speed_min: 0.85, provider_speed_max: 1.15, max_post_tempo_percent: 3, text_adaptation_allowed: true },
}

function input(provider, model, overrides = {}) {
  return { provider, model, voice: 'linwan', voice_binding: { voice_id: 'linwan' }, authorized_voice_bindings: [{ voice_id: 'linwan' }], dubbing_contract_version: 'v003', contract: structuredClone(contract), attempt: 2, measured_speech_ms: 700, ...overrides }
}

test('CosyVoice 指令包含意图转折重音停连且不超过 100 加权字符', () => {
  const out = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus'))
  assert.equal(out.supported, true)
  assert.match(out.arguments.instruction, /意图.*情绪.*重音.*别.*停连/)
  assert.ok(weightedLength(out.arguments.instruction) <= 100)
  assert.equal(out.arguments.language_hints, 'zh')
})

test('不支持情绪弧的模型返回能力缺口而非静默降级', () => {
  const out = compileDubbingRequest(input('bailian', 'cosyvoice-v2'))
  assert.deepEqual(out.capability_gaps, ['style-instruction'])
  assert.equal(out.supported, false)
  assert.equal(out.arguments, null)
})

test('MiniMax 不能表达强度、重音和停顿时失败关闭', () => {
  const singleEmotion = structuredClone(contract)
  singleEmotion.performance.emotion_arc = [{ at: 0, emotion: 'calm', intensity: 0.45 }]
  const out = compileDubbingRequest(input('starrouter', 'speech-2.8-hd', { contract: singleEmotion }))
  assert.equal(out.supported, false)
  assert.equal(out.arguments, null)
  for (const gap of ['emotion-intensity', 'emphasis', 'pause-plan']) assert.ok(out.capability_gaps.includes(gap))
})

test('OpenAI tts-1 不得承诺不支持的 instructions', () => {
  const out = compileDubbingRequest(input('starrouter', 'tts-1'))
  assert.equal(out.supported, false)
  assert.equal(out.arguments, null)
  assert.deepEqual(out.capability_gaps, ['style-instruction'])
})

test('RunningHub 只注入映射白名单声明的 JSON path', () => {
  const out = compileDubbingRequest(input('runninghub', 'custom-audio', {
    runninghub_mapping: {
      workflow_id: 'workflow-audio-1',
      node_info_list: [
        { nodeId: '12', fieldName: 'text', json_path: 'text' },
        { nodeId: '13', fieldName: 'rate', json_path: 'speed' },
        { nodeId: '14', fieldName: 'instruction', json_path: 'instruction' },
      ],
    },
  }))
  assert.equal(out.supported, true)
  assert.deepEqual(out.arguments, {
    workflow_id: 'workflow-audio-1',
    node_info_list: [
      { nodeId: '12', fieldName: 'text', fieldValue: '别回头。' },
      { nodeId: '13', fieldName: 'rate', fieldValue: 0.91 },
      { nodeId: '14', fieldName: 'instruction', fieldValue: '意图：阻止对方看见身后的危险；情绪弧：0|克制警觉|0.45→1|压低的急迫|0.72；重音：别；停连：别后停70毫秒' },
    ],
  })
})

test('MiniMax 多段情绪弧和缺少情绪映射的 RunningHub 工作流均会阻断', () => {
  const minimax = compileDubbingRequest(input('starrouter', 'speech-2.8-hd'))
  assert.ok(minimax.capability_gaps.includes('emotion-arc'))
  assert.equal(minimax.arguments, null)
  const runninghub = compileDubbingRequest(input('runninghub', 'custom-audio', {
    runninghub_mapping: { workflow_id: 'workflow-audio-1', node_info_list: [{ nodeId: '12', fieldName: 'text', json_path: 'text' }] },
  }))
  assert.deepEqual(runninghub.capability_gaps, ['runninghub-mapping-incomplete'])
  assert.equal(runninghub.arguments, null)
})

test('MiniMax 即使情绪名相同但有多节也拒绝用单一枚举静默合并', () => {
  const multiBeat = structuredClone(contract)
  multiBeat.performance.emotion_arc = [{ at: 0, emotion: '克制警觉', intensity: 0.3 }, { at: 0.7, emotion: '克制警觉', intensity: 0.8 }]
  const out = compileDubbingRequest(input('starrouter', 'speech-2.8-hd', { contract: multiBeat }))
  assert.ok(out.capability_gaps.includes('emotion-arc'))
  assert.equal(out.arguments, null)
})

test('指令按顺序保留三节情绪弧的 at、情绪和强度', () => {
  const threeBeat = structuredClone(contract)
  threeBeat.performance.intent = '阻止'
  threeBeat.performance.emotion_arc = [{ at: 0, emotion: '警觉', intensity: 0.2 }, { at: 0.5, emotion: '迟疑', intensity: 0.6 }, { at: 1, emotion: '急迫', intensity: 0.9 }]
  const cosy = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus', { contract: threeBeat }))
  for (const instruction of [cosy.arguments.instruction]) {
    assert.match(instruction, /0\|警觉\|0\.2/)
    assert.match(instruction, /0\.5\|迟疑\|0\.6/)
    assert.match(instruction, /1\|急迫\|0\.9/)
    assert.ok(instruction.indexOf('0|警觉|0.2') < instruction.indexOf('0.5|迟疑|0.6'))
    assert.ok(instruction.indexOf('0.5|迟疑|0.6') < instruction.indexOf('1|急迫|0.9'))
  }
})

test('情绪弧指令保留合同的完整小数语义，不量化 at 或强度', () => {
  const precise = structuredClone(contract)
  precise.performance.intent = '阻止'
  precise.performance.emotion_arc = [{ at: 0.1234, emotion: '警觉', intensity: 0.4567 }]
  const cosy = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus', { contract: precise }))
  const runninghub = compileDubbingRequest(input('runninghub', 'custom-audio', {
    contract: precise,
    runninghub_mapping: { workflow_id: 'workflow-audio-1', node_info_list: [{ nodeId: '12', fieldName: 'text', json_path: 'text' }, { nodeId: '13', fieldName: 'rate', json_path: 'speed' }, { nodeId: '14', fieldName: 'instruction', json_path: 'instruction' }] },
  }))
  for (const instruction of [cosy.arguments.instruction, runninghub.arguments.node_info_list[2].fieldValue]) {
    assert.match(instruction, /0\.1234\|警觉\|0\.4567/)
  }
})

test('缺少受信任外层合同版本或合同不完整时阻断', () => {
  const missingVersion = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus', { dubbing_contract_version: undefined }))
  assert.deepEqual(missingVersion.capability_gaps, ['dubbing-contract-version-required'])
  assert.notEqual(missingVersion.snapshot.contract_version, null)
  const invalidVersion = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus', { dubbing_contract_version: 'v3' }))
  assert.deepEqual(invalidVersion.capability_gaps, ['dubbing-contract-version-invalid'])
  assert.equal(invalidVersion.snapshot.contract_version, 'invalid')
  const incomplete = structuredClone(contract)
  delete incomplete.performance.subtext
  const out = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus', { contract: incomplete }))
  assert.deepEqual(out.capability_gaps, ['invalid-dubbing-contract'])
  assert.equal(out.arguments, null)
})

test('快照固定保留版本、区间、轮次和能力缺口，不带调用凭据', () => {
  const out = compileDubbingRequest(input('bailian', 'cosyvoice-v2', { api_key: 'must-not-leak' }))
  assert.deepEqual(out.snapshot, {
    contract_version: 'v003',
    timing_version: 'v002',
    target_range: { start_ms: 1240, end_ms: 2080 },
    target_speech_ms: 770,
    text_version: 'original',
    attempt: 2,
    capability_gaps: ['style-instruction'],
  })
  assert.equal(JSON.stringify(out.snapshot).includes('must-not-leak'), false)
})

test('第三轮基于可核对的上一轮绝对速度收敛', () => {
  const second = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus'))
  assert.equal(second.supported, true)
  assert.equal(second.arguments.speed, 0.91)
  assert.equal(second.snapshot.applied_speed, 0.91)

  const third = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus', {
    attempt: 3,
    measured_speech_ms: 800,
    previous_compiler_snapshot: second.snapshot,
  }))
  assert.equal(third.supported, true)
  assert.equal(third.arguments.speed, 0.95)
  assert.equal(third.snapshot.applied_speed, 0.95)
})

test('第三轮拒绝缺失或不匹配的上一轮快照与非自然语速', () => {
  const missing = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus', { attempt: 3, measured_speech_ms: 800 }))
  assert.deepEqual(missing.capability_gaps, ['previous-compiler-snapshot-required'])

  const second = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus'))
  const mismatched = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus', {
    attempt: 3,
    measured_speech_ms: 800,
    previous_compiler_snapshot: { ...second.snapshot, timing_version: 'v999' },
  }))
  assert.deepEqual(mismatched.capability_gaps, ['previous-compiler-snapshot-invalid'])

  const tooFast = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus', {
    attempt: 3,
    measured_speech_ms: 1000,
    previous_compiler_snapshot: second.snapshot,
  }))
  assert.deepEqual(tooFast.capability_gaps, ['speed-out-of-policy'])
})
