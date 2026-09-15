# 人物银幕吸引力与妆造一致性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为有独立视觉身份的人物建立可验证的成年银幕魅力、儿童可爱度、专属妆造、记忆锚点和跨镜继承合同。

**Architecture:** `character-appeal.mjs` 只负责年龄证据与 `audience_appeal` 的纯合同校验；人物档案与图像提示词负责编译妆造，引用清单与连续性计划负责跨镜传播；独立审核门禁负责阻止年龄误判、儿童成人化和记忆点漂移。旧人物库保持可读，但重新生成人物视觉资产或正式视频前必须补齐合同。

**Tech Stack:** Node.js ESM、Node test runner、JSON Schema、现有人物档案/资产/审核账本与提示词系统。

**Spec:** `docs/superpowers/specs/2026-09-16-continuity-audio-media-pipeline-design.md` 第 7、12–14 节

## Global Constraints

- 年龄只能来自剧本或已批准人物档案；不得根据姓名、职业、关系或外表猜测。
- 明确成年且具备独立视觉身份的人类角色必须使用 `adult-charisma`；S/A 级需要 2–3 个记忆锚点，B–D 级至少 1 个。
- 儿童只使用 `child-cuteness`，禁止成人妆容、成人化服装、性感姿态、身体曲线强调和性化镜头语言。
- “无明显彩妆”可以是成年妆造决定，但发型、仪容、服装轮廓、材质和角色专属记忆点不能省略。
- 未知年龄进入 `unresolved`，不得生成人物定妆图或引用该人物提交正式视频。
- 人物魅力不能覆盖年代、职业、阶层、伤病、剧情状态、内容分级或已有资产证据。

---

### Task 1: `audience_appeal` 纯合同与人物档案迁移门禁

**Files:**
- Create: `scripts/character-appeal.mjs`
- Create: `scripts/character-appeal.test.mjs`
- Modify: `scripts/character-profiles.mjs`
- Modify: `skills/generate-character-profiles/references/character-profile-output.schema.json`

**Interfaces:**
- Produces: `classifyAgeRange(ageRange: string): 'adult'|'child'|'unknown'`
- Produces: `validateAudienceAppeal(value: object, context: {age_range:string,gender:string,role_level:string,is_human?:boolean}): object`
- Produces: `assertCharacterReadyForVisuals(character: object): void`

- [ ] **Step 1: Write the failing age and appeal tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertCharacterReadyForVisuals, classifyAgeRange, validateAudienceAppeal } from './character-appeal.mjs'

const adult = { age_class: 'adult', appeal_mode: 'adult-charisma', screen_presence: '克制但锋利', grooming_and_makeup: '利落短发与干净修容', costume_signature: '修身深色外套与哑光金属领扣', memory_anchors: ['左眉浅疤', '不对称领扣'], prohibited_treatment: ['色情化构图', '无剧情依据的裸露'] }

test('只从明确年龄范围分类', () => {
  assert.equal(classifyAgeRange('28岁'), 'adult')
  assert.equal(classifyAgeRange('8岁儿童'), 'child')
  assert.equal(classifyAgeRange('年龄未提供'), 'unknown')
})

test('S级成年人物必须有两个以上记忆锚点', () => {
  assert.equal(validateAudienceAppeal(adult, { age_range: '28岁', gender: 'male', role_level: 'S' }).appeal_mode, 'adult-charisma')
  assert.throws(() => validateAudienceAppeal({ ...adult, memory_anchors: ['左眉浅疤'] }, { age_range: '28岁', gender: 'male', role_level: 'S' }), /2–3/)
})

test('儿童成人化和未知年龄都阻止视觉生成', () => {
  assert.throws(() => validateAudienceAppeal({ ...adult, age_class: 'child', appeal_mode: 'child-cuteness', costume_signature: '性感修身礼服' }, { age_range: '8岁', gender: 'female', role_level: 'A' }), /儿童保护/)
  assert.throws(() => assertCharacterReadyForVisuals({ age_range: '未提供稳定证据', audience_appeal: { age_class: 'unknown', appeal_mode: 'not-applicable', screen_presence: '', grooming_and_makeup: '', costume_signature: '', memory_anchors: [], prohibited_treatment: [] } }), /年龄证据/)
})
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --test scripts/character-appeal.test.mjs`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `character-appeal.mjs`.

- [ ] **Step 3: Implement the discriminated validator and schema**

```js
const ADULT_WORDS = /(?:成年|青年|中年|老年|年轻男|年轻女)/
const CHILD_WORDS = /(?:儿童|幼儿|男童|女童|小学生|少年|少女)/
const CHILD_PROHIBITED = /(?:性感|妩媚|成熟妆|成人妆|低胸|曲线|挑逗)/
const FIELDS = ['age_class', 'appeal_mode', 'screen_presence', 'grooming_and_makeup', 'costume_signature', 'memory_anchors', 'prohibited_treatment']

export function classifyAgeRange(value) {
  const text = String(value || '')
  const age = Number(text.match(/(?:^|\D)(\d{1,3})\s*岁/)?.[1])
  if (Number.isInteger(age)) return age >= 18 ? 'adult' : 'child'
  if (ADULT_WORDS.test(text)) return 'adult'
  if (CHILD_WORDS.test(text)) return 'child'
  return 'unknown'
}

export function validateAudienceAppeal(value, context) {
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...FIELDS].sort())) throw new Error('audience_appeal 字段不完整')
  const expectedAge = context.is_human === false ? 'not-applicable' : classifyAgeRange(context.age_range)
  if (expectedAge !== 'not-applicable' && value.age_class !== expectedAge) throw new Error('audience_appeal 年龄分级与证据不一致')
  if (expectedAge === 'adult') {
    if (value.appeal_mode !== 'adult-charisma') throw new Error('成年人物必须使用 adult-charisma')
    const minimum = ['S', 'A'].includes(context.role_level) ? 2 : 1
    if (!Array.isArray(value.memory_anchors) || value.memory_anchors.length < minimum || value.memory_anchors.length > 3) throw new Error(`成年人物记忆锚点必须为 ${minimum === 2 ? '2–3' : '1–3'} 项`)
  }
  if (expectedAge === 'child' && (value.appeal_mode !== 'child-cuteness' || CHILD_PROHIBITED.test(Object.values(value).flat().join(' ')))) throw new Error('儿童保护规则失败')
  return structuredClone(value)
}
```

Add `audience_appeal` to `NEW_FIELDS` and the JSON Schema `required` list. The schema uses the seven exact keys above and enums `adult|child|unknown|not-applicable` plus `adult-charisma|child-cuteness|not-applicable`; `character-profiles.mjs` calls `validateAudienceAppeal` from `validateNew`.

- [ ] **Step 4: Run profile contract regression**

Run: `node --test scripts/character-appeal.test.mjs && node scripts/character-profiles.mjs --self-check`  
Expected: PASS; a new confirmed adult without `audience_appeal` fails validation while an existing stored profile remains readable.

- [ ] **Step 5: Commit**

```bash
git add scripts/character-appeal.mjs scripts/character-appeal.test.mjs scripts/character-profiles.mjs skills/generate-character-profiles/references/character-profile-output.schema.json
git commit -m "feat: 新增人物银幕吸引力合同"
```

### Task 2: 人物档案与定妆提示词编译

**Files:**
- Modify: `skills/generate-character-profiles/assets/prompts/agent_character_profile.zh.txt`
- Modify: `skills/generate-character-profiles/assets/prompts/agent_character_profile.en.txt`
- Modify: `skills/generate-character-images/assets/prompts/agent_character_visual.zh.txt`
- Modify: `skills/generate-character-images/assets/prompts/agent_character_visual.en.txt`
- Modify: `skills/generate-character-images/assets/prompts/character_asset_sheet.zh.txt`
- Modify: `skills/generate-character-images/assets/prompts/character_asset_sheet.en.txt`
- Create: `scripts/character-appeal-prompts.test.mjs`

**Interfaces:**
- Consumes: validated `character.audience_appeal`
- Produces: visual descriptions that explicitly preserve `grooming_and_makeup`, `costume_signature` and every `memory_anchor`

- [ ] **Step 1: Write a failing prompt coverage test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('中英文人物提示词覆盖成年魅力和儿童保护', async () => {
  for (const path of ['skills/generate-character-profiles/assets/prompts/agent_character_profile.zh.txt', 'skills/generate-character-images/assets/prompts/agent_character_visual.zh.txt', 'skills/generate-character-images/assets/prompts/character_asset_sheet.zh.txt']) {
    const text = await readFile(path, 'utf8')
    for (const token of ['audience_appeal', 'adult-charisma', 'child-cuteness', 'memory_anchors']) assert.ok(text.includes(token), `${path} 缺少 ${token}`)
    assert.match(text, /儿童.*(?:成人化|性化)/s)
  }
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/character-appeal-prompts.test.mjs`  
Expected: FAIL listing the missing contract tokens.

- [ ] **Step 3: Update prompt contracts with exact output behavior**

Add the seven-key `audience_appeal` object to the character profile output contract. For confirmed adults, instruct the model to design character-specific screen presence, deliberate grooming/makeup, costume silhouette/material and role-level memory anchors without adding unsupported biography or props. For children, require age-appropriate cuteness and write the five protection bans verbatim. In the visual and asset-sheet prompts, require every generated candidate and every view to keep the approved hairstyle silhouette, costume signature and memory anchors; later appearances may change only fields justified by `change_reason`.

```text
成年角色的吸引力必须服务人物、时代和剧情：用眼神、姿态、妆发、服装轮廓、材质与记忆锚点形成银幕磁场；禁止用裸露、身体部位夸张或模板化网红脸代替设计。
儿童只允许健康、灵动、童真、年龄匹配的可爱表达；禁止成人妆容、成人化服装、性感姿态、身体曲线强调和性化镜头语言。
```

- [ ] **Step 4: Run prompt, profile and plugin checks**

Run: `node --test scripts/character-appeal-prompts.test.mjs scripts/character-appeal.test.mjs && node scripts/character-profiles.mjs --self-check && node scripts/audit-plugin.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/generate-character-profiles/assets/prompts skills/generate-character-images/assets/prompts scripts/character-appeal-prompts.test.mjs
git commit -m "feat: 完善角色妆造与记忆点提示词"
```

### Task 3: 跨镜引用与连续性传播

**Files:**
- Modify: `scripts/reference-bindings.mjs`
- Modify: `scripts/continuity-plan.mjs`
- Modify: `skills/build-drama-storyboard/assets/prompts/agent_storyboard_detail.zh.txt`
- Modify: `skills/build-drama-storyboard/assets/prompts/agent_storyboard_detail.en.txt`
- Modify: `skills/write-drama-video-prompts/assets/prompts/h3_video.zh.txt`
- Modify: `skills/write-drama-video-prompts/assets/prompts/h3_video.en.txt`
- Modify: `skills/write-drama-video-prompts/assets/prompts/seedance2_video.zh.txt`
- Modify: `skills/write-drama-video-prompts/assets/prompts/seedance2_video.en.txt`
- Create: `scripts/character-identity-binding.test.mjs`

**Interfaces:**
- Produces reference entry fields: `identity_binding: {profile_name:string,profile_sha256:string,appearance_id:number}` and `identity_constraints: {age_class:string,grooming_and_makeup:string,costume_signature:string,memory_anchors:string[]}`
- Produces continuity actor field: `visual_identity: {appearance_id:number,memory_anchors:string[],costume_signature:string}`
- Produces: `resolveCharacterProfile(root: string, reference: object): Promise<object>`
- Produces: `validateCharacterIdentityBinding(root: string, reference: object): Promise<void>`

- [ ] **Step 1: Write failing binding and continuity tests**

```js
test('正式视频人物引用必须绑定当前档案的全部记忆锚点', async () => {
  await assert.rejects(validateCharacterIdentityBinding(root, { asset_key: 'character-linwan', version_id: 'v001', identity_constraints: { age_class: 'adult', grooming_and_makeup: '利落短发', costume_signature: '深色长外套', memory_anchors: ['左眉浅疤'] } }), /记忆锚点/)
})

test('无证据换装不能改变跨镜 visual_identity', () => {
  assert.match(compareAdjacentStates(previousWithIdentity, currentWithChangedCostume)[0].field, /visual_identity/)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/character-identity-binding.test.mjs`  
Expected: FAIL because the binding validator and `visual_identity` comparison are absent.

- [ ] **Step 3: Bind the selected profile and propagate only visible identity fields**

```js
export async function validateCharacterIdentityBinding(root, reference) {
  const profile = await resolveCharacterProfile(root, reference)
  assertCharacterReadyForVisuals(profile)
  const expected = profile.audience_appeal
  const actual = reference.identity_constraints
  if (JSON.stringify(actual?.memory_anchors) !== JSON.stringify(expected.memory_anchors)) throw new Error('人物引用记忆锚点与当前档案不一致')
  for (const field of ['age_class', 'grooming_and_makeup', 'costume_signature']) if (actual?.[field] !== expected[field]) throw new Error(`人物引用 ${field} 与当前档案不一致`)
}

export async function resolveCharacterProfile(root, reference) {
  const binding = reference.identity_binding
  if (!binding?.profile_name || !/^[a-f0-9]{64}$/.test(binding.profile_sha256 || '') || !Number.isInteger(binding.appearance_id)) throw new Error('人物引用缺少明确 identity_binding')
  const path = resolve(root, 'assets/characters/profiles.json')
  const bytes = await readFile(path)
  if (createHash('sha256').update(bytes).digest('hex') !== binding.profile_sha256) throw new Error('人物档案已换版，引用失效')
  const profile = JSON.parse(bytes).characters.find((item) => item.name === binding.profile_name)
  if (!profile) throw new Error('人物引用无法解析到唯一档案')
  return profile
}
```

Extend continuity actor validation with the three-key `visual_identity`. Add `visual_identity` to adjacent-state comparison and `inherited_fields`; only an evidence-backed `allowed_changes` entry may change appearance ID or costume signature. Prompt contracts copy visible constraints into shot descriptions without exposing protected metadata or inventing new anchors.

`resolveCharacterProfile` validates the bound profile file SHA-256, exact profile name and appearance ID; it rejects missing or ambiguous bindings and never guesses from `asset_key` text. Import `readFile` from `node:fs/promises`, `createHash` from `node:crypto` and `resolve` from `node:path` in `reference-bindings.mjs`.

- [ ] **Step 4: Run continuity and prompt regression**

Run: `node --test scripts/character-identity-binding.test.mjs scripts/continuity-plan.test.mjs scripts/previous-tail-binding.test.mjs && node scripts/project-store.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/reference-bindings.mjs scripts/continuity-plan.mjs scripts/character-identity-binding.test.mjs skills/build-drama-storyboard/assets/prompts skills/write-drama-video-prompts/assets/prompts
git commit -m "feat: 保持人物妆造与记忆点跨镜一致"
```

### Task 4: 人物视觉专项审核与选版保护

**Files:**
- Create: `scripts/character-appeal-review.mjs`
- Create: `scripts/character-appeal-review.test.mjs`
- Modify: `scripts/review-ledger.mjs`
- Modify: `skills/generate-character-images/SKILL.md`
- Modify: `skills/review-drama-shots/SKILL.md`

**Interfaces:**
- Produces: `validateCharacterAppealReview(character: object, review: object): void`
- Produces review fields: `age_classification`, `identity`, `grooming_costume`, `memory_anchors`, `audience_appeal`, `protection_flags`, `watched_or_inspected_full`, `approved`

- [ ] **Step 1: Write failing hard-gate tests**

```js
test('儿童保护失败不能由高美观分抵消', () => {
  assert.throws(() => validateCharacterAppealReview(child, { approved: true, beauty_score: 100, watched_or_inspected_full: true, age_classification: '符合', identity: '稳定', grooming_costume: '年龄匹配', memory_anchors: '稳定', audience_appeal: '可爱', protection_flags: ['出现成人化妆容'] }), /儿童保护/)
})

test('成年角色缺少妆造或锚点观察不能批准', () => {
  assert.throws(() => validateCharacterAppealReview(adultCharacter, { approved: true, watched_or_inspected_full: true, age_classification: '成年', identity: '稳定', audience_appeal: '有银幕魅力', protection_flags: [] }), /grooming_costume|memory_anchors/)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `node --test scripts/character-appeal-review.test.mjs`  
Expected: FAIL with missing review validator.

- [ ] **Step 3: Implement non-compensating review gates**

```js
const REQUIRED = ['age_classification', 'identity', 'grooming_costume', 'memory_anchors', 'audience_appeal']
export function validateCharacterAppealReview(character, review) {
  for (const field of REQUIRED) if (!String(review?.[field] || '').trim()) throw new Error(`人物视觉审核缺少 ${field}`)
  if (review.watched_or_inspected_full !== true) throw new Error('人物视觉必须完整检查')
  if (!Array.isArray(review.protection_flags)) throw new Error('人物视觉审核缺少 protection_flags')
  if (character.audience_appeal.age_class === 'child' && review.protection_flags.length) throw new Error('儿童保护失败，禁止批准')
  if (review.approved && review.protection_flags.length) throw new Error('保护性规则失败不能被评分抵消')
}
```

Wire `review-ledger.mjs` so character-image selection requires this exact review for the candidate version. Existing selected assets remain readable; any new candidate or reselection uses the hard gate.

- [ ] **Step 4: Run review and asset regressions**

Run: `node --test scripts/character-appeal-review.test.mjs && node scripts/review-ledger.mjs --self-check && node scripts/asset-ledger.mjs --self-check`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/character-appeal-review.mjs scripts/character-appeal-review.test.mjs scripts/review-ledger.mjs skills/generate-character-images/SKILL.md skills/review-drama-shots/SKILL.md
git commit -m "feat: 增加人物视觉吸引力审核门禁"
```

### Task 5: 流程文档与插件覆盖审计

**Files:**
- Modify: `references/pipeline.md`
- Modify: `references/feature-completeness.md`
- Modify: `references/skill-map.json`
- Modify: `skills/plan-drama-assets/SKILL.md`
- Modify: `skills/write-drama-video-prompts/SKILL.md`
- Modify: `scripts/audit-plugin.mjs`

**Interfaces:**
- Documents and audits `audience_appeal`, age evidence, adult/child modes, identity propagation and selection gates

- [ ] **Step 1: Add failing audit requirements**

Require the exact tokens `audience_appeal`, `adult-charisma`, `child-cuteness`, `grooming_and_makeup`, `costume_signature`, `memory_anchors`, `assertCharacterReadyForVisuals` and `validateCharacterAppealReview` in their owning schema, prompts, skills and references.

- [ ] **Step 2: Run audit and verify red**

Run: `node scripts/audit-plugin.mjs --self-check`  
Expected: FAIL listing files that do not yet expose the new character contract.

- [ ] **Step 3: Document the exact stage gates**

```text
人物档案：年龄证据 → audience_appeal 校验 → 人物定妆候选 → 人物专项审核与选版 → 分镜/白模/正式视频引用绑定 → 跨镜一致性复核。
未知年龄停在人物档案；儿童保护失败停在候选审核；成年人缺少妆造或记忆锚点停在提示词编译。任何失败都不得用总体美观分抵消。
```

- [ ] **Step 4: Run the full character stage audit**

Run:

```bash
node --test scripts/character-appeal.test.mjs scripts/character-appeal-prompts.test.mjs scripts/character-identity-binding.test.mjs scripts/character-appeal-review.test.mjs
node scripts/character-profiles.mjs --self-check
node scripts/integration-self-check.mjs
node scripts/audit-plugin.mjs --self-check
git diff --check
```

Expected: every command PASS and the integration self-check writes only inside its temporary project.

- [ ] **Step 5: Commit**

```bash
git add references/pipeline.md references/feature-completeness.md references/skill-map.json skills/plan-drama-assets/SKILL.md skills/write-drama-video-prompts/SKILL.md scripts/audit-plugin.mjs
git commit -m "docs: 纳入人物魅力与儿童保护流程"
```
