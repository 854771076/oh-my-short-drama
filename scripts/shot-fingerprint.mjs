import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonical } from './task-ledger.mjs'

export function comparableShot(kind, item) {
  if (!item) return null
  if (kind !== 'video-prompts') return canonical(item)
  const { production_plan_version, storyboard_version, ...content } = item
  return canonical(content)
}

export function shotItems(kind, document) { return kind === 'storyboard' ? document.panels : document.shots }

export function changedShotNumbers(kind, previous, next) {
  const map = (document) => new Map((shotItems(kind, document) || []).map((item) => [item.shot_number, JSON.stringify(comparableShot(kind, item))]))
  const before = map(previous)
  const after = map(next)
  return [...new Set([...before.keys(), ...after.keys()])].filter((number) => before.get(number) !== after.get(number)).sort((a, b) => a - b)
}

export async function sameShotVersion(root, episodeKey, kind, referencedVersion, selectedVersion, shotNumber) {
  if (referencedVersion === selectedVersion) return true
  const directory = resolve(root, 'episodes', episodeKey, kind)
  const [referenced, selected] = await Promise.all([
    readFile(resolve(directory, `${referencedVersion}.json`), 'utf8').then(JSON.parse),
    readFile(resolve(directory, `${selectedVersion}.json`), 'utf8').then(JSON.parse),
  ])
  const find = (document) => (shotItems(kind, document) || []).find((item) => item.shot_number === shotNumber)
  return JSON.stringify(comparableShot(kind, find(referenced))) === JSON.stringify(comparableShot(kind, find(selected)))
}

if (process.argv[2] === '--self-check') {
  const before = { shots: [{ shot_number: 1, prompt: '不变', storyboard_version: 'v001', production_plan_version: 'v001' }, { shot_number: 2, prompt: '旧' }] }
  const after = { shots: [{ shot_number: 1, prompt: '不变', storyboard_version: 'v002', production_plan_version: 'v002' }, { shot_number: 2, prompt: '新' }] }
  if (JSON.stringify(changedShotNumbers('video-prompts', before, after)) !== '[2]') throw new Error('镜头指纹自检失败')
  console.log('ok')
}
