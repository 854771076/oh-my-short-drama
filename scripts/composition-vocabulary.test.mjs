import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promptSystemVars, injectPromptSystemVars, systemVariableNames } from './prompt-system-vars.mjs'

const pluginRoot = resolve(import.meta.dirname, '..')
const vocabulary = JSON.parse(await readFile(resolve(pluginRoot, 'references/controlled-vocabulary.json'), 'utf8'))
const patterns = vocabulary.cinematography.compositionPatterns
const reference = await readFile(resolve(pluginRoot, 'references/director-composition.md'), 'utf8')

const categories = ['basic', 'film', 'action', 'character']
const evidenceLevels = ['composition-only', 'set_dressing', 'weather_atmosphere', 'action_blocking']
const requiredCardFields = ['英文名', '画面结构', '叙事功能', '适用场景', '证据要求', '可组合模式', '禁忌/AI 风险', '竖屏提示']
const expectedNames = {
  basic: ['中轴平衡', '三分落点', '引导线推进', '对角线延展', '框景聚焦', '留白呼吸', '前景遮挡', '低位仰视', '高位俯视', 'S形动线', '层次分区', '近中远叠景', '负空间压缩', '重复秩序', '单点聚焦', '远景收束'],
  film: ['逆光剪影', '窗边侧光', '雨夜反光', '冷暖对撞', '雾气包裹', '长廊透视', '门缝窥视', '镜面映像', '压暗背景', '局部高光', '色块分割', '景深虚化', '廊柱节奏', '霓虹反射', '空镜铺陈', '静止等待'],
  action: ['低机位冲击', '斜构图失衡', '追逐透视', '前景掠过', '跃起定格', '多人对峙', '武器延伸线', '烟尘纵深', '反打压追', '环绕包围', '速度拖影', '爆点留白', '前后夹击', '雨战压缩', '群体冲锋', '尾势收镜'],
  character: ['背影独处', '窗前沉思', '双人对峙', '桌边谈判', '走廊相遇', '门口停顿', '侧脸凝视', '远近关系', '镜中自照', '借景抒情', '关系三角', '视线回避', '空间隔阂', '情绪特写', '背向离场', '结尾孤景'],
}

const byCode = new Map(patterns.map((item) => [item.code, item]))
const cards = parseCards(reference)

function parseCards(markdown) {
  const sections = markdown.split(/^### /m).slice(1)
  const result = new Map()
  for (const section of sections) {
    const headingEnd = section.indexOf('\n')
    const heading = section.slice(0, headingEnd).trim()
    const match = heading.match(/^(?:\d+\.\d+\s+)?(.+?)（(composition\.[a-z_]+\.[a-z_]+)）$/)
    if (!match) continue
    const [, zhName, code] = match
    result.set(code, { zhName, body: section.slice(headingEnd + 1) })
  }
  return result
}

function fieldValue(body, label) {
  const match = body.match(new RegExp(`^- ${label}：(.+)$`, 'm'))
  return match ? match[1].trim() : null
}

test('构图受控词表覆盖 64 模式，code 唯一且四组各 16 个', () => {
  assert.equal(patterns.length, 64)
  const codes = patterns.map((item) => item.code)
  assert.equal(new Set(codes).size, 64)
  for (const category of categories) {
    const group = patterns.filter((item) => item.category === category)
    assert.equal(group.length, 16, `${category} 应有 16 个模式`)
    assert.deepEqual(group.map((item) => item.zh), expectedNames[category])
    for (const item of group) {
      assert.match(item.code, new RegExp(`^composition\\.${category}\\.[a-z_]+$`))
      assert.ok(item.en.length > 0)
      assert.ok(Array.isArray(item.risks))
      for (const risk of item.risks) assert.equal(typeof risk, 'string')
    }
  }
})

test('evidence 为合法等级或以 + 连接的复合证据，各组件均属四个等级', () => {
  for (const item of patterns) {
    const components = item.evidence.split('+')
    assert.ok(components.length >= 1 && components.length <= 2, `${item.code} evidence 组件数非法`)
    assert.equal(new Set(components).size, components.length, `${item.code} evidence 组件重复`)
    for (const component of components) {
      assert.ok(evidenceLevels.includes(component), `${item.code} evidence 组件非法：${component}`)
    }
  }
  assert.equal(byCode.get('composition.action.rain_fight').evidence, 'weather_atmosphere+action_blocking')
})

test('64 个模式在参考文档中均有卡片，卡片十字段齐全且名称/证据与 JSON 一致', () => {
  assert.equal(cards.size, 64)
  for (const item of patterns) {
    const card = cards.get(item.code)
    assert.ok(card, `${item.code} 缺少文档卡片`)
    assert.equal(card.zhName, item.zh, `${item.code} 卡片中文名与词表不一致`)
    for (const label of requiredCardFields) {
      assert.ok(fieldValue(card.body, label), `${item.code} 卡片缺少字段：${label}`)
    }
    assert.equal(fieldValue(card.body, '英文名'), item.en, `${item.code} 英文名与词表不一致`)
    const evidenceLine = fieldValue(card.body, '证据要求')
    for (const component of item.evidence.split('+')) {
      assert.ok(evidenceLine.includes(component), `${item.code} 卡片证据要求未覆盖 ${component}`)
    }
  }
})

test('JSON 风险码与文档 0.4 风险码表完全一致（无缺失、无孤儿）', () => {
  const riskSection = reference.slice(reference.indexOf('### 0.4'), reference.indexOf('## 1.'))
  const documented = new Set([...riskSection.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]))
  const used = new Set(patterns.flatMap((item) => item.risks))
  assert.ok(documented.size >= 10, '风险码表解析结果异常偏少')
  assert.deepEqual([...used].sort(), [...documented].sort())
  for (const item of patterns) assert.equal(new Set(item.risks).size, item.risks.length, `${item.code} risks 重复`)
})

test('每张卡片的可组合模式 code 全部可解析，且卡片列出的风险在词表中登记', () => {
  for (const item of patterns) {
    const card = cards.get(item.code)
    const comboLine = fieldValue(card.body, '可组合模式')
    const references = comboLine.match(/composition\.(?:basic|film|action|character)\.[a-z_]+/g) || []
    assert.ok(references.length >= 1, `${item.code} 未列出任何可组合模式`)
    for (const referenceCode of references) {
      assert.ok(byCode.has(referenceCode), `${item.code} 引用了不存在的模式：${referenceCode}`)
      assert.notEqual(referenceCode, item.code, `${item.code} 把自己列为可组合模式`)
    }
    const riskLine = fieldValue(card.body, '禁忌/AI 风险')
    for (const risk of item.risks) {
      assert.ok(riskLine.includes(risk), `${item.code} 卡片风险行缺少词表登记的风险码 ${risk}`)
    }
  }
})

test('文档写明四个证据等级、选择流程与无证据硬规则', () => {
  for (const level of evidenceLevels) assert.match(reference, new RegExp(level))
  assert.match(reference, /确定本镜唯一首要可读信息/)
  for (const keyword of ['主体位置', '视线与留白', '前中后景', '光源', '遮挡', '动作方向', '镜尾状态']) {
    assert.match(reference, new RegExp(keyword))
  }
  assert.match(reference, /无证据不得添加雨/)
})

test('构图枚举紧凑注入中英文模板变量且不包含完整长文档', () => {
  assert.ok(systemVariableNames.has('cinematography_vocabulary'))
  for (const locale of ['zh', 'en']) {
    const injected = promptSystemVars(locale).cinematography_vocabulary
    for (const item of patterns) {
      assert.ok(injected.includes(item[locale]), `${locale} 缺少 ${item.code}`)
      assert.equal(injected.split(item[locale]).length - 1, 1, `${locale} 中 ${item.code} 名称重复注入`)
    }
    assert.ok(!injected.includes('画面结构') && !injected.includes('叙事功能') && !injected.includes('竖屏提示'), `${locale} 注入了长文档内容`)
    assert.ok(injected.length < 4000)
  }
  const rendered = injectPromptSystemVars('{cinematography_vocabulary}', 'zh')
  assert.match(rendered, /中轴平衡/)
  assert.equal(rendered.includes('{cinematography_vocabulary}'), false)
})
