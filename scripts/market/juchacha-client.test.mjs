import test from 'node:test'
import assert from 'node:assert/strict'
import { createJuchachaClient, dateSignature, rankingDefinitions } from './juchacha-client.mjs'

test('上海日期固定样本生成已验证签名', () => {
  assert.equal(dateSignature(new Date('2026-09-16T08:00:00Z')), '0cdf73ff2b30ed7aa6206fde112bee77')
})

test('热力榜先解析最新日期再请求 Top 30', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    return Response.json(calls.length === 1
      ? { statusCode: 200, content: { day: '2026-09-14' }, page: null, message: null }
      : { statusCode: 200, content: [{ ranking: 1, playletName: '样例剧' }], page: { pageId: 1, pageSize: 30 }, message: null })
  }
  const client = createJuchachaClient({ fetchImpl, now: () => new Date('2026-09-16T08:00:00Z') })
  const result = await client.fetchRanking('hot')
  assert.equal(result.content[0].playletName, '样例剧')
  assert.match(calls[1].url, /day=2026-09-14/)
  assert.equal(calls[1].options.headers.S, '0cdf73ff2b30ed7aa6206fde112bee77')
  assert.equal(calls[1].options.headers.authentication, '')
})

test('8 类榜单定义完整且收入榜不请求日期接口', () => {
  assert.deepEqual(Object.keys(rankingDefinitions), ['hot', 'motion', 'motion-ai', 'motion-comedy', 'douyin', 'kuaishou', 'hongguo', 'income'])
  assert.equal(rankingDefinitions.income.dateEndpoint, null)
})

function response(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

test('收入榜直接请求榜单且固定分页', async () => {
  const calls = []
  const client = createJuchachaClient({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      return response({ statusCode: 200, content: [], page: { pageId: 1, pageSize: 30 }, message: null })
    },
  })
  await client.fetchRanking('income')
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /pageId=1/)
  assert.match(calls[0].url, /pageSize=30/)
  assert.equal(calls[0].options.headers.authentication, '')
})

test('周期参数只能选择 day、week、month 之一', async () => {
  const client = createJuchachaClient({ fetchImpl: async () => response({ statusCode: 200, content: [] }) })
  await assert.rejects(
    client.fetchRanking('income', { day: '2026-09-14', week: '2026-09-08' }),
    (error) => error.code === 'JUCHACHA_INVALID_RESPONSE' && error.endpoint === null,
  )
})

test('超时错误不暴露请求头', async () => {
  const client = createJuchachaClient({
    fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError') },
  })
  await assert.rejects(client.fetchRanking('income'), (error) => {
    assert.equal(error.code, 'JUCHACHA_TIMEOUT')
    assert.equal(error.endpoint, '/playlet/getPlayletRevenueRankData')
    assert.equal(error.headers, undefined)
    assert.doesNotMatch(JSON.stringify(error), /authentication|0cdf|Bearer/i)
    return true
  })
})

test('response.json 阶段被中止时仍返回超时错误', async (t) => {
  for (const name of ['AbortError', 'TimeoutError']) {
    await t.test(name, async () => {
      const client = createJuchachaClient({
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => { throw new DOMException('request aborted', name) },
        }),
      })
      await assert.rejects(client.fetchRanking('income'), (error) => {
        assert.equal(error.code, 'JUCHACHA_TIMEOUT')
        assert.equal(error.endpoint, '/playlet/getPlayletRevenueRankData')
        return true
      })
    })
  }
})

test('HTTP 错误、业务错误和脏 JSON 使用不同错误码', async (t) => {
  await t.test('HTTP 错误', async () => {
    const client = createJuchachaClient({ fetchImpl: async () => new Response('bad gateway', { status: 502 }) })
    await assert.rejects(client.fetchRanking('income'), (error) => error.code === 'JUCHACHA_HTTP_ERROR')
  })
  await t.test('业务错误', async () => {
    const client = createJuchachaClient({ fetchImpl: async () => response({ statusCode: 400, message: '参数错误' }) })
    await assert.rejects(client.fetchRanking('income'), (error) => error.code === 'JUCHACHA_API_ERROR' && error.message === '参数错误')
  })
  await t.test('脏 JSON', async () => {
    const client = createJuchachaClient({ fetchImpl: async () => new Response('{not-json', { status: 200 }) })
    await assert.rejects(client.fetchRanking('income'), (error) => error.code === 'JUCHACHA_INVALID_RESPONSE')
  })
})

test('未知榜单类型只接受 rankingDefinitions 自有属性', async () => {
  let calls = 0
  const client = createJuchachaClient({
    fetchImpl: async () => {
      calls += 1
      return response({ statusCode: 200, content: [] })
    },
  })
  for (const type of ['not-a-ranking', 'constructor', 'toString', '__proto__']) {
    await assert.rejects(client.fetchRanking(type), (error) => {
      assert.equal(error.code, 'JUCHACHA_INVALID_RESPONSE')
      assert.equal(error.endpoint, null)
      return true
    })
  }
  assert.equal(calls, 0)
})

test('fetchAllRankings 保留成功榜单并记录失败榜单', async () => {
  const calls = []
  const client = createJuchachaClient({
    fetchImpl: async (url) => {
      calls.push(String(url))
      if (String(url).includes('/playlet/listHotRanking')) throw new Error('network down')
      return response({ statusCode: 200, content: [{ ranking: 1 }], page: { pageId: 1, pageSize: 30 } })
    },
  })
  const result = await client.fetchAllRankings({ day: '2026-09-14' })
  assert.equal(calls.length, 8)
  assert.deepEqual(result.rankings.income.content, [{ ranking: 1 }])
  assert.equal(result.failures.length, 1)
  assert.deepEqual(result.failures[0], {
    type: 'hot',
    code: 'JUCHACHA_HTTP_ERROR',
    endpoint: '/playlet/listHotRanking',
    message: '剧查查请求失败',
  })
})
