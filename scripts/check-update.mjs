#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = '854771076/oh-my-short-drama'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cachePath = resolve(process.env.XDG_CACHE_HOME || resolve(homedir(), '.cache'), 'oh-my-short-drama/update-check.json')
const cacheTtlMs = 24 * 60 * 60 * 1000

function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return { core: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') || [], build: match[5]?.split('.') || [] }
}

function compareIdentifiers(left, right) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1
    if (right[index] === undefined) return 1
    const leftNumber = /^\d+$/.test(left[index])
    const rightNumber = /^\d+$/.test(right[index])
    if (leftNumber && rightNumber && Number(left[index]) !== Number(right[index])) return Number(left[index]) > Number(right[index]) ? 1 : -1
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

export function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue), right = parseVersion(rightValue)
  if (!left || !right) throw new Error('版本号必须符合 SemVer')
  for (let index = 0; index < 3; index += 1) if (left.core[index] !== right.core[index]) return left.core[index] > right.core[index] ? 1 : -1
  if (!left.prerelease.length && right.prerelease.length) return 1
  if (left.prerelease.length && !right.prerelease.length) return -1
  const prerelease = compareIdentifiers(left.prerelease, right.prerelease)
  if (prerelease) return prerelease
  // 本项目用构建元数据记录打包时间；标准 SemVer 不比较该字段，这里仅在双方都存在时作为更新判定的末级依据。
  return left.build.length && right.build.length ? compareIdentifiers(left.build, right.build) : 0
}

async function currentVersion() {
  return JSON.parse(await readFile(resolve(root, '.codex-plugin/plugin.json'), 'utf8')).version
}

async function cached(version) {
  try {
    const value = JSON.parse(await readFile(cachePath, 'utf8'))
    return value.currentVersion === version && Date.now() - Date.parse(value.checkedAt) < cacheTtlMs ? value : null
  } catch { return null }
}

async function saveCache(value) {
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function check() {
  const current = await currentVersion()
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'oh-my-short-drama-update-check' },
    signal: AbortSignal.timeout(3000),
  })
  if (response.status === 404) return { status: 'no-release', currentVersion: current, checkedAt: new Date().toISOString() }
  if (!response.ok) throw new Error(`GitHub Release 检查失败：HTTP ${response.status}`)
  const release = await response.json()
  const latest = String(release.tag_name || '').replace(/^v/, '')
  const status = compareVersions(latest, current) > 0 ? 'update-available' : 'up-to-date'
  return { status, currentVersion: current, latestVersion: latest, releaseUrl: release.html_url, checkedAt: new Date().toISOString() }
}

function selfCheck() {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('0.4.0+codex.20260913', '0.4.0+codex.20260912'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0+build.1'), 0)
  console.log('ok')
}

async function main() {
  if (process.argv.includes('--self-check')) return selfCheck()
  const manual = process.argv.includes('--check')
  const current = await currentVersion()
  if (!manual && await cached(current)) return
  const result = await check()
  await saveCache(result)
  if (manual) console.log(JSON.stringify(result, null, 2))
  else if (result.status === 'update-available') console.log(`oh-my-short-drama 有新版本 ${result.latestVersion}（当前 ${result.currentVersion}）：${result.releaseUrl}`)
}

main().catch((error) => {
  if (process.argv.includes('--check')) {
    console.error(error.message)
    process.exitCode = 1
  }
})

