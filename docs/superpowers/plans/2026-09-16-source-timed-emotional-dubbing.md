# 源时间线情感配音与字幕 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将第三方对白和旁白升级为由已复核源时间线、逐句表演合同和最终词级对齐共同驱动的生成流程，并让字幕、口型与剪辑始终绑定最终选中的真实音频版本。

**Architecture:** 新增独立的 `speech-timing`、配音合同编译、时长适配和八维审核模块，MCP 只负责编排这些原子能力与现有资产/任务账本。最终音频以不可变候选登记，审核通过后才能 selected；字幕和口型保存音频 SHA、配音合同版本及词级时间版本，任何上游变化都会通过 provenance 或绑定校验自动失效。

**Tech Stack:** Node.js ESM、`node:test`、JSON 文档合同、现有资产/任务/审核账本、FFmpeg/FFprobe、StarRouter ASR、百炼 CosyVoice、StarRouter MiniMax/OpenAI-compatible TTS、RunningHub 用户映射。

**Spec:** `docs/superpowers/specs/2026-09-16-source-timed-emotional-dubbing-design.md`

## Global Constraints

- 时间权威顺序固定为：已复核 selected 原声、已授权 selected 外部/人工配音、已批准导演本与制作计划人工区间；缺少三者时阻塞。
- ASR 行置信度必须不低于 `0.90`，每个词置信度必须不低于 `0.80`；低于阈值必须形成新人工复核版本，不能直接翻转候选状态。
- 每句最多 `3` 次付费生成：原文、参数重生、等义精简；Provider 速度只能在 `0.85–1.15`。
- 最终保持音高 tempo 修正不得超过 `±3%`，只允许在合同声明的停顿区补静音，禁止裁断语音。
- 可见对白发声起止误差不得超过 `ceil(1000 / timeline_fps)` 毫秒。
- 八维审核互不补偿；任一失败或存在 P0/P1 时不得 selected。
- 字幕只能由最终 selected 音频的最终词级时间生成，并向前后留 `2–4` 帧阅读余量且不越过合同窗口、相邻字幕或成片边界。
- 不训练声音模型，不模仿未授权真人；生成必须绑定项目已授权 `voice_id`。
- 旧项目只迁移为可读状态；缺少时间证据或完整合同的 `post_dub` / `external_audio` 必须进入 `unresolved`。
- 所有新增代码注释使用中文，并解释业务意图、边界或兼容原因。
- 不提交密钥、临时文件、ASR 原始上传或生成媒体缓存。

## File Map

- Create `scripts/speech-timing.mjs`: 校验、版本化保存、人工复核和读取词级时间证据。
- Create `scripts/speech-timing.test.mjs`: 时间合同、置信度、不可变复核和 selected 约束。
- Modify `scripts/audio-plan-contract.mjs`: `native-preserve` / `generated` 可判别配音合同及旧项目迁移。
- Modify `scripts/audio-plan-contract.test.mjs`: 普通对白合同、等义适配与迁移门禁。
- Create `scripts/dubbing-compiler.mjs`: 把统一合同编译为 Provider 请求并报告能力缺口。
- Create `scripts/dubbing-compiler.test.mjs`: CosyVoice、MiniMax、OpenAI-compatible、RunningHub 映射测试。
- Create `scripts/dubbing-fit.mjs`: 三轮状态机、发声边界、一帧容差和最终 FFmpeg 处理计划。
- Create `scripts/dubbing-fit.test.mjs`: 生成次数、速度、tempo、停顿与越界测试。
- Create `scripts/dubbing-performance-review.mjs`: 八维复听记录、资产选版和派生资产失效。
- Create `scripts/dubbing-performance-review.test.mjs`: P1 阻断、哈希绑定、选版和失效传播。
- Create `scripts/subtitles-from-audio.mjs`: 从最终词级时间生成带强绑定的字幕条目。
- Create `scripts/subtitles-from-audio.test.mjs`: 阅读余量、相邻裁切和绑定一致性测试。
- Modify `scripts/document-reference.mjs`: 音频生成必须绑定当前合同与 timing 版本。
- Modify `scripts/generation/mcp.mjs`: 注册五个新增工具、强化两个现有生成工具，限制三次付费生成。
- Create `scripts/dubbing-mcp.test.mjs`: MCP schema、预检、生成、复核、字幕工具集成测试。
- Modify `scripts/editing-store.mjs`: 时间线音轨、字幕和 lip-sync 的同源绑定门禁。
- Modify `scripts/export-edit-subtitles.mjs`: 导出前保留并复核 `audio_binding`。
- Modify `scripts/lip-sync-flow.test.mjs`: 口型请求合同版本与 timing 版本测试。
- Create `scripts/source-timed-dubbing-flow.test.mjs`: 合成媒体端到端回归。
- Create `scripts/dubbing-live-acceptance.mjs`: 对项目真实镜头执行 A/B 验收并把证据保存在项目内。
- Modify `scripts/next-version-acceptance.mjs`: 加入源时间线情感配音能力门禁。
- Modify `skills/design-drama-audio/SKILL.md`: 写入时间证据、表演合同、三轮适配和复听要求。
- Modify `skills/edit-drama-timeline/SKILL.md`: 写入最终音频派生字幕与失效规则。
- Modify `skills/drama-generation-service/SKILL.md`: 写入新 MCP 工具调用顺序与付费确认。
- Modify `references/pipeline.md`, `references/feature-completeness.md`, `references/usage-guide.md`, `references/codex-contracts.md`: 更新用户流程和合同说明。
- Modify `scripts/audit-plugin.mjs`: 审计新脚本、工具名、技能约束和中英文契约覆盖。

---

### Task 1: 词级时间证据与不可变复核

**Files:**
- Create: `scripts/speech-timing.mjs`
- Create: `scripts/speech-timing.test.mjs`

**Interfaces:**
- Consumes: selected 资产引用 `{asset_key, version_id, sha256}` 与 ASR/人工对齐数据。
- Produces: `validateSpeechTiming(document)`, `putSpeechTimingCandidate(root, document)`, `reviewSpeechTiming(root, input)`, `selectedSpeechTiming(root, episodeKey)`。

- [ ] **Step 1: 写出失败的合同和版本测试**

```js
test('低置信 ASR 只能保存为未复核候选', async () => {
  const candidate = timing({ reviewed: false, lines: [line({ confidence: 0.89 })] })
  assert.doesNotThrow(() => validateSpeechTiming(candidate))
  await assert.rejects(() => reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: 'v001', document: { ...candidate, reviewed: true } }), /必须人工校正/)
})

test('人工复核创建新版本且不改写候选', async () => {
  const reviewed = await reviewSpeechTiming(root, { episode_key: 'ep-001', candidate_version: 'v001', document: corrected, reviewed_by: 'codex' })
  assert.equal(reviewed.version_id, 'v002')
  assert.equal((await selectedSpeechTiming(root, 'ep-001')).version_id, 'v002')
  assert.equal(JSON.parse(await readFile(candidatePath)).reviewed, false)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test scripts/speech-timing.test.mjs`

Expected: FAIL，提示 `speech-timing.mjs` 不存在。

- [ ] **Step 3: 实现严格合同与版本存储**

```js
export function validateSpeechTiming(document) {
  exactKeys(document, ['episode_key', 'source_asset', 'method', 'reviewed', 'language', 'lines'], 'speech-timing')
  if (!['asr-forced-alignment', 'manual-direction'].includes(document.method)) throw new Error('speech-timing.method 无效')
  for (const [index, line] of document.lines.entries()) validateLine(line, index, document.method)
  return structuredClone(document)
}

export async function reviewSpeechTiming(rootArg, input) {
  const candidate = await readVersion(rootArg, input.episode_key, input.candidate_version)
  const reviewed = validateSpeechTiming({ ...structuredClone(input.document), reviewed: true })
  assertCorrectionEvidence(candidate, reviewed)
  return writeNextVersion(rootArg, reviewed, { select: true, reviewed_by: input.reviewed_by })
}
```

`validateLine` 必须检查行不重叠、词按序位于行区间、ASR 自动通过阈值和人工方法的证据说明；`putSpeechTimingCandidate` 只能写 `reviewed:false`；目录固定为 `episodes/<episode>/speech-timing/vNNN.json`，selected marker 同时保存 `versionId`、相对路径、源资产 SHA 和复核人。

辅助函数边界固定如下：`readVersion(root, episodeKey, versionId)` 只读取上述标准目录；`writeNextVersion(root, document, options)` 在文件锁内计算下一个 `vNNN` 并使用 `wx` 原子写入；`assertCorrectionEvidence(candidate, reviewed)` 要求低置信词的文本、边界或置信来源发生人工校正并记录复核人；模块内 `exactKeys` 沿用现有合同模块的严格键集合语义。

- [ ] **Step 4: 运行时间证据测试**

Run: `node --test scripts/speech-timing.test.mjs`

Expected: PASS，覆盖低置信、重叠词、越界词、人工方法空 `words`、候选不可覆盖和 selected 读取。

- [ ] **Step 5: 提交**

```bash
git add scripts/speech-timing.mjs scripts/speech-timing.test.mjs
git commit -m "feat: 增加词级语音时间证据"
```

### Task 2: 所有台词的配音合同与旧项目迁移

**Files:**
- Modify: `scripts/audio-plan-contract.mjs:1-105`
- Modify: `scripts/audio-plan-contract.test.mjs:1-45`
- Modify: `scripts/project-store.mjs:20,332-370`

**Interfaces:**
- Consumes: Task 1 的 `speech-timing` 版本引用。
- Produces: `validateDubbingContract(contract, context)`，以及每行必填的 `dubbing_contract`。

- [ ] **Step 1: 写出可判别联合和迁移失败测试**

```js
test('保留原声合同不得混入生成字段', () => {
  assert.throws(() => validateAudioLine({ ...base, dubbing_contract: { ...nativeContract, adapted_text: '别走' } }), /native-preserve/)
})

test('生成合同必须包含完整表演与三次总生成上限', () => {
  assert.throws(() => validateAudioLine({ ...postDub, dubbing_contract: { ...generatedContract, performance: { ...performance, subtext: '' } } }), /subtext/)
  assert.throws(() => validateAudioLine({ ...postDub, dubbing_contract: { ...generatedContract, fit_policy: { ...fit, max_paid_generations: 4 } } }), /max_paid_generations/)
})

test('旧 post_dub 缺合同时迁移为 unresolved', () => {
  const migrated = migrateLegacyAudioPlan(legacy)
  assert.match(migrated.unresolved.join('\n'), /配音合同与时间证据/)
  assert.equal(migrated.document.approved, false)
})
```

- [ ] **Step 2: 运行合同测试并确认旧实现放行或字段缺失**

Run: `node --test scripts/audio-plan-contract.test.mjs`

Expected: FAIL，至少出现 `dubbing_contract` 未校验。

- [ ] **Step 3: 实现 `native-preserve` 与 `generated` 严格结构**

```js
export function validateDubbingContract(contract, { deliveryMode, presentation }) {
  if (contract?.mode === 'native-preserve') return validateNativePreserve(contract, deliveryMode)
  if (contract?.mode !== 'generated') throw new Error('dubbing_contract.mode 无效')
  validateGenerated(contract, presentation)
  if (contract.fit_policy.max_paid_generations !== 3 || contract.fit_policy.provider_speed_min !== 0.85 || contract.fit_policy.provider_speed_max !== 1.15 || contract.fit_policy.max_post_tempo_percent !== 3) throw new Error('dubbing_contract.fit_policy 不符合固定安全边界')
  return contract
}
```

`validateGenerated` 精确校验 `timing_source`、`target_range`、`target_speech_ms`、原文/适配文本、适配留痕、意图、潜台词、情绪弧、节奏、重音、停顿、呼吸、空间和已授权 voice binding。旁白继续校验既有电影感字段，不降低原约束。

- [ ] **Step 4: 把 `dubbing_contract` 纳入项目文档 exactKeys**

```js
const fields = [...existingFields, 'dubbing_contract']
validateDubbingContract(line.dubbing_contract, { deliveryMode: line.delivery_mode, presentation: line.presentation })
```

旧 `native` 行迁移成未批准文档：若能引用原声，只补 `native-preserve` 骨架并留下“需建立 speech-timing”未决项；旧 `post_dub` / `external_audio` 不推测时间或表演字段。

- [ ] **Step 5: 运行合同与项目存储回归**

Run: `node --test scripts/audio-plan-contract.test.mjs && node scripts/project-store.mjs --self-check`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add scripts/audio-plan-contract.mjs scripts/audio-plan-contract.test.mjs scripts/project-store.mjs
git commit -m "feat: 强制逐句情感配音合同"
```

### Task 3: Provider 配音请求编译器

**Files:**
- Create: `scripts/dubbing-compiler.mjs`
- Create: `scripts/dubbing-compiler.test.mjs`
- Modify: `scripts/generation/providers.mjs`

**Interfaces:**
- Consumes: `compileDubbingRequest({provider, model, voice, contract, attempt, measured_speech_ms, runninghub_mapping, dubbing_contract_version, voice_binding, authorized_voice_bindings})`。调用入口从当前 selected audio-plan 的版本、当前行音色绑定和计划授权列表派生后三项，不把它们加入 Task 2 的严格合同对象。
- Produces: `{supported, arguments, capability_gaps, snapshot}`；`arguments` 可直接传给现有 Provider adapter。

- [ ] **Step 1: 写出四条 Provider 路由测试**

```js
test('CosyVoice 指令包含意图转折重音停连且不超过 100 加权字符', () => {
  const out = compileDubbingRequest(input('bailian', 'cosyvoice-v3.5-plus'))
  assert.equal(out.supported, true)
  assert.match(out.arguments.instruction, /重音.*别/)
  assert.ok(weightedLength(out.arguments.instruction) <= 100)
})

test('不支持情绪弧的模型返回能力缺口而非静默降级', () => {
  const out = compileDubbingRequest(input('bailian', 'cosyvoice-v2'))
  assert.deepEqual(out.capability_gaps, ['style-instruction'])
  assert.equal(out.supported, false)
})
```

同时断言 MiniMax 写入 `metadata.voice_setting.emotion/speed` 与 `pronunciation_dict`，OpenAI-compatible 写入 `instructions/speed`，RunningHub 只接受映射白名单声明的 JSON path。

- [ ] **Step 2: 运行编译器测试并确认失败**

Run: `node --test scripts/dubbing-compiler.test.mjs`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现能力矩阵与纯函数编译**

```js
const CAPABILITIES = Object.freeze({
  bailian: { instruction: new Set(['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3-flash']) },
  starrouter: { minimax: new Set(['speech-2.8-hd', 'speech-2.8-turbo']), openai: new Set(['tts-1']) },
})

export function compileDubbingRequest(input) {
  const speed = calibratedSpeed(input.contract, input.attempt, input.measured_speech_ms)
  if (speed < 0.85 || speed > 1.15) return unsupported('speed-out-of-policy')
  if (input.provider === 'bailian') return compileCosyVoice(input, speed)
  if (input.provider === 'starrouter' && CAPABILITIES.starrouter.minimax.has(input.model)) return compileMiniMax(input, speed)
  if (input.provider === 'starrouter' && CAPABILITIES.starrouter.openai.has(input.model)) return compileOpenAiCompatible(input, speed)
  if (input.provider === 'runninghub') return compileRunningHub(input, speed)
  return unsupported('provider-model-not-supported')
}
```

`snapshot` 固定包含合同版本、timing 版本、目标区间、文本版本、attempt 和能力缺口；不得包含密钥。

编译器内部辅助函数也必须保持纯函数：`calibratedSpeed` 只根据目标/实测发声时长在 `0.85–1.15` 内计算；`unsupported(reason)` 返回 `{supported:false, arguments:null, capability_gaps:[reason], snapshot}`；四个 `compile*` 函数只构造参数，不访问网络、文件或任务账本。

- [ ] **Step 4: 运行编译器和 Provider 自检**

Run: `node --test scripts/dubbing-compiler.test.mjs && node scripts/generation/providers.mjs --self-check && node scripts/generation/bailian.mjs --self-check`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/dubbing-compiler.mjs scripts/dubbing-compiler.test.mjs scripts/generation/providers.mjs
git commit -m "feat: 编译跨平台情感配音请求"
```

### Task 4: 三轮时长适配与确定性音频收口

**Files:**
- Create: `scripts/dubbing-fit.mjs`
- Create: `scripts/dubbing-fit.test.mjs`

**Interfaces:**
- Consumes: `evaluateDubbingFit({contract, alignment, timeline_fps})`、`nextDubbingAttempt({attempts, fit, adaptation})`、`finalizeDubbingAudio({input, output, plan})`。
- Produces: `{passed, tolerance_ms, start_error_ms, end_error_ms, correction}` 与下一状态 `generate-original|regenerate-parameters|regenerate-adapted|blocked`。

- [ ] **Step 1: 写出一帧误差、三轮上限和修正边界测试**

```js
test('24fps 可见对白允许 42ms 但拒绝 43ms', () => {
  assert.equal(evaluateDubbingFit(fitInput(42, 24)).passed, true)
  assert.equal(evaluateDubbingFit(fitInput(43, 24)).passed, false)
})

test('第三轮失败后阻塞且不产生第四次付费动作', () => {
  assert.equal(nextDubbingAttempt({ attempts: [a1, a2, a3], fit: failedFit, adaptation: approved }).state, 'blocked')
})

test('拒绝超过 3% tempo 和非合同停顿补静音', () => {
  assert.throws(() => buildFinalizationPlan({ tempo_percent: 3.1, silence: [] }), /3%/)
  assert.throws(() => buildFinalizationPlan({ tempo_percent: 0, silence: [{ after: '未声明', duration_ms: 80 }] }), /停顿合同/)
})
```

- [ ] **Step 2: 运行适配测试并确认失败**

Run: `node --test scripts/dubbing-fit.test.mjs`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现纯状态机和 FFmpeg 参数生成**

```js
export function nextDubbingAttempt({ attempts, fit, adaptation }) {
  if (fit?.passed) return { state: 'ready-for-review' }
  if (attempts.length === 0) return { state: 'generate-original', attempt: 1 }
  if (attempts.length === 1) return { state: 'regenerate-parameters', attempt: 2 }
  if (attempts.length === 2 && adaptation?.approved === true) return { state: 'regenerate-adapted', attempt: 3 }
  return { state: 'blocked', reason: attempts.length >= 3 ? 'paid-generation-limit' : 'adaptation-not-approved' }
}
```

`finalizeDubbingAudio` 用 `spawnSync('ffmpeg', ...)` 执行 `atempo=0.97..1.03`、合同停顿位置的静音拼接和 WAV 输出；使用 `-n`，输出不得覆盖输入。完成后 FFprobe 校验音频流和时长，再由最终 alignment 判断发声边界，绝不以容器时长代替。

- [ ] **Step 4: 运行测试并检查 FFmpeg 实际输出**

Run: `node --test scripts/dubbing-fit.test.mjs`

Expected: PASS，测试生成 1 秒临时 WAV，并确认 `±3%` 处理后的时长与声流存在。

- [ ] **Step 5: 提交**

```bash
git add scripts/dubbing-fit.mjs scripts/dubbing-fit.test.mjs
git commit -m "feat: 增加配音时长适配状态机"
```

### Task 5: 八维配音审核、选版与派生资产失效

**Files:**
- Create: `scripts/dubbing-performance-review.mjs`
- Create: `scripts/dubbing-performance-review.test.mjs`
- Modify: `scripts/asset-ledger.mjs:247-330`

**Interfaces:**
- Consumes: `putDubbingPerformanceReview(root, review)`，review 绑定音频资产、SHA、audio-plan 行、合同版本和最终 timing 版本。
- Produces: `.short-drama/dubbing-reviews.json` 审核记录；通过时原子 selected 音频，并使旧选版派生资产 stale。

- [ ] **Step 1: 写出八维与原子选版测试**

```js
test('八维任一失败或 P1 均不得选版', async () => {
  const failed = review({ emotion_arc: dimension('failed'), issues: [{ severity: 'P1', message: '情绪平直' }] })
  const result = await putDubbingPerformanceReview(root, failed)
  assert.equal(result.selected, false)
})

test('通过审核后选版并递归失效旧音频派生口型', async () => {
  const result = await putDubbingPerformanceReview(root, review())
  assert.equal(result.selected, true)
  assert.deepEqual(result.invalidated, ['shot-ep001-001@v002'])
})
```

- [ ] **Step 2: 运行审核测试并确认失败**

Run: `node --test scripts/dubbing-performance-review.test.mjs`

Expected: FAIL，提示审核模块不存在。

- [ ] **Step 3: 实现审核校验和选版事务补偿**

```js
const DIMENSIONS = ['semantic_integrity', 'speaker_identity', 'emotion_arc', 'intensity_and_subtext', 'emphasis_pause_breath', 'timing_fit', 'picture_interaction', 'technical_audio']

export async function putDubbingPerformanceReview(rootArg, input) {
  const approved = input.watched_full === true && DIMENSIONS.every((key) => input.dimensions[key]?.status === 'passed') && !input.issues.some(({ severity }) => severity === 'P0' || severity === 'P1')
  const bound = await verifyAudioAndTimingBindings(rootArg, input)
  await saveImmutableReview(rootArg, { ...input, approved, asset_sha256: bound.audio.version.sha256 })
  if (!approved) return { approved, selected: false, invalidated: [] }
  const previous = bound.audio.asset.selectedVersionId
  await selectAssetVersion(rootArg, input.asset_key, input.version_id)
  const invalidated = previous && previous !== input.version_id ? await invalidateDerivedAssets(rootArg, { key: input.asset_key, version_id: previous }) : []
  return { approved, selected: true, invalidated }
}
```

保存审核失败后不删候选；选择失败时恢复审核账本旧值。`technical_audio` 同时要求无爆音、吞字、尾音截断、不自然变速和响度阻断项。

- [ ] **Step 4: 运行审核与资产回归**

Run: `node --test scripts/dubbing-performance-review.test.mjs scripts/asset-ledger-api.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/dubbing-performance-review.mjs scripts/dubbing-performance-review.test.mjs scripts/asset-ledger.mjs
git commit -m "feat: 增加八维情感配音审核"
```

### Task 6: 从最终音频派生字幕并锁定口型/剪辑同源性

**Files:**
- Create: `scripts/subtitles-from-audio.mjs`
- Create: `scripts/subtitles-from-audio.test.mjs`
- Modify: `scripts/editing-store.mjs:112-199`
- Modify: `scripts/export-edit-subtitles.mjs:34-120`
- Modify: `scripts/generation/mcp.mjs:662-685`
- Modify: `scripts/lip-sync-flow.test.mjs`

**Interfaces:**
- Consumes: `buildSubtitlesFromAudio({audio, timing, contracts, fps, timeline_end_ms})`。
- Produces: 字幕数组，每条包含 `audio_binding={asset_key,version_id,sha256,line_index,speech_timing_version,dubbing_contract_version}`。

- [ ] **Step 1: 写出字幕余量和同源绑定测试**

```js
test('字幕从最终词级边界扩 2 帧且不越过相邻台词', () => {
  const captions = buildSubtitlesFromAudio(fixture({ fps: 24, first_end: 1000, second_start: 1020 }))
  assert.equal(captions[0].endMs, 1020)
  assert.equal(captions[1].startMs, 1020)
  assert.equal(captions[0].audio_binding.sha256, AUDIO_SHA)
})

test('时间线拒绝字幕、对白音轨与 lip-sync 使用不同音频版本', async () => {
  await assert.rejects(() => validateTimeline(root, mismatchedTimeline), /同一 selected 配音/)
})
```

- [ ] **Step 2: 运行字幕与口型测试并确认失败**

Run: `node --test scripts/subtitles-from-audio.test.mjs scripts/lip-sync-flow.test.mjs`

Expected: FAIL，现有字幕没有逐条 `audio_binding`。

- [ ] **Step 3: 实现词级字幕构建器**

```js
export function buildSubtitlesFromAudio(input) {
  const frameMs = 1000 / input.fps
  return input.timing.lines.map((line, index, lines) => ({
    text: line.text,
    startMs: subtitleStart(line, lines[index - 1], frameMs),
    endMs: subtitleEnd(line, lines[index + 1], frameMs, input.timeline_end_ms),
    timestampMs: line.range.start_ms,
    confidence: line.confidence,
    speaker: line.speaker,
    audio_binding: bindingFor(input, line),
  }))
}
```

`subtitleStart(line, previous, frameMs)` 从 4 帧余量开始向 2 帧收缩，下限为合同窗口起点及上一字幕结束点；`subtitleEnd(line, next, frameMs, timelineEnd)` 同理取合同窗口结束点、下一字幕开始点和成片末尾的最小值。`bindingFor(input, line)` 原样复制已校验的音频 key/version/SHA、line index、timing 版本和合同版本，不做文件名推断。无法满足阅读速度时返回逐行错误，不按字数重切时间。

- [ ] **Step 4: 加强 timeline、导出和 lip-sync 门禁**

`validateTimeline` 对每条 dialogue/voiceover 音轨读取当前 selected 资产 SHA，并要求字幕绑定、`subtitle_source`、音轨与 segment 的 `dialogue_sync=lip-synced` 引用完全一致。`validateLipSyncEligibility` 额外比较 `audio_plan.version_id`、`line_index`、`dubbing_contract_version` 和 `speech_timing_version`；旧绑定或 stale 资产一律拒绝。

- [ ] **Step 5: 运行字幕、剪辑和口型回归**

Run: `node --test scripts/subtitles-from-audio.test.mjs scripts/lip-sync-flow.test.mjs && node scripts/export-edit-subtitles.mjs --self-check && node scripts/editing-store.mjs --self-check`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add scripts/subtitles-from-audio.mjs scripts/subtitles-from-audio.test.mjs scripts/editing-store.mjs scripts/export-edit-subtitles.mjs scripts/generation/mcp.mjs scripts/lip-sync-flow.test.mjs
git commit -m "feat: 绑定最终配音字幕与口型"
```

### Task 7: MCP 原子工具与三轮生成编排

**Files:**
- Modify: `scripts/document-reference.mjs:7-81`
- Modify: `scripts/generation/mcp.mjs:1-235,778-929`
- Modify: `scripts/audio-fallback.mjs`
- Modify: `scripts/audio-fallback.test.mjs`
- Create: `scripts/dubbing-mcp.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–6 的所有纯模块。
- Produces: `analyze_speech_timing`, `review_speech_timing`, `compile_dubbing_request`, 强化后的 `generate_audio` / `generate_audio_fallback`, `review_dubbing_performance`, `build_subtitles_from_audio`。

- [ ] **Step 1: 写出工具 schema 与只读预检测试**

```js
test('分析和编译工具不会创建付费任务', async () => {
  await call('analyze_speech_timing', alignmentInput)
  await call('compile_dubbing_request', compileInput)
  assert.deepEqual(await listTasks(root), [])
})

test('generate_audio 必须绑定当前合同与 timing 且第四轮被拒绝', async () => {
  await assert.rejects(() => call('generate_audio', { ...request, dubbing_attempt: 4 }), /最多 3 次/)
  await assert.rejects(() => call('generate_audio', { ...request, speech_timing_version: 'v001' }), /当前 selected speech-timing/)
})
```

- [ ] **Step 2: 运行 MCP 测试并确认工具尚未注册**

Run: `node --test scripts/dubbing-mcp.test.mjs`

Expected: FAIL，提示未知工具或 schema 缺失。

- [ ] **Step 3: 注册六个工具及精确字段**

```js
['compile_dubbing_request', '只读编译逐句情感配音合同，不提交付费任务。', {
  project_root: { type: 'string' }, episode_key: episodeKey, audio_plan_version: versionId,
  line_index: { type: 'integer', minimum: 1 }, provider, model: { type: 'string' }, voice: { type: 'string' },
  attempt: { type: 'integer', minimum: 1, maximum: 3 }, measured_speech_ms: { type: 'integer', minimum: 1 }, runninghub_mapping: { type: 'object' },
}, ['project_root', 'episode_key', 'audio_plan_version', 'line_index', 'provider', 'model', 'voice', 'attempt']]
```

`compile_dubbing_request` 与 `generate_audio` 均从 `audio_plan_version` 读取可信 `dubbing_contract_version`，从当前行和 audio-plan 的 `voice_bindings` 分别传入 `voice_binding` 与 `authorized_voice_bindings`；调用者不得手写或覆盖这些授权上下文。

`analyze_speech_timing` 只接收已有 ASR/对齐结果并绑定 selected 资产，不在内部调用 Provider；需要 ASR 时由现有 `transcribe_audio` 明确确认后单独执行。`review_speech_timing` 创建新版本。`review_dubbing_performance` 和 `build_subtitles_from_audio` 复用前述模块。

- [ ] **Step 4: 让生成调用只接受编译快照**

```js
const compiled = await compileCurrentDubbingRequest(root, args)
if (!compiled.supported || compiled.capability_gaps.length) throw new Error(`配音能力不匹配：${compiled.capability_gaps.join('、')}`)
if (args.dubbing_attempt > compiled.contract.fit_policy.max_paid_generations) throw new Error('每句最多 3 次付费生成')
const snapshot = await createRequestSnapshot(root, { ...request, arguments: compiled.arguments })
```

生成结果 provenance 必须保存 `audio_plan_version`、`line_index`、`dubbing_contract_version`、`speech_timing_version`、attempt、文本版本、目标区间和编译快照 SHA。`generate_audio_fallback` 不再直接用 `line.content`，而是走相同编译器和计数门禁。

- [ ] **Step 5: 强化文档引用与兜底测试**

Run: `node --test scripts/dubbing-mcp.test.mjs scripts/audio-fallback.test.mjs scripts/audio-fallback-flow.test.mjs && node scripts/generation/mcp.mjs --self-check`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add scripts/document-reference.mjs scripts/generation/mcp.mjs scripts/audio-fallback.mjs scripts/audio-fallback.test.mjs scripts/dubbing-mcp.test.mjs
git commit -m "feat: 接入源时间线配音工具链"
```

### Task 8: 端到端回归、真实镜头 A/B 与发布审计

**Files:**
- Create: `scripts/source-timed-dubbing-flow.test.mjs`
- Create: `scripts/dubbing-live-acceptance.mjs`
- Modify: `scripts/next-version-acceptance.mjs`
- Modify: `skills/design-drama-audio/SKILL.md`
- Modify: `skills/edit-drama-timeline/SKILL.md`
- Modify: `skills/drama-generation-service/SKILL.md`
- Modify: `references/pipeline.md`
- Modify: `references/feature-completeness.md`
- Modify: `references/usage-guide.md`
- Modify: `references/codex-contracts.md`
- Modify: `scripts/audit-plugin.mjs`

**Interfaces:**
- Consumes: 完整源时间线配音工具链。
- Produces: 可自动运行的合成回归、项目内真实 A/B 验收报告与插件发布门禁。

- [ ] **Step 1: 写出合成媒体端到端失败测试**

```js
test('原声时间到配音选版、字幕和失效传播完整闭环', async () => {
  const timing = await createAndReviewTiming(project)
  const generated = await registerThreeAttemptFixture(project, timing)
  await approveDubbing(project, generated.good)
  const subtitles = await buildBoundSubtitles(project, generated.good)
  await assert.doesNotReject(() => validateTimeline(project, timeline(subtitles, generated.good)))
  await approveDubbing(project, generated.better)
  await assert.rejects(() => validateTimeline(project, timeline(subtitles, generated.good)), /已失效|selected/)
})
```

- [ ] **Step 2: 运行端到端测试并确认缺少审计覆盖**

Run: `node --test scripts/source-timed-dubbing-flow.test.mjs`

Expected: FAIL，直到所有工具和失效路径串联完成。

- [ ] **Step 3: 实现真实镜头 A/B 验收命令**

```bash
node scripts/dubbing-live-acceptance.mjs <project-root> ep-001 10 \
  --original shot-ep001-010@v001 \
  --dub audio-ep001-line-010@v003 \
  --review <project-root>/.short-drama/dubbing-reviews.json
```

脚本只读项目 selected 资产并输出 `<project-root>/.short-drama/acceptance/source-timed-dubbing-ep-001-line-010.json`，记录原声/配音 SHA、逐词误差、总耗时、字幕误差、口型绑定和八维人工观察；它不复制媒体到仓库，也不自动批准审核。

- [ ] **Step 4: 更新三份 Skill 与参考文档**

`design-drama-audio` 明确先建 timing、再写合同、再生成；普通对白也必须有意图/潜台词/情绪弧。`drama-generation-service` 明确分析与编译不产生付费任务，生成最多三轮且每轮需确认策略。`edit-drama-timeline` 明确字幕来自最终 selected 音频，重生/换版后必须重建字幕和口型。

- [ ] **Step 5: 把能力加入插件审计与版本验收**

`next-version-acceptance.mjs` 新增 `source-timed-emotional-dubbing` 项，required files 包含四个核心模块，commands 包含全部新增测试。`audit-plugin.mjs` 检查五个新增工具名、两个强化生成工具的合同字段、三个 Skill 的强制措辞、阈值 `0.90/0.80`、`max_paid_generations=3`、`±3%`、八维名称和字幕 `audio_binding`。

- [ ] **Step 6: 运行完整验证**

```bash
node --test scripts/speech-timing.test.mjs scripts/audio-plan-contract.test.mjs scripts/dubbing-compiler.test.mjs scripts/dubbing-fit.test.mjs scripts/dubbing-performance-review.test.mjs scripts/subtitles-from-audio.test.mjs scripts/dubbing-mcp.test.mjs scripts/lip-sync-flow.test.mjs scripts/source-timed-dubbing-flow.test.mjs
node scripts/integration-self-check.mjs --self-check
node scripts/next-version-acceptance.mjs
node scripts/audit-plugin.mjs --self-check
node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync('.codex-plugin/plugin.json')).version; if (JSON.parse(fs.readFileSync('.claude-plugin/plugin.json')).version!==v || JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json')).plugins[0].version!==v) process.exit(1)"
git diff --check
```

Expected: 所有测试通过；acceptance 无缺失能力；audit 状态为 `covered`；三个插件清单版本一致；无空白错误。

- [ ] **Step 7: 对一个真实镜头执行 A/B 验收**

先完整听看原声与第三方配音，再运行 `dubbing-live-acceptance.mjs`。只有 timing、情绪八维、字幕、口型和技术音频全部通过才接受；失败报告保留在项目内并回到合同或 Provider 选择，不追加第四次生成。

- [ ] **Step 8: 提交**

```bash
git add scripts/source-timed-dubbing-flow.test.mjs scripts/dubbing-live-acceptance.mjs scripts/next-version-acceptance.mjs skills/design-drama-audio/SKILL.md skills/edit-drama-timeline/SKILL.md skills/drama-generation-service/SKILL.md references/pipeline.md references/feature-completeness.md references/usage-guide.md references/codex-contracts.md scripts/audit-plugin.mjs
git commit -m "docs: 完成情感配音流程与验收门禁"
```

## Completion Gate

- [ ] 合成端到端流程覆盖 timing、合同、三轮生成、八维审核、字幕、口型和失效传播。
- [ ] 真实镜头 A/B 报告绑定两版媒体 SHA，并由人工完整复听。
- [ ] 普通对白与旁白均无法绕过完整表演合同。
- [ ] 旧项目不会被静默补造词级时间或情绪证据。
- [ ] 全量集成自检、插件审计、版本验收和清单一致性检查全部通过。
