import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { addAssetVersion, putAsset, selectAssetVersion } from './asset-ledger.mjs'
import { finalSpeechAlignment, putFinalSpeechAlignment, putSpeechTimingCandidate, reviewSpeechTiming, selectedSourceSpeechTiming, selectedSpeechTiming, validateSpeechTiming } from './speech-timing.mjs'

const sourceBytes = 'source-audio-v1'
const sourceAsset = { asset_key: 'audio-ep001-dialogue', version_id: 'v001', sha256: createHash('sha256').update(sourceBytes).digest('hex') }
const provenance = { origin: 'imported', created_by: 'user', provider: null, model_or_workflow: null, task_id: null, prompt_document: null, source_assets: [], parameters: {} }
const pendingReview = { speaker_checked: false, text_checked: false, visible_mouth_checked: false, notes: '' }
const completedReview = { speaker_checked: true, text_checked: true, visible_mouth_checked: true, notes: '逐帧核对说话人、逐字文本和可见嘴部' }

function word(overrides = {}) {
  return { text: '别', start_ms: 0, end_ms: 160, confidence: 0.95, confidence_source: 'asr', ...overrides }
}

function line(overrides = {}) {
  return { line_index: 1, speaker: '林晚', text: '别', start_ms: 0, end_ms: 500, pauses: [{ start_ms: 160, end_ms: 220 }], review_evidence: pendingReview, confidence: 0.95, confidence_source: 'asr', words: [word()], ...overrides }
}

function timing(overrides = {}) {
  const document = { episode_key: 'ep-001', source_asset: sourceAsset, method: 'asr-forced-alignment', reviewed: false, language: 'zh-CN', lines: [line()], ...overrides }
  if (document.reviewed) document.lines = document.lines.map((item) => ({ ...item, review_evidence: completedReview }))
  return document
}

async function registerSource(root, source, bytes) {
  const path = resolve(root, `assets/audio/${source.asset_key}/${source.version_id}.wav`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  await putAsset(root, { key: source.asset_key, type: 'audio', name: source.asset_key })
  await addAssetVersion(root, source.asset_key, { id: source.version_id, localPath: `assets/audio/${source.asset_key}/${source.version_id}.wav`, provenance })
  await selectAssetVersion(root, source.asset_key, source.version_id)
}

async function temporaryRoot() {
  const root = await mkdtemp(resolve(tmpdir(), 'speech-timing-'))
  await registerSource(root, sourceAsset, sourceBytes)
  return root
}

test('低置信 ASR 只能保存为未复核候选', async () => {
  const root = await temporaryRoot()
  try {
    const candidate = timing({ lines: [line({ confidence: 0.89 })] })
    assert.doesNotThrow(() => validateSpeechTiming(candidate))
    const saved = await putSpeechTimingCandidate(root, candidate)
    await assert.rejects(
      () => reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: saved.version_id, document: { ...candidate, reviewed: true }, reviewed_by: 'codex' }),
      /必须人工校正|人工复核证据/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('人工复核创建新版本且不改写候选', async () => {
  const root = await temporaryRoot()
  try {
    const candidate = timing({ lines: [line({ confidence: 0.89 })] })
    const saved = await putSpeechTimingCandidate(root, candidate)
    const corrected = timing({
      reviewed: true,
      lines: [line({ text: '别动', pauses: [{ start_ms: 180, end_ms: 220 }], confidence: 0.95, confidence_source: 'manual-correction', words: [word({ text: '别动', end_ms: 180, confidence: 1, confidence_source: 'manual-correction' })] })],
    })
    const reviewed = await reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: saved.version_id, document: corrected, reviewed_by: 'codex' })
    const selected = await selectedSpeechTiming(root, 'ep-001')
    const candidatePath = resolve(root, 'episodes/ep-001/speech-timing/v001.json')
    const marker = JSON.parse(await readFile(resolve(root, 'episodes/ep-001/speech-timing/selected.json'), 'utf8'))
    assert.equal(reviewed.version_id, 'v002')
    assert.equal(selected.version_id, 'v002')
    assert.equal(selected.document.reviewed, true)
    assert.equal(JSON.parse(await readFile(candidatePath, 'utf8')).reviewed, false)
    assert.deepEqual(marker, { versionId: 'v002', path: 'episodes/ep-001/speech-timing/v002.json', source_asset_sha256: sourceAsset.sha256, reviewed_by: 'codex' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ASR 行拒绝重叠行和越过行边界的词', () => {
  assert.throws(() => validateSpeechTiming(timing({ lines: [line(), line({ line_index: 2, start_ms: 400, end_ms: 900, words: [word({ start_ms: 400, end_ms: 600 })] })] })), /重叠/)
  assert.throws(() => validateSpeechTiming(timing({ lines: [line({ words: [word({ end_ms: 501 })] })] })), /行区间/)
  assert.throws(() => validateSpeechTiming(timing({ lines: [line({ pauses: [{ start_ms: 100, end_ms: 200 }] })] })), /不得与词级发声区间重叠/)
})

test('人工指令行必须用 evidence 说明、声明停顿并允许 words 为空', () => {
  const manual = { episode_key: 'ep-001', source_asset: sourceAsset, method: 'manual-direction', reviewed: false, language: 'zh-CN', lines: [{ line_index: 1, speaker: '林晚', text: '别回头', start_ms: 0, end_ms: 500, pauses: [{ start_ms: 160, end_ms: 220 }], review_evidence: pendingReview, words: [], evidence: '导演按画面节奏标注起止与停顿' }] }
  assert.doesNotThrow(() => validateSpeechTiming(manual))
  assert.doesNotThrow(() => validateSpeechTiming({ ...manual, lines: [{ ...manual.lines[0], text: '别', words: [{ text: '别', start_ms: 0, end_ms: 160 }] }] }))
  assert.throws(() => validateSpeechTiming({ ...manual, lines: [{ ...manual.lines[0], words: [{ text: '别', start_ms: 0, end_ms: 501 }] }] }), /行区间/)
  assert.throws(() => validateSpeechTiming({ ...manual, lines: [{ ...manual.lines[0], evidence: '   ' }] }), /evidence/)
  assert.throws(() => validateSpeechTiming({ ...manual, lines: [{ ...manual.lines[0], pauses: [] }] }), /停顿/)
  assert.throws(() => validateSpeechTiming(timing({ lines: [line({ evidence: '伪造人工说明' })] })), /字段无效/)
})

test('已复核版本必须记录说话人、逐字文本和可见嘴部核对证据', () => {
  assert.doesNotThrow(() => validateSpeechTiming(timing({ reviewed: true })))
  const missingEvidence = timing({ reviewed: true })
  missingEvidence.lines[0].review_evidence = pendingReview
  assert.throws(() => validateSpeechTiming(missingEvidence), /人工复核证据/)
  assert.throws(() => validateSpeechTiming(timing({ lines: [line({ speaker: '' })] })), /speaker/)
  assert.throws(() => validateSpeechTiming(timing({ lines: [line({ text: '' })] })), /text/)
})

test('ASR 复核将行阈值 0.90 与词阈值 0.80 分开校验', () => {
  const reviewed = (confidence, wordConfidence) => timing({ reviewed: true, lines: [line({ confidence, words: [word({ confidence: wordConfidence })] })] })
  assert.doesNotThrow(() => validateSpeechTiming(reviewed(0.9, 0.8)))
  assert.throws(() => validateSpeechTiming(reviewed(0.9, 0.79)), /词级置信度/)
  assert.doesNotThrow(() => validateSpeechTiming(reviewed(0.9, 0.85)))
  assert.throws(() => validateSpeechTiming(reviewed(0.89, 0.85)), /行级置信度/)
})

test('低置信 ASR 复核必须留下对应的人工校正证据', async () => {
  const root = await temporaryRoot()
  try {
    const candidate = timing({ lines: [line({ confidence: 0.89, words: [word({ confidence: 0.79 })] })] })
    const saved = await putSpeechTimingCandidate(root, candidate)
    const onlyReviewed = timing({ reviewed: true, lines: [line({ confidence: 0.9, words: [word({ confidence: 0.8 })] })] })
    await assert.rejects(
      () => reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: saved.version_id, document: onlyReviewed, reviewed_by: 'codex' }),
      /人工校正证据/
    )
    const corrected = timing({ reviewed: true, lines: [line({ confidence: 0.9, confidence_source: 'manual-correction', words: [word({ confidence: 0.8, confidence_source: 'manual-correction' })] })] })
    assert.equal((await reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: saved.version_id, document: corrected, reviewed_by: 'codex' })).version_id, 'v002')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('低置信词可用文本或时间边界变更作为人工校正证据', async () => {
  const root = await temporaryRoot()
  try {
    const candidate = timing({ lines: [line({ words: [word({ confidence: 0.79 })] })] })
    const saved = await putSpeechTimingCandidate(root, candidate)
    const textCorrected = timing({ reviewed: true, lines: [line({ text: '别动', words: [word({ text: '别动', confidence: 0.8 })] })] })
    assert.equal((await reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: saved.version_id, document: textCorrected, reviewed_by: 'codex' })).version_id, 'v002')
    const boundaryCorrected = timing({ reviewed: true, lines: [line({ pauses: [{ start_ms: 180, end_ms: 220 }], words: [word({ start_ms: 20, end_ms: 180, confidence: 0.8 })] })] })
    assert.equal((await reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: saved.version_id, document: boundaryCorrected, reviewed_by: 'codex' })).version_id, 'v003')
    const noEvidence = timing({ reviewed: true, lines: [line({ words: [word({ confidence: 0.8 })] })] })
    await assert.rejects(
      () => reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: saved.version_id, document: noEvidence, reviewed_by: 'codex' }),
      /人工校正证据/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('新候选不会覆盖已有版本且 selected 只读取经过复核的标准版本', async () => {
  const root = await temporaryRoot()
  try {
    const first = await putSpeechTimingCandidate(root, timing({ language: 'zh-CN' }))
    const second = await putSpeechTimingCandidate(root, timing({ language: 'en-US' }))
    assert.equal(first.version_id, 'v001')
    assert.equal(second.version_id, 'v002')
    assert.equal(JSON.parse(await readFile(resolve(root, 'episodes/ep-001/speech-timing/v001.json'), 'utf8')).language, 'zh-CN')
    await assert.rejects(() => selectedSpeechTiming(root, 'ep-001'), /不存在|已复核/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('逐来源引用读取已复核源 timing，不依赖剧集唯一 selected 槽', async () => {
  const root = await temporaryRoot()
  try {
    const first = await putSpeechTimingCandidate(root, timing())
    await reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: first.version_id, document: timing({ reviewed: true }), reviewed_by: 'codex' })
    const otherBytes = 'source-audio-other'
    const otherSource = { asset_key: 'audio-ep001-other', version_id: 'v001', sha256: createHash('sha256').update(otherBytes).digest('hex') }
    await registerSource(root, otherSource, otherBytes)
    const second = await putSpeechTimingCandidate(root, timing({ source_asset: otherSource }))
    const reviewed = await reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: second.version_id, document: timing({ reviewed: true, source_asset: otherSource }), reviewed_by: 'codex' })
    const firstSource = await selectedSourceSpeechTiming(root, { episode_key: 'ep-001', version_id: 'v002', line_index: 1, source_asset: sourceAsset })
    const secondSource = await selectedSourceSpeechTiming(root, { episode_key: 'ep-001', version_id: reviewed.version_id, line_index: 1, source_asset: otherSource })
    assert.equal(firstSource.document.source_asset.asset_key, sourceAsset.asset_key)
    assert.equal(secondSource.document.source_asset.asset_key, otherSource.asset_key)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('源资产换选版本后拒绝继续读取旧 speech-timing', async () => {
  const root = await temporaryRoot()
  try {
    const candidate = await putSpeechTimingCandidate(root, timing())
    const reviewed = await reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: candidate.version_id, document: timing({ reviewed: true }), reviewed_by: 'codex' })
    const nextBytes = 'source-audio-v2'
    const nextPath = resolve(root, 'assets/audio/audio-ep001-dialogue/v002.wav')
    await writeFile(nextPath, nextBytes)
    await addAssetVersion(root, sourceAsset.asset_key, { id: 'v002', localPath: 'assets/audio/audio-ep001-dialogue/v002.wav', provenance })
    const ledgerPath = resolve(root, '.short-drama/assets.json')
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))
    ledger.assets[sourceAsset.asset_key].selectedHistory.push(sourceAsset.version_id)
    ledger.assets[sourceAsset.asset_key].selectedVersionId = 'v002'
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`)
    await assert.rejects(
      () => selectedSourceSpeechTiming(root, { episode_key: 'ep-001', version_id: reviewed.version_id, line_index: 1, source_asset: sourceAsset }),
      /当前 selected|来源资产/
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('源资产已 stale 时拒绝复核 speech-timing', async () => {
  const root = await temporaryRoot()
  try {
    const candidate = await putSpeechTimingCandidate(root, timing())
    const ledgerPath = resolve(root, '.short-drama/assets.json')
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))
    ledger.assets[sourceAsset.asset_key].staleVersionIds.push(sourceAsset.version_id)
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`)
    await assert.rejects(
      () => reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: candidate.version_id, document: timing({ reviewed: true }), reviewed_by: 'codex' }),
      /失效|stale/
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('逐来源 timing 即使文档已复核，未建立当前选版标记也不能使用', async () => {
  const root = await temporaryRoot()
  try {
    const saved = await putSpeechTimingCandidate(root, timing())
    const path = resolve(root, `episodes/ep-001/speech-timing/${saved.version_id}.json`)
    const document = JSON.parse(await readFile(path, 'utf8'))
    document.reviewed = true
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`)
    await assert.rejects(() => selectedSourceSpeechTiming(root, { episode_key: 'ep-001', version_id: saved.version_id, line_index: 1, source_asset: sourceAsset }), /当前选版/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('最终对齐独立绑定配音 SHA，并显式换算音频入点到时间线落点', async () => {
  const root = await temporaryRoot()
  try {
    const document = {
      episode_key: 'ep-001', line_index: 1,
      audio_asset: { asset_key: 'audio-ep001-line-001', version_id: 'v002', sha256: 'c'.repeat(64) },
      audio_plan_version: 'v001', source_timing: { version_id: 'v002', line_index: 1, source_asset: sourceAsset },
      text: '别回头', words: [{ text: '别', start_ms: 200, end_ms: 450 }, { text: '回头', start_ms: 500, end_ms: 980 }],
      timeline_mapping: { audio_in_ms: 200, timeline_at_ms: 5000 }, timeline_fps: 24, reviewed: true,
    }
    const stored = await putFinalSpeechAlignment(root, document)
    assert.equal(stored.version_id, 'v001')
    assert.deepEqual(stored.timeline_range, { start_ms: 5000, end_ms: 5780 })
    assert.deepEqual((await finalSpeechAlignment(root, document.audio_asset)).document, document)
    await assert.rejects(() => putFinalSpeechAlignment(root, { ...document, text: '别动' }), /不可变/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('源 timing 可逐行记录源入点到剧集时间线落点的转换', () => {
  const document = timing({ lines: [line({ timeline_mapping: { source_in_ms: 0, timeline_at_ms: 5000 } })] })
  assert.doesNotThrow(() => validateSpeechTiming(document))
  assert.throws(() => validateSpeechTiming(timing({ lines: [line({ timeline_mapping: { source_in_ms: 600, timeline_at_ms: 5000 } })] })), /时间域转换/)
})
