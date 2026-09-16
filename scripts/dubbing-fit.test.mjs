import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildFinalizationPlan, evaluateDubbingFit, finalizeDubbingAudio, nextDubbingAttempt } from './dubbing-fit.mjs'

function contract(overrides = {}) {
  return {
    target_range: { start_ms: 1000, end_ms: 2000 },
    performance: { pause_plan: [{ after: '别', duration_ms: 80 }] },
    fit_policy: { max_paid_generations: 3, max_post_tempo_percent: 3 },
    ...overrides,
  }
}

function fitInput(errorMs, fps) {
  return {
    contract: contract(),
    alignment: { actual_start_ms: 1000 + errorMs, actual_end_ms: 2000 + errorMs },
    timeline_fps: fps,
  }
}

function finalizationAlignment(overrides = {}) {
  return {
    words: [{ text: '别', start_ms: 300, end_ms: 500 }],
    ...overrides,
  }
}

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || 'FFmpeg 测试素材生成失败')
}

function silenceStarts(path) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-i', path, '-af', 'silencedetect=noise=-50dB:d=0.03', '-f', 'null', '-'], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || 'FFmpeg 静音边界检测失败')
  return [...result.stderr.matchAll(/silence_start:\s*([0-9.]+)/g)].map((match) => Number(match[1]))
}

test('24fps 可见对白允许 42ms 但拒绝 43ms', () => {
  const withinFrame = evaluateDubbingFit(fitInput(42, 24))
  const beyondFrame = evaluateDubbingFit(fitInput(43, 24))
  assert.equal(withinFrame.tolerance_ms, 42)
  assert.equal(withinFrame.passed, true)
  assert.equal(beyondFrame.passed, false)
  assert.deepEqual(beyondFrame.correction, { start_ms: -43, end_ms: -43 })
})

test('对齐的音频内时间必须先换算为剧集时间线', () => {
  const fit = evaluateDubbingFit({
    contract: contract(),
    alignment: { start_ms: 42, end_ms: 1042, timeline_offset_ms: 1000 },
    timeline_fps: 24,
  })
  assert.equal(fit.passed, true)
  assert.equal(fit.start_error_ms, 42)
})

test('三轮状态机只在批准适配后发起第三次付费动作', () => {
  const failedFit = { passed: false }
  assert.deepEqual(nextDubbingAttempt({ attempts: [], fit: failedFit, adaptation: null }), { state: 'generate-original', attempt: 1 })
  assert.deepEqual(nextDubbingAttempt({ attempts: [{}], fit: failedFit, adaptation: null }), { state: 'regenerate-parameters', attempt: 2 })
  assert.deepEqual(nextDubbingAttempt({ attempts: [{}, {}], fit: failedFit, adaptation: { approved: true } }), { state: 'regenerate-adapted', attempt: 3 })
  assert.deepEqual(nextDubbingAttempt({ attempts: [{}, {}], fit: failedFit, adaptation: { approved: false } }), { state: 'blocked', reason: 'adaptation-not-approved' })
})

test('第三轮失败后阻塞且不产生第四次付费动作', () => {
  assert.deepEqual(
    nextDubbingAttempt({ attempts: [{}, {}, {}], fit: { passed: false }, adaptation: { approved: true } }),
    { state: 'blocked', reason: 'paid-generation-limit' }
  )
})

test('拒绝超过 3% tempo、非合同停顿及超出声明时长的静音', () => {
  assert.equal(buildFinalizationPlan({ contract: contract(), tempo_percent: -3, silence: [] }).atempo, 0.97)
  assert.throws(() => buildFinalizationPlan({ contract: contract(), tempo_percent: 3.1, silence: [] }), /3%/)
  assert.throws(() => buildFinalizationPlan({ contract: contract(), alignment: finalizationAlignment(), tempo_percent: 0, silence: [{ pause_index: 1, duration_ms: 80, at_ms: 500 }] }), /停顿合同/)
  assert.throws(() => buildFinalizationPlan({ contract: contract(), alignment: finalizationAlignment(), tempo_percent: 0, silence: [{ pause_index: 0, duration_ms: 81, at_ms: 500 }] }), /停顿合同/)
})

test('静音必须精确绑定合同停顿的唯一对齐锚点', () => {
  const input = { contract: contract(), alignment: finalizationAlignment(), tempo_percent: 0 }
  assert.throws(() => buildFinalizationPlan({ ...input, silence: [{ pause_index: 0, duration_ms: 80, at_ms: 499 }] }), /alignment 锚点/)
  assert.throws(() => buildFinalizationPlan({
    ...input,
    silence: [
      { pause_index: 0, duration_ms: 40, at_ms: 500 },
      { pause_index: 0, duration_ms: 40, at_ms: 500 },
    ],
  }), /重复锚点/)
})

test('同一合同停顿不能通过多段静音累计超过声明时长', () => {
  assert.throws(() => buildFinalizationPlan({
    contract: contract(),
    alignment: finalizationAlignment(),
    tempo_percent: 0,
    silence: [
      { pause_index: 0, duration_ms: 41, at_ms: 500 },
      { pause_index: 0, duration_ms: 41, at_ms: 500 },
    ],
  }), /重复锚点|累计.*停顿合同/)
})

test('收口生成 WAV、保留音频流并只将容器时长作为技术探测', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-fit-'))
  try {
    const input = resolve(root, 'input.wav')
    const output = resolve(root, 'output.wav')
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', '-y', input])
    const plan = buildFinalizationPlan({
      contract: contract(),
      alignment: finalizationAlignment(),
      tempo_percent: 3,
      silence: [{ pause_index: 0, duration_ms: 80, at_ms: 500 }],
    })
    const result = finalizeDubbingAudio({ input, output, plan })
    assert.equal(result.output, output)
    assert.equal(result.probe.has_audio, true)
    assert.ok(result.probe.duration_ms > 900)
    assert.equal(result.requires_alignment, true)
    assert.equal('passed' in result, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('正负 tempo 后静音仍落在变速后的词尾锚点', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-fit-tempo-anchor-'))
  try {
    const input = resolve(root, 'input.wav')
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', '-y', input])
    for (const tempoPercent of [3, -3]) {
      const output = resolve(root, `output-${tempoPercent}.wav`)
      const plan = buildFinalizationPlan({
        contract: contract(),
        alignment: finalizationAlignment(),
        tempo_percent: tempoPercent,
        silence: [{ pause_index: 0, duration_ms: 80, at_ms: 500 }],
      })
      finalizeDubbingAudio({ input, output, plan })
      const [actualStart] = silenceStarts(output)
      const expectedStart = 0.5 / plan.atempo
      assert.ok(Number.isFinite(actualStart), `tempo ${tempoPercent}% 未检测到插入静音`)
      assert.ok(Math.abs(actualStart - expectedStart) <= 0.01, `tempo ${tempoPercent}% 静音锚点偏差过大：${actualStart} vs ${expectedStart}`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('收口不覆盖输入或既有输出', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-fit-overwrite-'))
  try {
    const input = resolve(root, 'input.wav')
    const existingOutput = resolve(root, 'existing.wav')
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', '-y', input])
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', '-y', existingOutput])
    const plan = buildFinalizationPlan({ contract: contract(), tempo_percent: 0, silence: [] })
    assert.throws(() => finalizeDubbingAudio({ input, output: input, plan }), /不得覆盖输入/)
    assert.throws(() => finalizeDubbingAudio({ input, output: existingOutput, plan }), /已存在|already exists|失败/)
    assert.throws(() => finalizeDubbingAudio({ input, output: resolve(root, 'output.mp3'), plan }), /WAV/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
