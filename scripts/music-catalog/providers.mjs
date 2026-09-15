import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MUSIC_CATALOGS } from './external-sites.mjs'

export const musicCatalogNames = Object.freeze(Object.keys(MUSIC_CATALOGS))

const dramaticTerms = [
  [/秘密|揭露|悬疑|压迫|真相|suspense|reveal/i, { terms: ['suspense', 'tension'], mood: 'suspense' }],
  [/追逐|搏斗|升级|危机|chase|action/i, { terms: ['action', 'driving'], mood: 'intense' }],
  [/浪漫|心动|爱情|romance|love/i, { terms: ['romantic', 'warm'], mood: 'romantic' }],
  [/悲伤|失去|告别|sad|grief/i, { terms: ['emotional', 'melancholic'], mood: 'sad' }],
  [/胜利|兑现|逆袭|victory|triumph/i, { terms: ['triumphant', 'uplifting'], mood: 'uplifting' }],
  [/喜剧|轻松|滑稽|comedy|funny/i, { terms: ['playful', 'quirky'], mood: 'happy' }],
]

export function compileMusicSearch(input = {}) {
  const functionText = String(input.dramatic_function || '').trim()
  if (!functionText) throw new Error('dramatic_function 必填，不能虚构曲名或艺人')
  const matched = dramaticTerms.find(([pattern]) => pattern.test(functionText))?.[1] || { terms: ['cinematic'], mood: 'cinematic' }
  const terms = [...matched.terms]
  if (input.dialogue_density === 'high') terms.push('minimal')
  else if (input.dialogue_density === 'low' && input.pace === 'fast') terms.push('energetic')
  if (input.purpose === 'bgm') terms.push('instrumental')
  else if (input.purpose === 'op') terms.push('opening theme')
  else if (input.purpose === 'ed') terms.push('ending theme')
  const duration = input.duration_seconds == null ? null : Number(input.duration_seconds)
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) throw new Error('duration_seconds 必须为正数或 null')
  return { query: [...new Set(terms)].join(' '), genre: ['cinematic'], mood: [matched.mood], duration_seconds: duration }
}

export function listMusicCatalogs() {
  return Object.entries(MUSIC_CATALOGS).map(([key, value]) => ({ key, label: value.label, mode: value.mode, requires_login: value.requires_login, attribution_varies: value.attribution_varies, license_review_required: true }))
}

async function listLicensedLocalTracks(projectRoot, input) {
  if (!projectRoot) return []
  const directory = resolve(projectRoot, '.short-drama', 'music-licenses')
  let names
  try { names = await readdir(directory) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const query = String(input.query || '').toLowerCase().split(/\s+/).filter(Boolean)
  const receipts = []
  for (const name of names.filter((value) => value.endsWith('.json')).sort()) {
    const receipt = JSON.parse(await readFile(resolve(directory, name), 'utf8'))
    const haystack = `${receipt.title || ''} ${receipt.creator || ''} ${(receipt.tags || []).join(' ')}`.toLowerCase()
    if (!query.length || query.some((term) => haystack.includes(term))) receipts.push({ receipt_key: receipt.receipt_key, track_id: receipt.track_id, title: receipt.title, creator: receipt.creator, catalog: receipt.catalog, allowed_uses: receipt.allowed_uses })
  }
  return receipts
}

export async function searchMusicCatalog(input = {}) {
  const selected = MUSIC_CATALOGS[input.catalog]
  if (!selected) throw new Error('未知音乐目录 Provider')
  const query = String(input.query || compileMusicSearch(input).query).trim()
  if (!query) throw new Error('音乐搜索 query 不能为空')
  if (selected.mode === 'browser') return { mode: 'browser', search_url: selected.buildUrl(query), license_review_required: true }
  return { mode: 'results', results: await listLicensedLocalTracks(input.project_root, { ...input, query }), license_review_required: true }
}
