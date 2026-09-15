import { createHash } from 'node:crypto'

const definitions = {
  hot: { title: '热力榜', dateEndpoint: '/playlet/getHotRankingDate', listEndpoint: '/playlet/listHotRanking', params: {} },
  motion: { title: '动态漫榜', dateEndpoint: '/playlet/motionComicDate', listEndpoint: '/playlet/motionComic', params: { rankType: 1 } },
  'motion-ai': { title: '真人AI榜', dateEndpoint: '/playlet/motionComicDate', listEndpoint: '/playlet/motionComic', params: { rankType: 2 } },
  'motion-comedy': { title: '沙雕漫榜', dateEndpoint: '/playlet/motionComicDate', listEndpoint: '/playlet/motionComic', params: { rankType: 3 } },
  douyin: { title: '抖音热播榜', dateEndpoint: '/playlet/getNativePlayCountDate', listEndpoint: '/playlet/selectNativePlayletPlayCountListByDate', params: {} },
  kuaishou: { title: '快手热播榜', dateEndpoint: '/playlet/getKuaishouNativePlayCountDate', listEndpoint: '/playlet/selectKuaishouNativePlayletPlayCountListByDate', params: {} },
  hongguo: { title: '红果榜', dateEndpoint: '/playlet/listHongGuoRankingDate', listEndpoint: '/playlet/listHongGuoRanking', params: {} },
  income: { title: '短剧收入榜', dateEndpoint: null, listEndpoint: '/playlet/getPlayletRevenueRankData', params: {} },
}

for (const definition of Object.values(definitions)) {
  Object.freeze(definition.params)
  Object.freeze(definition)
}

export const rankingDefinitions = Object.freeze(definitions)

const PERIOD_KEYS = ['day', 'week', 'month']
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

class JuchachaError extends Error {
  constructor(code, endpoint, message) {
    super(message)
    this.code = code
    this.endpoint = endpoint
  }

  toJSON() {
    return { code: this.code, endpoint: this.endpoint, message: this.message }
  }
}

function error(code, endpoint, message) {
  return new JuchachaError(code, endpoint, message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function shanghaiDate(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now 必须是有效日期')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function dateSignature(now = new Date()) {
  return createHash('md5').update(shanghaiDate(now)).digest('hex')
}

function selectedPeriod(periods) {
  if (!isRecord(periods)) throw error('JUCHACHA_INVALID_RESPONSE', null, '周期参数必须是对象')
  const selected = PERIOD_KEYS.filter((key) => periods[key] !== undefined && periods[key] !== null && periods[key] !== '')
  if (selected.length > 1) throw error('JUCHACHA_INVALID_RESPONSE', null, 'day、week、month 只能选择一个周期')
  return selected[0] ? { key: selected[0], value: periods[selected[0]] } : null
}

function publicErrorMessage(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isTimeout(errorValue) {
  return errorValue?.name === 'TimeoutError' || errorValue?.name === 'AbortError' || errorValue?.code === 'ABORT_ERR'
}

export function createJuchachaClient({
  baseUrl = 'https://playlet-applet.dataeye.com',
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = 20_000,
} = {}) {
  const rootUrl = String(baseUrl).replace(/\/+$/, '')

  function requestUrl(endpoint, params = {}) {
    const url = new URL(`${rootUrl}${endpoint}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    return url
  }

  async function request(endpoint, params, contentKind) {
    const url = requestUrl(endpoint, params)
    let response
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          S: dateSignature(now()),
          authentication: '',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (caught) {
      if (isTimeout(caught)) throw error('JUCHACHA_TIMEOUT', endpoint, '剧查查请求超时')
      throw error('JUCHACHA_HTTP_ERROR', endpoint, '剧查查请求失败')
    }

    if (!response || response.ok === false || (Number.isInteger(response.status) && response.status >= 400)) {
      throw error('JUCHACHA_HTTP_ERROR', endpoint, '剧查查返回 HTTP 错误')
    }

    let payload
    try {
      if (typeof response.json !== 'function') throw new TypeError('response.json 不可用')
      payload = await response.json()
    } catch (caught) {
      if (isTimeout(caught)) throw error('JUCHACHA_TIMEOUT', endpoint, '剧查查请求超时')
      throw error('JUCHACHA_INVALID_RESPONSE', endpoint, '剧查查返回内容不是有效 JSON')
    }

    if (!isRecord(payload)) throw error('JUCHACHA_INVALID_RESPONSE', endpoint, '剧查查返回对象无效')
    if (typeof payload.statusCode !== 'number' || payload.statusCode !== 200) {
      throw error('JUCHACHA_API_ERROR', endpoint, publicErrorMessage(payload.message, '剧查查接口返回业务错误'))
    }
    if (contentKind === 'list' && !Array.isArray(payload.content)) {
      throw error('JUCHACHA_INVALID_RESPONSE', endpoint, '剧查查榜单内容无效')
    }
    if (contentKind === 'date' && !isRecord(payload.content) && typeof payload.content !== 'string') {
      throw error('JUCHACHA_INVALID_RESPONSE', endpoint, '剧查查日期内容无效')
    }
    return payload
  }

  async function fetchLatestDay(definition) {
    const payload = await request(definition.dateEndpoint, definition.params, 'date')
    const content = payload.content
    const day = typeof content === 'string' ? content : content.day
    if (typeof day !== 'string' || !DATE_PATTERN.test(day)) {
      throw error('JUCHACHA_INVALID_RESPONSE', definition.dateEndpoint, '剧查查最新日期无效')
    }
    return day
  }

  async function fetchRanking(type, periods = {}) {
    if (!Object.hasOwn(rankingDefinitions, type)) {
      throw error('JUCHACHA_INVALID_RESPONSE', null, `未知榜单类型：${String(type)}`)
    }
    const definition = rankingDefinitions[type]
    const period = selectedPeriod(periods)
    let chosenPeriod = period
    if (!chosenPeriod && definition.dateEndpoint) {
      chosenPeriod = { key: 'day', value: await fetchLatestDay(definition) }
    }

    const params = {
      ...definition.params,
      ...(chosenPeriod ? { [chosenPeriod.key]: chosenPeriod.value } : {}),
      pageId: 1,
      pageSize: 30,
    }
    return request(definition.listEndpoint, params, 'list')
  }

  async function fetchAllRankings(periods = {}) {
    const types = Object.keys(rankingDefinitions)
    const settled = await Promise.allSettled(types.map((type) => fetchRanking(type, periods)))
    const rankings = {}
    const failures = []
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]
      const type = types[index]
      if (result.status === 'fulfilled') {
        rankings[type] = result.value
      } else {
        const reason = result.reason
        failures.push({
          type,
          code: reason?.code || 'JUCHACHA_INVALID_RESPONSE',
          endpoint: reason?.endpoint ?? rankingDefinitions[type].listEndpoint,
          message: publicErrorMessage(reason?.message, '剧查查榜单请求失败'),
        })
      }
    }
    return { rankings, failures }
  }

  return Object.freeze({ fetchRanking, fetchAllRankings })
}
