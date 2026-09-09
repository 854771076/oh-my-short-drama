#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { relative, resolve } from 'node:path'

const TYPES = {
  'asset-generation': new Set(['character', 'scene', 'prop']),
  'media-production': new Set(['storyboard', 'video', 'audio']),
}

const [rootArg, stage] = process.argv.slice(2)
if (!rootArg || !TYPES[stage]) throw new Error('用法：snapshot-stage-evidence.mjs <项目目录> <asset-generation|media-production>')
const root = resolve(rootArg)
const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
const reviews = stage === 'media-production'
  ? JSON.parse(await readFile(resolve(root, '.short-drama/shot-reviews.json'), 'utf8'))
  : null
const assets = {}
for (const [key, asset] of Object.entries(ledger.assets || {})) {
  if (!TYPES[stage].has(asset.type) || !asset.selectedVersionId) continue
  const version = asset.versions?.find((item) => item.id === asset.selectedVersionId)
  if (!version || asset.staleVersionIds?.includes(version.id)) throw new Error(`不能快照失效或缺失的选版：${key}@${asset.selectedVersionId}`)
  assets[key] = { type: asset.type, selectedVersionId: asset.selectedVersionId, version, ...(reviews?.reviews?.[`${key}@${asset.selectedVersionId}`] ? { review: reviews.reviews[`${key}@${asset.selectedVersionId}`] } : {}) }
}
const evidence = { version: 1, stage, assets, createdAt: new Date().toISOString() }
const directory = resolve(root, '.short-drama/evidence')
const target = resolve(directory, `${stage}-${randomUUID()}.json`)
await mkdir(directory, { recursive: true })
await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
console.log(relative(root, target))
