import { createHash } from 'node:crypto'

const TITLE_ROOTS = Object.freeze([
  [['都市日常'], ['都市情感', '都市']],
  [['总裁'], ['霸道总裁', '霸总', '总裁']],
  [['甜宠'], ['甜宠']],
  [['末日重生'], ['末日重生']],
  [['重生', '穿越'], ['重生穿越']],
  [['重生'], ['重生']],
  [['穿越'], ['穿越']],
  [['战神归来'], ['战神归来', '战神']],
  [['古装宫廷'], ['古装宫廷', '宫廷', '宫斗']],
  [['逆袭'], ['励志逆袭', '逆袭']],
  [['家庭伦理'], ['家庭伦理']],
  [['萌宝'], ['萌宝']],
  [['悬疑推理'], ['悬疑探案', '悬疑', '探案', '推理']],
  [['软科幻'], ['软科幻', '科幻']],
  [['喜剧'], ['喜剧']],
])

const TOPIC_TAXONOMY = Object.freeze([
  [['重生', '穿越'], ['重生穿越']],
  [['古装宫廷'], ['古装宫廷', '宫廷', '宫斗', '古装']],
  [['都市日常'], ['都市情感', '都市', '职场', '爱情', '情感', '日常']],
  [['总裁'], ['霸道总裁', '霸总', '总裁']],
  [['悬疑推理'], ['悬疑探案', '悬疑', '探案', '推理']],
  [['逆袭'], ['励志逆袭', '逆袭']],
  [['家庭伦理'], ['家庭伦理', '婆媳', '伦理', '家庭']],
  [['末日重生'], ['末日重生', '末日', '丧尸']],
  [['重生'], ['重生']],
  [['穿越'], ['穿越']],
  [['战神归来'], ['战神归来', '战神']],
  [['软科幻'], ['软科幻', '科幻']],
  [['萌宝'], ['萌宝']],
  [['喜剧'], ['喜剧', '搞笑']],
])

const NON_TOPIC_TAGS = new Set([
  '真人', '短剧', '微短剧', '短视频', '已完结', '完结', '连载中', '连载', '热播', '新剧', '上新', '独播',
])

const AUDIENCE_LABELS = new Map([
  ['男频', '男频'],
  ['女频', '女频'],
  ['男女通吃', '男女通吃'],
  ['全年龄', '全年龄'],
])

const ERA_LABELS = new Map([
  ['现代', '现代'],
  ['当代', '当代'],
  ['近现代', '近现代'],
  ['古代', '古代'],
  ['古装', '古装'],
  ['民国', '民国'],
  ['未来', '未来'],
  ['末世', '末世'],
])

const FIELD_ALIASES = Object.freeze({
  id: ['playletId', 'playletID', 'id', 'shortDramaId'],
  title: ['playletName', 'name', 'title'],
  ranking: ['ranking', 'rank', 'topNum'],
  heatValue: ['consumeNum', 'hotValue', 'heatValue', 'playCount', 'playCountRaw', 'viewCount'],
  growthValue: ['playCountAddRaw', 'growthValue', 'growth', 'increase', 'increaseValue', 'playCountAdd'],
  isNew: ['newFlag', 'isNew', 'new'],
  persistenceDays: ['persistenceDays', 'listDays', 'topDays'],
  companies: ['relatedPartyCompany', 'companyNames', 'company'],
  tags: ['playletTags', 'tags', 'genres', 'genre', 'topics', 'topic', 'subjectTags'],
  audience: ['audience', 'targetAudience'],
  era: ['era', 'period', 'timeType'],
  format: ['format', 'contentFormat', 'playletFormat'],
})

const COMPANY_ROLE_ALIASES = Object.freeze({
  platform: ['platformList', 'relatedPartyCompany', 'playletUserList', 'playletUser'],
  contractor: ['contractorList', 'contractorCompany'],
  copyrightHolder: ['copyrightHolderList', 'copyrightHolderCompany'],
  producer: ['producerList', 'manufacturer', 'companyNames', 'company'],
})

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizedText(value) {
  if (typeof value !== 'string') return ''
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function compactText(value) {
  return normalizedText(value).replace(/\s+/gu, '')
}

function compactLabel(value) {
  if (typeof value !== 'string') return ''
  return value.normalize('NFKC').trim().replace(/\s+/gu, '')
}

function sourceValue(item, aliases, accept = (value) => value !== undefined && value !== null && value !== '') {
  for (const alias of aliases) {
    if (Object.hasOwn(item, alias) && accept(item[alias])) return { value: item[alias], source: alias }
  }
  return { value: undefined, source: undefined }
}

function sourceValues(item, aliases) {
  const values = []
  const sources = []
  for (const alias of aliases) {
    if (!Object.hasOwn(item, alias)) continue
    const value = item[alias]
    if (value === undefined || value === null || value === '') continue
    values.push(value)
    sources.push(alias)
  }
  return { values, sources }
}

function safeNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const text = value.replaceAll(',', '').trim()
  if (!text) return undefined
  const number = Number(text)
  return Number.isFinite(number) ? number : undefined
}

function firstSafeNumber(item, aliases, validate = () => true) {
  for (const alias of aliases) {
    if (!Object.hasOwn(item, alias)) continue
    const value = safeNumber(item[alias])
    if (value !== undefined && validate(value)) return { value, source: alias }
  }
  return { value: null, source: undefined }
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1
  if (typeof value !== 'string') return undefined
  const normalized = compactText(value).toLowerCase()
  if (['1', 'true', 'yes', 'y', '是', '新'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', '否', '旧'].includes(normalized)) return false
  return undefined
}

function firstBoolean(item, aliases) {
  for (const alias of aliases) {
    if (!Object.hasOwn(item, alias)) continue
    const value = normalizeBoolean(item[alias])
    if (value !== undefined) return { value, source: alias }
  }
  return { value: null, source: undefined }
}

function flattenListValue(value, result) {
  if (Array.isArray(value)) {
    for (const entry of value) flattenListValue(entry, result)
    return
  }
  if (value === null || value === undefined) return
  if (typeof value !== 'string' && typeof value !== 'number') return
  const text = cleanListToken(value)
  if (text) result.push(text)
}

function cleanListToken(value) {
  let text = String(value).trim()
  text = text.replace(/^[\[\]"'“”]+/u, '').replace(/[\[\]"'“”]+$/u, '').trim()
  if (!text || /^(?:null|undefined)$/iu.test(text)) return null
  return text
}

function isSourceTopicTag(tag) {
  const label = compactLabel(tag)
  if (!label) return false
  if (/(?:非|不|无|不是|拒绝|榜|第\d|推荐|热播|用户|运营|热门|官方|投票|点击|播放|指数|数据|排序)/u.test(label)) return false
  return true
}

export function parseList(value) {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    try {
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? parseList(parsed) : []
    } catch {
      // 非法 JSON 按普通标签字符串处理，避免一条脏数据中断整榜归一化。
    }
    const result = []
    flattenListValue(text.split(/[,，;；|/、]/u), result)
    return [...new Set(result)]
  }
  const result = []
  flattenListValue(value, result)
  return [...new Set(result)]
}

function companyNames(value) {
  if (Array.isArray(value)) return [...new Set(value.flatMap((entry) => companyNames(entry)))]
  if (isRecord(value)) {
    for (const key of ['publisherName', 'companyName', 'manufacturerName', 'name']) {
      const name = normalizedText(value[key])
      if (name) return [name]
    }
    return []
  }
  return parseList(value)
}

function normalizeCompanies(source) {
  return Object.fromEntries(Object.entries(COMPANY_ROLE_ALIASES).map(([role, aliases]) => [
    role,
    [...new Set(aliases.flatMap((alias) => Object.hasOwn(source, alias) ? companyNames(source[alias]) : []))],
  ]))
}

function labelValue(values, labels) {
  for (const value of values) {
    const label = labels.get(compactText(value))
    if (label) return label
  }
  return null
}

function titleTopics(title) {
  const compactTitle = compactText(title)
  if (!compactTitle) return []
  const result = []
  for (const [topics, roots] of TITLE_ROOTS) {
    if (roots.some((root) => compactTitle.includes(compactText(root)))) result.push(...topics)
  }
  return [...new Set(result)]
}

function canonicalTopics(rawTopic) {
  const label = compactLabel(rawTopic)
  const matched = TOPIC_TAXONOMY.find(([, aliases]) => aliases.some((alias) => label.includes(compactLabel(alias))))
  return matched?.[0] ?? [rawTopic]
}

function mapTopics(rawTopics, source) {
  const mappings = rawTopics.flatMap((rawTopic) => canonicalTopics(rawTopic).map((canonicalTopic) => ({ rawTopic, canonicalTopic, source })))
  return {
    topics: [...new Set(mappings.map(({ canonicalTopic: topic }) => topic))],
    mappings,
  }
}

function detectFormat(values, rankingType) {
  for (const entry of values) {
    const text = compactText(entry.value)
    if (text.includes('真人AI') || text.includes('AI真人')) return { value: '真人AI', source: entry.source }
    if (text.includes('沙雕漫')) return { value: '沙雕漫', source: entry.source }
    if (text.includes('动态漫') || text.includes('动态漫画')) return { value: '动态漫', source: entry.source }
  }
  if (rankingType === 'motion-ai') return { value: '真人AI', source: 'rankingType' }
  if (rankingType === 'motion-comedy') return { value: '沙雕漫', source: 'rankingType' }
  if (rankingType === 'motion') return { value: '动态漫', source: 'rankingType' }
  return { value: null, source: undefined }
}

function titleHash(title) {
  return createHash('sha256').update(compactText(title)).digest('hex')
}

function normalizedId(value) {
  if (value === undefined || value === null || typeof value === 'object' || typeof value === 'boolean') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

function firstValidSource(item, aliases, validate) {
  for (const alias of aliases) {
    if (!Object.hasOwn(item, alias)) continue
    const value = validate(item[alias])
    if (value !== null && value !== undefined) return { value, source: alias }
  }
  return { value: null, source: undefined }
}

function rankingItems(value) {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return []
  for (const key of ['content', 'data', 'list', 'rows', 'items']) {
    if (Array.isArray(value[key])) return value[key]
  }
  return []
}

export function normalizeRankingItem(rankingType, item, context = {}) {
  const source = isRecord(item) ? item : {}
  const observedAt = context?.observedAt ?? source.observedAt ?? null
  const idSource = firstValidSource(source, FIELD_ALIASES.id, normalizedId)
  const titleSource = firstValidSource(source, FIELD_ALIASES.title, (value) => {
    if (typeof value !== 'string' || !value.trim()) return null
    return normalizedText(value)
  })
  const title = titleSource.value ?? ''
  const playletId = idSource.value
  if (playletId === null && title === '') return null
  const tagSource = sourceValues(source, FIELD_ALIASES.tags)
  const tagEntries = tagSource.values.flatMap((value, index) => parseList(value).map((tag) => ({ value: tag, source: tagSource.sources[index] })))
  const uniqueTagEntries = [...new Map(tagEntries.map((entry) => [entry.value, entry])).values()]
  const uniqueTags = uniqueTagEntries.map(({ value }) => value)
  const sourceTopics = uniqueTags.filter((tag) => {
    const label = compactLabel(tag)
    return isSourceTopicTag(tag)
      && !AUDIENCE_LABELS.has(label)
      && !ERA_LABELS.has(label)
      && !NON_TOPIC_TAGS.has(label)
      && detectFormat([{ value: tag, source: '' }], '').value === null
  })
  const formatSource = sourceValue(source, FIELD_ALIASES.format)
  const formatEntries = [
    ...(formatSource.value === undefined ? [] : parseList(formatSource.value).map((value) => ({ value, source: formatSource.source }))),
    ...uniqueTagEntries,
  ]
  const format = detectFormat(formatEntries, rankingType)
  const audienceSource = sourceValue(source, FIELD_ALIASES.audience)
  const explicitAudience = audienceSource.value === undefined ? null : labelValue(parseList(audienceSource.value), AUDIENCE_LABELS)
  const audience = explicitAudience || labelValue(uniqueTags, AUDIENCE_LABELS)
  const eraSource = sourceValue(source, FIELD_ALIASES.era)
  const explicitEra = eraSource.value === undefined ? null : labelValue(parseList(eraSource.value), ERA_LABELS)
  const era = explicitEra || labelValue(uniqueTags, ERA_LABELS)
  const inferredTopics = titleTopics(title)
  const rawTopics = sourceTopics.length > 0 ? sourceTopics : inferredTopics
  const topicSource = sourceTopics.length > 0 ? 'source-tag' : (inferredTopics.length > 0 ? 'title-keyword' : 'unclassified')
  const mappedTopics = mapTopics(rawTopics, topicSource)
  const topics = mappedTopics.topics.length > 0 ? mappedTopics.topics : ['未分类']
  const ranking = firstSafeNumber(source, FIELD_ALIASES.ranking, (value) => Number.isInteger(value) && value >= 1)
  const heatValue = firstSafeNumber(source, FIELD_ALIASES.heatValue)
  const growthValue = firstSafeNumber(source, FIELD_ALIASES.growthValue)
  const persistenceDays = firstSafeNumber(source, FIELD_ALIASES.persistenceDays, (value) => Number.isInteger(value) && value >= 0)
  const isNew = firstBoolean(source, FIELD_ALIASES.isNew)
  const companySource = sourceValues(source, [...new Set([...FIELD_ALIASES.companies, ...Object.values(COMPANY_ROLE_ALIASES).flat()])])
  const companies = normalizeCompanies(source)
  const key = playletId === null ? `title-hash:${titleHash(title)}` : `playlet-id:${playletId}`

  const sourceFields = {}
  for (const [name, value] of Object.entries({
    playletId: idSource.source,
    title: titleSource.source,
    ranking: ranking.source,
    heatValue: heatValue.source,
    growthValue: growthValue.source,
    isNew: isNew.source,
    persistenceDays: persistenceDays.source,
    companies: companySource.sources.length ? companySource.sources : undefined,
    tags: tagSource.sources.length ? tagSource.sources : undefined,
    audience: explicitAudience ? audienceSource.source : (audience ? 'tags' : undefined),
    era: explicitEra ? eraSource.source : (era ? 'tags' : undefined),
    format: format.source,
  })) {
    if (value !== undefined) sourceFields[name] = value
  }

  return {
    key,
    playletId,
    title,
    rankingType: String(rankingType ?? ''),
    ranking: ranking.value,
    observedAt,
    topics,
    rawTopics,
    audience,
    era,
    format: format.value,
    heatValue: heatValue.value,
    growthValue: growthValue.value,
    isNew: isNew.value,
    persistenceDays: persistenceDays.value,
    companies,
    provenance: {
      rankingType: String(rankingType ?? ''),
      topicSource,
      topicMappings: mappedTopics.mappings,
      rawRef: {
        snapshotId: context?.snapshotId ?? null,
        rankingType: String(rankingType ?? ''),
        playletId,
      },
      sourceFields,
      evidence: {
        rawTags: uniqueTags,
        sourceTags: uniqueTags,
        titleKeywords: inferredTopics,
      },
    },
  }
}

export function normalizeRankings(rankings, context = {}) {
  if (Array.isArray(rankings)) {
    return rankings.map((item) => normalizeRankingItem(item?.rankingType ?? context?.rankingType ?? '', item, context)).filter(Boolean)
  }
  if (!isRecord(rankings)) return []
  const result = []
  for (const [rankingType, value] of Object.entries(rankings)) {
    for (const item of rankingItems(value)) {
      const observation = normalizeRankingItem(rankingType, item, context)
      if (observation) result.push(observation)
    }
  }
  return result
}

function firstNonEmpty(values) {
  return values.find((value) => value !== null && value !== undefined && value !== '') ?? null
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]))
  return value
}

export function mergePlayletObservations(items) {
  const groups = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (!isRecord(item)) continue
    const key = item.key ?? `title-hash:${titleHash(item.title ?? '')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }

  return [...groups.entries()].map(([key, observations]) => {
    const topics = [...new Set(observations.flatMap((item) => item.topics || []))]
    const usefulTopics = topics.filter((topic) => topic !== '未分类')
    return {
      key,
      playletId: firstNonEmpty(observations.map((item) => item.playletId)),
      title: firstNonEmpty(observations.map((item) => item.title)),
      topics: usefulTopics.length > 0 ? usefulTopics : ['未分类'],
      audience: firstNonEmpty(observations.map((item) => item.audience)),
      era: firstNonEmpty(observations.map((item) => item.era)),
      format: firstNonEmpty(observations.map((item) => item.format)),
      companies: Object.fromEntries(Object.keys(COMPANY_ROLE_ALIASES).map((role) => [role, [...new Set(observations.flatMap((item) => item.companies?.[role] || []))]])),
      rankingTypes: [...new Set(observations.map((item) => item.rankingType))],
      rankings: observations.map((item) => ({
        rankingType: item.rankingType,
        ranking: item.ranking,
        heatValue: item.heatValue,
        growthValue: item.growthValue,
        isNew: item.isNew,
        persistenceDays: item.persistenceDays,
        provenance: cloneValue(item.provenance),
      })),
      observations: observations.map((item) => cloneValue(item)),
    }
  })
}
