import test from 'node:test'
import assert from 'node:assert/strict'
import { weightedLength } from './generation/bailian.mjs'
import { compileDubbingRequest } from './dubbing-compiler.mjs'

const contract = {
  mode: 'generated',
  contract_version: 'v003',
  timing_source: { version_id: 'v002' },
  target_range: { start_ms: 1240, end_ms: 2080 },
  target_speech_ms: 770,
  original_text: '别回头。',
  adapted_text: '别回头。',
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
  return { provider, model, voice: 'linwan', contract: structuredClone(contract), attempt: 2, measured_speech_ms: 700, ...overrides }
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

test('MiniMax 写入情绪、速度和发音字典', () => {
  const singleEmotion = structuredClone(contract)
  singleEmotion.performance.emotion_arc = [{ at: 0, emotion: '克制警觉', intensity: 0.45 }]
  const out = compileDubbingRequest(input('starrouter', 'speech-2.8-hd', { contract: singleEmotion }))
  assert.equal(out.supported, true)
  assert.equal(out.arguments.metadata.voice_setting.emotion, '克制警觉')
  assert.equal(out.arguments.metadata.voice_setting.speed, 0.91)
  assert.deepEqual(out.arguments.metadata.pronunciation_dict, {})
})

test('OpenAI-compatible 写入 instructions 和 speed', () => {
  const out = compileDubbingRequest(input('starrouter', 'tts-1'))
  assert.equal(out.supported, true)
  assert.equal(out.arguments.speed, 0.91)
  assert.match(out.arguments.instructions, /意图.*重音.*停连/)
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
      { nodeId: '14', fieldName: 'instruction', fieldValue: '意图：阻止对方看见身后的危险；情绪：克制警觉→压低的急迫；重音：别；停连：别后停70毫秒' },
    ],
  })
})

test('MiniMax 多段情绪弧和缺少情绪映射的 RunningHub 工作流均会阻断', () => {
  const minimax = compileDubbingRequest(input('starrouter', 'speech-2.8-hd'))
  assert.deepEqual(minimax.capability_gaps, ['emotion-arc'])
  assert.equal(minimax.arguments, null)
  const runninghub = compileDubbingRequest(input('runninghub', 'custom-audio', {
    runninghub_mapping: { workflow_id: 'workflow-audio-1', node_info_list: [{ nodeId: '12', fieldName: 'text', json_path: 'text' }] },
  }))
  assert.deepEqual(runninghub.capability_gaps, ['runninghub-mapping-incomplete'])
  assert.equal(runninghub.arguments, null)
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
