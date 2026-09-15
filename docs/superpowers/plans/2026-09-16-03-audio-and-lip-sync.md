# 原生音频优先、语音兜底与对口型实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 严格吸收 CosyVoice 声音描述合同，默认由视频模型直出对白、旁白、环境声和动作声，并在可审计失败后支持角色配音、电影感旁白、外部音频和可插拔对口型。

**Architecture:** `voice-description.mjs` 校验角色音色描述；`audio-plan-contract.mjs` 把声音来源、画面呈现和兜底方式拆成正交字段；视频提示词和 `native-audio-audit.mjs` 完成原生音频生成与审核；受控兜底通过不可变音频资产和统一 `media-operation` 完成，MuseTalk 只是可替换的口型 Provider。

**Tech Stack:** Node.js ESM、Node test runner、FFmpeg/FFprobe、现有 Bailian/StarRouter TTS 与 ASR、MuseTalk 1.5 可选本地连接器、统一媒体操作 MCP。

**Spec:** `docs/superpowers/specs/2026-09-16-continuity-audio-media-pipeline-design.md` 第 8、12–14 节

## Global Constraints

- CosyVoice 自然语言声音描述不超过 50 个中文加权字符，必须明确性别、年龄段和 2–4 个有档案证据的声音特征。
- 视频模型原生音频优先；先尝试满足视觉资产约束的原生音频 Provider，之后才允许兜底。
- `delivery_mode` 只能是 `native|post_dub|external_audio`；`presentation` 只能是 `visible-dialogue|offscreen-dialogue|narration`；两者不能混为一个枚举。
- 原生失败必须记录受控 `reason`、失败证据、替换区间和最终混音来源，禁止无记录整轨覆盖。
- 旁白优先原生直出，必须有逐节拍电影感表演合同；兜底只能使用独立 narrator 音色，除非剧本明确角色兼任叙述者。
- “背景音原生直出”只包括环境声和动作声；BGM 继续由独立配乐与许可证流程管理。
- 只有可见对白且使用独立音频的区间可以对口型；旁白、画外音、合格原生对白和无法唯一归属的人脸禁止执行。

---

### Task 1: CosyVoice 声音描述硬合同

**Files:**
- Create: `scripts/generation/voice-description.mjs`
- Create: `scripts/generation/voice-description.test.mjs`
- Modify: `scripts/generation/bailian.mjs`
- Modify: `skills/design-drama-audio/assets/prompts/character_voice_description.zh.txt`
- Modify: `skills/design-drama-audio/assets/prompts/character_voice_description.en.txt`
- Modify: `skills/design-drama-audio/SKILL.md`
- Modify: `scripts/audit-plugin.mjs`

**Interfaces:**
- Produces: `validateVoiceDescription(text: string, profile: {gender:string,age_range:string,name?:string}): {text:string,traits:string[]}`
- Consumes: `weightedLength` exported by `scripts/generation/bailian.mjs`

- [ ] **Step 1: Write failing contract tests from the approved CosyVoice rules**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateVoiceDescription } from './voice-description.mjs'

const profile = { name: '林晚', gender: 'female', age_range: '年轻女性' }
test('接受性别年龄和四个声音特征', () => {
  assert.equal(validateVoiceDescription('年轻女性，音色清亮，语速平稳，表达冷静，略带磁性', profile).traits.length, 4)
})
test('缺少性别年龄时拒绝', () => {
  assert.throws(() => validateVoiceDescription('音色清亮，语速平稳', profile), /性别和年龄段/)
})
test('人物名、剧情、前缀和五项特征均拒绝', () => {
  for (const value of ['林晚是年轻女性，清亮温柔', '年轻女性，剧情中声音清亮', '声音描述：年轻女性，清亮温柔', '年轻女性，低沉、舒缓、温柔、磁性、沙哑']) assert.throws(() => validateVoiceDescription(value, profile))
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/generation/voice-description.test.mjs`  
Expected: FAIL with missing `voice-description.mjs`.

- [ ] **Step 3: Implement portable validation without runtime dependency on the external source file**

```js
const GENDER_AGE = /(少年|少女|年轻|青年|中年|老年).{0,4}(男|女)(性|声)?|(男|女)(性|声)?.{0,4}(少年|少女|年轻|青年|中年|老年)/
const TRAITS = ['低沉','清亮','高亢','沙哑','浑厚','温暖','磁性','鼻音','娃娃音','舒缓','急促','平稳','稍快','温柔','冷峻','威严','活泼','甜美','沧桑','自然','亲切']

export function validateVoiceDescription(input, profile) {
  const text = String(input || '').trim()
  if (!text || weightedLength(text) > 50) throw new Error('声音描述必须为 50 个中文加权字符以内')
  if (!GENDER_AGE.test(text)) throw new Error('声音描述必须明确性别和年龄段')
  if (profile.name && text.includes(profile.name)) throw new Error('声音描述不得包含人物名')
  if (/声音描述[:：]|[“”"#]|剧情|台词|模仿/.test(text)) throw new Error('声音描述包含禁止内容')
  const traits = [...new Set(TRAITS.filter((trait) => text.includes(trait)))]
  if (traits.length < 2 || traits.length > 4) throw new Error('声音描述必须包含 2–4 个声音特征')
  return { text, traits }
}
```

Copy the five behavioral rules from `/Users/xiaomao/Documents/fuyang/waoowaoo/.worktrees/github_test/lib/prompts/novel-promotion/character_voice_recommend_cosy.zh.txt` into the repository-owned prompt in adapted wording, retaining the plugin’s anti-stereotype and no-real-person-imitation rules. Do not reference the external absolute path at runtime and do not modify that source file.

- [ ] **Step 4: Run focused and plugin checks**

Run: `node --test scripts/generation/voice-description.test.mjs && node scripts/generation/bailian.mjs --self-check && node scripts/audit-plugin.mjs --self-check`  
Expected: PASS; audit verifies `50`、`性别`、`年龄段`、`2–4` and the five prohibited-content tokens.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/voice-description.mjs scripts/generation/voice-description.test.mjs scripts/generation/bailian.mjs skills/design-drama-audio scripts/audit-plugin.mjs
git commit -m "feat: 严格吸收 CosyVoice 声音描述合同"
```

### Task 2: 原生优先声音计划与三层语义合同

**Files:**
- Create: `scripts/audio-plan-contract.mjs`
- Create: `scripts/audio-plan-contract.test.mjs`
- Modify: `scripts/project-store.mjs`
- Modify: `scripts/document-reference.mjs`
- Modify: `skills/design-drama-audio/assets/prompts/voice_analysis.zh.txt`
- Modify: `skills/design-drama-audio/assets/prompts/voice_analysis.en.txt`
- Modify: `skills/design-drama-audio/SKILL.md`

**Interfaces:**
- Produces: `validateAudioStrategy(strategy: object): void`
- Produces: `validateAudioLine(line: object, index: number): void`
- Produces: `validateAudioPlan(document: object, episodeKey: string): object`
- Produces: `migrateLegacyAudioLine(line: object): {line:object,unresolved:string[]}`
- Produces line fields: `delivery_mode`, `presentation`, `fallback_mode`, `source_audio`, `voice_binding`, `native_audio_exception`, `performance`

- [ ] **Step 1: Write failing discriminated-contract tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateLegacyAudioLine, validateAudioLine, validateAudioStrategy } from './audio-plan-contract.mjs'

const base = { line_index: 1, speaker: '林晚', line_type: 'dialogue', content: '别回头。', emotion: '克制紧张', emotion_strength: 0.3, pronunciation_notes: [], matched_shot: { shot_number: 1 }, delivery_mode: 'native', presentation: 'visible-dialogue', fallback_mode: 'post-dub', source_audio: null, voice_binding: null, native_audio_exception: null, performance: null }

test('native-first 策略列出全部受控失败原因', () => {
  assert.doesNotThrow(() => validateAudioStrategy({ mode: 'native-first', provider_selection: 'prefer-native', fallback_allowed: true, fallback_reasons: ['provider-no-native-audio','voice-identity-drift','speech-intelligibility-failed','narration-performance-failed','audio-sync-failed','native-ambience-failed'] }))
})
test('来源和画面呈现不允许混用', () => {
  assert.throws(() => validateAudioLine({ ...base, delivery_mode: 'narration' }, 0), /delivery_mode/)
  assert.throws(() => validateAudioLine({ ...base, presentation: 'native' }, 0), /presentation/)
})
test('电影感旁白必须有可执行表演合同', () => {
  assert.throws(() => validateAudioLine({ ...base, speaker: 'narrator', line_type: 'voiceover', presentation: 'narration', performance: null }, 0), /旁白.*表演合同/)
})
test('旧 narration 只迁移呈现方式并留下来源未决项', () => {
  const migrated = migrateLegacyAudioLine({ ...base, delivery_mode: 'narration' })
  assert.equal(migrated.line.presentation, 'narration')
  assert.match(migrated.unresolved[0], /声音来源/)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/audio-plan-contract.test.mjs`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement exact enums, fallback evidence and narration performance**

```js
const DELIVERY = new Set(['native', 'post_dub', 'external_audio'])
const PRESENTATION = new Set(['visible-dialogue', 'offscreen-dialogue', 'narration'])
const FALLBACK = new Set(['none', 'post-dub', 'cinematic-tts', 'sound-design'])
const FAILURE_REASONS = new Set(['provider-no-native-audio','voice-identity-drift','speech-intelligibility-failed','narration-performance-failed','audio-sync-failed','native-ambience-failed'])
const PERFORMANCE_FIELDS = ['tone_arc', 'emotion_beats', 'pace', 'breath_and_pause', 'distance_and_space']

export function validateAudioStrategy(strategy) {
  if (strategy?.mode !== 'native-first' || strategy.provider_selection !== 'prefer-native' || strategy.fallback_allowed !== true) throw new Error('audio_strategy 必须启用 native-first 受控兜底')
  if (!Array.isArray(strategy.fallback_reasons) || strategy.fallback_reasons.length !== FAILURE_REASONS.size || strategy.fallback_reasons.some((reason) => !FAILURE_REASONS.has(reason))) throw new Error('audio_strategy fallback_reasons 不完整')
}

export function validateAudioLine(line, index) {
  if (!DELIVERY.has(line.delivery_mode)) throw new Error(`audio-plan lines[${index}].delivery_mode 无效`)
  if (!PRESENTATION.has(line.presentation)) throw new Error(`audio-plan lines[${index}].presentation 无效`)
  if (!FALLBACK.has(line.fallback_mode)) throw new Error(`audio-plan lines[${index}].fallback_mode 无效`)
  if (line.presentation === 'narration' && (!line.performance || PERFORMANCE_FIELDS.some((field) => !line.performance[field] || field === 'emotion_beats' && !Array.isArray(line.performance[field])))) throw new Error('旁白必须提供完整电影感表演合同')
  if (line.delivery_mode === 'external_audio' && (!line.source_audio?.asset_key || !/^v\d{3}$/.test(line.source_audio.version_id || ''))) throw new Error('外部音频必须绑定资产版本')
  if (line.native_audio_exception && (!FAILURE_REASONS.has(line.native_audio_exception.reason) || !line.native_audio_exception.evidence || !Number.isInteger(line.native_audio_exception.range?.start_ms) || !Number.isInteger(line.native_audio_exception.range?.end_ms))) throw new Error('原生音频兜底证据无效')
}

export function validateAudioPlan(document, episodeKey) {
  if (document.episode_key !== episodeKey) throw new Error('audio-plan episode_key 不一致')
  validateAudioStrategy(document.audio_strategy)
  document.lines.forEach(validateAudioLine)
  if (document.approved && document.unresolved.length) throw new Error('audio-plan 存在未决项时不得批准')
  return structuredClone(document)
}

export function migrateLegacyAudioLine(line) {
  const legacyPresentation = line.delivery_mode === 'narration' ? 'narration' : line.delivery_mode === 'offscreen' ? 'offscreen-dialogue' : line.visible_speaker === false ? 'offscreen-dialogue' : 'visible-dialogue'
  if (['narration', 'offscreen'].includes(line.delivery_mode)) return { line: { ...line, delivery_mode: null, presentation: legacyPresentation, fallback_mode: 'none', native_audio_exception: null, performance: null }, unresolved: [`第 ${line.line_index} 行声音来源缺少证据`] }
  return { line: { ...line, presentation: legacyPresentation, fallback_mode: 'none', native_audio_exception: null, performance: null }, unresolved: [] }
}
```

Add top-level `audio_strategy` to new `audio-plan` documents. Preserve old plan readability through a separate read-time migration path; `put-episode-document` validates only the new schema and rejects unresolved migrated lines from approval.

- [ ] **Step 4: Run store and migration regression**

Run: `node --test scripts/audio-plan-contract.test.mjs && node scripts/project-store.mjs --self-check && node scripts/document-reference.mjs --self-check`  
Expected: PASS; old plans read without mutation, new plans cannot approve missing source evidence.

- [ ] **Step 5: Commit**

```bash
git add scripts/audio-plan-contract.mjs scripts/audio-plan-contract.test.mjs scripts/project-store.mjs scripts/document-reference.mjs skills/design-drama-audio
git commit -m "feat: 建立原生优先声音计划合同"
```

### Task 3: 视频模型原生音频提示词与 Provider 路由

**Files:**
- Modify: `scripts/generation/providers.mjs`
- Modify: `scripts/generation/mcp.mjs`
- Modify: `scripts/project-store.mjs`
- Create: `scripts/audio-prompt-policy.mjs`
- Modify: `skills/write-drama-video-prompts/SKILL.md`
- Modify: `skills/write-drama-video-prompts/assets/prompts/h3_video.zh.txt`
- Modify: `skills/write-drama-video-prompts/assets/prompts/h3_video.en.txt`
- Modify: `skills/write-drama-video-prompts/assets/prompts/seedance2_video.zh.txt`
- Modify: `skills/write-drama-video-prompts/assets/prompts/seedance2_video.en.txt`
- Create: `scripts/native-audio-routing.test.mjs`

**Interfaces:**
- Produces capability: `video.native-audio`
- Produces: `selectVideoProviderForAudio(input: {requestedProvider?:string,visualCapabilities:string[],audioStrategy:object}): {provider:string,model:string,native_audio:boolean,reasons:string[]}`
- Produces: `compileAudioPolicy(shot: object): string`
- Consumes shot `audio_policy` copied from the approved audio plan

- [ ] **Step 1: Write failing routing and prompt tests**

```js
test('视觉约束相同且允许自动选择时优先原生音频 Provider', () => {
  assert.deepEqual(selectVideoProviderForAudio({ visualCapabilities: ['video.reference-image'], audioStrategy: nativeFirst, candidates }), { provider: 'runninghub', model: 'minimax-h3-reference-to-video', native_audio: true, reasons: ['video.native-audio'] })
})
test('用户锁定不支持原生音频的 Provider 时返回可审计异常而非静默 TTS', () => {
  const result = selectVideoProviderForAudio({ requestedProvider: 'visual-only', visualCapabilities: [], audioStrategy: nativeFirst, candidates })
  assert.equal(result.reasons[0], 'provider-no-native-audio')
})
test('旁白提示词必须逐项包含电影感表演节拍', () => {
  assert.match(compileAudioPolicy(narrationShot), /tone arc|emotion beat|breath|pause|distance/i)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/native-audio-routing.test.mjs`  
Expected: FAIL because fine-grained capability and routing function are absent.

- [ ] **Step 3: Add capability-aware native-first routing and exact prompt contract**

```js
export function selectVideoProviderForAudio({ requestedProvider, visualCapabilities, audioStrategy, candidates }) {
  const eligible = candidates.filter((candidate) => visualCapabilities.every((capability) => candidate.capabilities[capability] === true))
  if (requestedProvider) {
    const locked = eligible.find((candidate) => candidate.provider === requestedProvider)
    if (!locked) throw new Error('锁定 Provider 不满足画面资产能力')
    return { provider: locked.provider, model: locked.model, native_audio: locked.capabilities['video.native-audio'] === true, reasons: locked.capabilities['video.native-audio'] ? ['video.native-audio'] : ['provider-no-native-audio'] }
  }
  const selected = eligible.find((candidate) => candidate.capabilities['video.native-audio'] === true) || eligible[0]
  if (!selected) throw new Error('没有满足画面与音频约束的视频 Provider')
  return { provider: selected.provider, model: selected.model, native_audio: selected.capabilities['video.native-audio'] === true, reasons: selected.capabilities['video.native-audio'] ? ['video.native-audio'] : ['provider-no-native-audio'] }
}

export function compileAudioPolicy(shot) {
  const lines = shot.audio_policy?.lines || []
  return lines.map((line) => line.presentation === 'narration'
    ? `Narration: ${line.content}; tone arc ${line.performance.tone_arc}; emotion beats ${line.performance.emotion_beats.join(' -> ')}; pace ${line.performance.pace}; breath and pause ${line.performance.breath_and_pause}; distance ${line.performance.distance_and_space}.`
    : `${line.speaker}: ${line.content}; delivery ${line.delivery_mode}; presentation ${line.presentation}.`).join('\n')
}
```

For native lines, prompts place exact speech, speaker, ambience, physical sound and timing on the shot timeline. Narration copies `tone_arc`, each `emotion_beat`, pace, breath/pause and spatial distance. Native mode explicitly asks for no undeclared BGM; post-dub mode asks for ambience/action sound only and no finished speech.

- [ ] **Step 4: Run provider, prompt and MCP regression**

Run: `node --test scripts/native-audio-routing.test.mjs && node scripts/generation/providers.mjs --self-check && node scripts/generation/mcp.mjs --self-check && node scripts/project-store.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/providers.mjs scripts/generation/mcp.mjs scripts/project-store.mjs scripts/audio-prompt-policy.mjs scripts/native-audio-routing.test.mjs skills/write-drama-video-prompts
git commit -m "feat: 优先使用视频模型原生音频"
```

### Task 4: 原生音频多维审核与受控兜底

**Files:**
- Modify: `scripts/native-audio-audit.mjs`
- Create: `scripts/native-audio-audit.test.mjs`
- Create: `scripts/audio-fallback.mjs`
- Create: `scripts/audio-fallback.test.mjs`
- Modify: `scripts/review-ledger.mjs`

**Interfaces:**
- Produces: `auditNativeAudio(input): Promise<{approved:boolean,dimensions:object,issues:string[],fallback_candidates:object[]}>`
- Produces: `validateNativeAudioReview(report: object): void`
- Produces: `planAudioFallback(report: object, lines: object[]): {replacements:object[],preserved_ranges:object[]}`
- Produces required dimensions: `speech_intelligibility`, `speaker_identity`, `narration_performance`, `ambience_action_sync`, `lip_sync`, `technical_audio`, `undeclared_music`

- [ ] **Step 1: Write failing audit and range-preservation tests**

```js
test('文件存在和响度合格不能代替电影感旁白复听', () => {
  assert.throws(() => validateNativeAudioReview({ approved: true, dimensions: { technical_audio: { passed: true } } }), /narration_performance/)
})
test('只替换失败区间并保留合格原生环境声', () => {
  const plan = planAudioFallback({ dimensions: { speech_intelligibility: { passed: false, ranges: [{ start_ms: 1000, end_ms: 2500 }] }, ambience_action_sync: { passed: true } } }, [dialogue])
  assert.deepEqual(plan.replacements[0].range, { start_ms: 1000, end_ms: 2500 })
  assert.equal(plan.preserved_ranges[0].kind, 'native-ambience-action')
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `node --test scripts/native-audio-audit.test.mjs scripts/audio-fallback.test.mjs`  
Expected: FAIL with missing exports/modules.

- [ ] **Step 3: Extend ASR evidence and require human performance observations**

```js
export function validateNativeAudioReview(report) {
  const required = ['speech_intelligibility','speaker_identity','narration_performance','ambience_action_sync','lip_sync','technical_audio','undeclared_music']
  for (const key of required) if (typeof report?.dimensions?.[key]?.passed !== 'boolean' || !String(report.dimensions[key].observation || '').trim()) throw new Error(`原生音频审核缺少 ${key}`)
  if (report.approved !== required.every((key) => report.dimensions[key].passed)) throw new Error('原生音频 approved 与分维度结果不一致')
}

export function planAudioFallback(report, lines) {
  const failedRanges = Object.entries(report.dimensions).flatMap(([dimension, value]) => value.passed ? [] : (value.ranges || []).map((range) => ({ dimension, range })))
  const replacements = failedRanges.map(({ dimension, range }) => ({ range, reason: dimension === 'speech_intelligibility' ? 'speech-intelligibility-failed' : dimension === 'narration_performance' ? 'narration-performance-failed' : dimension === 'ambience_action_sync' ? 'native-ambience-failed' : 'audio-sync-failed', line_indexes: lines.filter((line) => line.range.start_ms < range.end_ms && line.range.end_ms > range.start_ms).map((line) => line.line_index) }))
  const preserved_ranges = report.dimensions.ambience_action_sync?.passed ? [{ kind: 'native-ambience-action', range: report.full_range }] : []
  return { replacements, preserved_ranges }
}
```

Retain current ASR text/timing comparison as evidence for intelligibility. Add manual observation fields for character voice identity, narration emotional beats, ambience/action synchronization, visible lip timing and undeclared music. `planAudioFallback` maps only failed dimensions/ranges to allowed reasons and never replaces passing ranges.

- [ ] **Step 4: Run audit regression and self-check**

Run: `node --test scripts/native-audio-audit.test.mjs scripts/audio-fallback.test.mjs && node scripts/native-audio-audit.mjs --self-check && node scripts/review-ledger.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/native-audio-audit.mjs scripts/native-audio-audit.test.mjs scripts/audio-fallback.mjs scripts/audio-fallback.test.mjs scripts/review-ledger.mjs
git commit -m "feat: 增加原生音频多维审核与受控兜底"
```

### Task 5: 角色配音、电影感旁白与外部音频资产

**Files:**
- Modify: `scripts/generation/voice-tools.mjs`
- Modify: `scripts/generation/mcp.mjs`
- Modify: `scripts/asset-ledger.mjs`
- Create: `scripts/audio-fallback-flow.test.mjs`
- Modify: `skills/design-drama-audio/SKILL.md`

**Interfaces:**
- Produces MCP: `import_external_audio`
- Produces MCP: `generate_audio_fallback`
- Produces narrator binding: `{voice_role:'narrator',provider:string,model:string,voice_id:string,cinematic_profile:object}`
- Produces provenance: `{native_audio_exception,source_assets,replaced_ranges,mix_sources}`

- [ ] **Step 1: Write failing fallback asset tests**

```js
test('旁白兜底必须绑定 narrator 和电影感档案', async () => {
  await assert.rejects(call('generate_audio_fallback', { ...narrationRequest, voice_binding: characterVoice }), /narrator/)
})
test('外部音频必须有使用权确认和真实音频流', async () => {
  await assert.rejects(call('import_external_audio', { project_root: root, local_file: textFile, rights_confirmed: true, confirmed: true }), /音频流/)
})
test('兜底输出 provenance 保存异常、区间和混音来源', async () => {
  const result = await call('generate_audio_fallback', validDialogueFallback)
  assert.equal(result.provenance.native_audio_exception.reason, 'speech-intelligibility-failed')
  assert.deepEqual(result.provenance.replaced_ranges, [{ start_ms: 1000, end_ms: 2500 }])
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/audio-fallback-flow.test.mjs`  
Expected: FAIL because the MCP routes do not exist.

- [ ] **Step 3: Implement immutable import/generation and narrator separation**

```js
if (line.presentation === 'narration') {
  if (binding.voice_role !== 'narrator' || !binding.cinematic_profile) throw new Error('旁白兜底必须使用独立 narrator 电影感音色')
  if (binding.character_key && !line.narrator_is_character) throw new Error('剧本未声明角色兼任叙述者')
}
```

`import_external_audio` requires `usage_scope`, `rights_confirmed:true`, `confirmed:true`, probes a real audio stream and registers a new selected candidate without auto-selecting it. `generate_audio_fallback` requires an approved failed native audit, exact failed range and matching `fallback_mode`; it generates only that line/range and records the original video/audio plus generated asset in provenance.

- [ ] **Step 4: Run audio provider and asset checks**

Run: `node --test scripts/audio-fallback-flow.test.mjs && node scripts/generation/voice-tools.mjs --self-check && node scripts/generation/mcp.mjs --self-check && node scripts/asset-ledger.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/voice-tools.mjs scripts/generation/mcp.mjs scripts/asset-ledger.mjs scripts/audio-fallback-flow.test.mjs skills/design-drama-audio/SKILL.md
git commit -m "feat: 支持电影感旁白与语音兜底资产"
```

### Task 6: MuseTalk Provider 与对口型审核闭环

**Files:**
- Create: `scripts/generation/musetalk.mjs`
- Create: `scripts/generation/musetalk.test.mjs`
- Modify: `scripts/generation/providers.mjs`
- Modify: `scripts/media-operation-contract.mjs`
- Modify: `scripts/generation/mcp.mjs`
- Modify: `scripts/media-operation-review.mjs`
- Modify: `scripts/editing-store.mjs`
- Create: `scripts/lip-sync-flow.test.mjs`
- Modify: `.mcp.json`
- Modify: `.claude-plugin/mcp.json`

**Interfaces:**
- Produces provider: `musetalk.transform(input): Promise<{provider:'musetalk',status:'completed',outputs:Array<{path:string,media_type:'video'}>,model:'musetalk-1.5'}>`
- Requires environment: `MUSETALK_ROOT`; optional `MUSETALK_PYTHON`
- Consumes operation: `submit_media_operation(operation='lip-sync')`

- [ ] **Step 1: Write failing async Provider and eligibility tests**

```js
test('MuseTalk 只接受唯一可见脸的 lip-sync', async () => {
  const result = await musetalk.transform({ operation: 'lip-sync', source_video_path: video, source_audio_path: audio, output_path: output, face_selector: { mode: 'single-visible-face' }, confirmed: true })
  assert.equal(result.outputs[0].path, output)
  await assert.rejects(musetalk.transform({ operation: 'video-upscale' }), /lip-sync/)
})
test('旁白、画外音、合格原生对白和多人脸禁止口型操作', async () => {
  for (const input of [narrationRequest, offscreenRequest, approvedNativeRequest, multipleFacesRequest]) await assert.rejects(call('submit_media_operation', input), /不得执行对口型|唯一可见人脸/)
})
test('未通过口型专项审核不能进入时间线', async () => {
  await assert.rejects(validateTimeline(root, lipSyncedTimeline), /口型专项审核/)
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `node --test scripts/generation/musetalk.test.mjs scripts/lip-sync-flow.test.mjs`  
Expected: FAIL with missing Provider and flow gate.

- [ ] **Step 3: Implement optional local connector and exact eligibility check**

```js
export const musetalk = {
  label: 'MuseTalk Local', credentialEnv: null,
  catalog: { transform: ['musetalk-1.5'] },
  capabilities: { image: false, video: false, audio: false, 'transform.lip-sync': true },
  async transform(input) {
    if (input.operation !== 'lip-sync') throw new Error('MuseTalk 只支持 lip-sync')
    if (input.face_selector?.mode !== 'single-visible-face') throw new Error('MuseTalk 当前只允许唯一可见人脸')
    if (!process.env.MUSETALK_ROOT) throw new Error('MUSETALK_ROOT 未配置')
    await runConfiguredPython(process.env.MUSETALK_PYTHON || 'python3', input)
    await assertVideoOutput(input.output_path)
    return { provider: 'musetalk', status: 'completed', outputs: [{ path: input.output_path, media_type: 'video' }], model: 'musetalk-1.5' }
  },
}
```

Use `spawn`/`execFile` argument arrays, never install or download models. Resolve the approved audio-plan line before submission; require `presentation:visible-dialogue`, `delivery_mode:post_dub|external_audio`, exact selected line audio, unique face selector and a source video covering the range. Register both sources in provenance. Timeline selection requires the exact approved `lip-sync` review.

- [ ] **Step 4: Run Provider, MCP and editing regression**

Run: `node --test scripts/generation/musetalk.test.mjs scripts/lip-sync-flow.test.mjs && node scripts/generation/providers.mjs --self-check && node scripts/generation/mcp.mjs --self-check && node scripts/editing-store.mjs --self-check`  
Expected: PASS with a fake executable and no model/network access.

- [ ] **Step 5: Commit**

```bash
git add scripts/generation/musetalk.mjs scripts/generation/musetalk.test.mjs scripts/generation/providers.mjs scripts/media-operation-contract.mjs scripts/generation/mcp.mjs scripts/media-operation-review.mjs scripts/editing-store.mjs scripts/lip-sync-flow.test.mjs .mcp.json .claude-plugin/mcp.json
git commit -m "feat: 接入可配置对口型与审核闭环"
```

### Task 7: 声音流程文档与插件审计

**Files:**
- Modify: `skills/design-drama-audio/SKILL.md`
- Modify: `skills/edit-drama-timeline/SKILL.md`
- Modify: `skills/drama-generation-service/SKILL.md`
- Modify: `skills/write-drama-video-prompts/SKILL.md`
- Modify: `references/feature-completeness.md`
- Modify: `references/pipeline.md`
- Modify: `references/usage-guide.md`
- Modify: `scripts/audit-plugin.mjs`

**Interfaces:**
- Documents and audits native-first routing, three-layer audio semantics, cinematic narration, exceptions, external audio and lip-sync

- [ ] **Step 1: Add failing audit requirements**

Require `native-first`, all six fallback reason codes, the three enum sets, `cinematic-tts`, `native_audio_exception`, `video.native-audio`, `MUSETALK_ROOT`, `transform.lip-sync`, all seven native-audio review dimensions, and the rule that BGM remains independent.

- [ ] **Step 2: Run audit and verify red**

Run: `node scripts/audit-plugin.mjs --self-check`  
Expected: FAIL listing incomplete Skills or reference files.

- [ ] **Step 3: Document the executable decision flow**

```text
先选择同时满足画面资产和 video.native-audio 的 Provider → 原生生成对白、旁白、环境声、动作声 → ASR 与人工七维复听 → 合格则保留原声 → 失败则记录 reason/evidence/range → 只替换失败区间 → 可见独立对白按需对口型 → 专项审核通过后进入时间线。BGM 始终走独立配乐流程。
```

- [ ] **Step 4: Run all audio-stage checks**

Run:

```bash
node --test scripts/generation/voice-description.test.mjs scripts/audio-plan-contract.test.mjs scripts/native-audio-routing.test.mjs scripts/native-audio-audit.test.mjs scripts/audio-fallback.test.mjs scripts/audio-fallback-flow.test.mjs scripts/generation/musetalk.test.mjs scripts/lip-sync-flow.test.mjs
node scripts/native-audio-audit.mjs --self-check
node scripts/integration-self-check.mjs
node scripts/audit-plugin.mjs --self-check
git diff --check
```

Expected: every command PASS without contacting a paid Provider or installing MuseTalk.

- [ ] **Step 5: Commit**

```bash
git add skills/design-drama-audio/SKILL.md skills/edit-drama-timeline/SKILL.md skills/drama-generation-service/SKILL.md skills/write-drama-video-prompts/SKILL.md references/feature-completeness.md references/pipeline.md references/usage-guide.md scripts/audit-plugin.mjs
git commit -m "docs: 完善原生音频与受控配音流程"
```
