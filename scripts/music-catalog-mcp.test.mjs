import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { getMusicLicense } from './music-license-ledger.mjs'

const { call, tools } = await import('./generation/mcp.mjs')

function audio(path) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le', '-y', path], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(result.stderr || '音频夹具生成失败')
}

const receipt = (proof) => ({ receipt_key: 'music-license-pixabay-mcp-1', catalog: 'pixabay', track_id: 'mcp-1', title: 'Cinematic Tension', creator: 'Example', source_url: 'https://pixabay.com/music/example/', license_name: 'Pixabay Content License', license_url: 'https://pixabay.com/service/license-summary/', downloaded_at: '2026-09-16T08:00:00.000Z', attribution_required: false, attribution_text: '', content_id_risk: true, allowed_uses: ['online-video', 'commercial', 'client-project'], proof_path: proof })

test('音乐目录 MCP 已注册且搜索是只读操作', async () => {
  for (const name of ['list_music_catalogs', 'search_music_catalog', 'register_licensed_music']) assert.ok(tools.some((item) => item.name === name))
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-music-search-'))
  try {
    const result = await call('search_music_catalog', { catalog: 'pixabay', purpose: 'bgm', dramatic_function: '追逐升级', pace: 'fast', dialogue_density: 'low', duration_seconds: 20 })
    assert.equal(result.mode, 'browser')
    assert.equal(existsSync(resolve(root, '.short-drama/assets.json')), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('导入必须同时登记收据和未选中的音频资产', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-music-import-'))
  try {
    await mkdir(resolve(root, '.short-drama'), { recursive: true })
    await writeFile(resolve(root, '.short-drama/project.json'), '{}\n')
    await mkdir(resolve(root, 'licenses'), { recursive: true })
    await writeFile(resolve(root, 'licenses/proof.txt'), 'license proof')
    const source = resolve(root, 'music.wav'); audio(source)
    const input = { project_root: root, target: 'audio-ep001-bgm-001', name: 'Cinematic Tension', local_file: source, receipt: receipt('licenses/proof.txt'), usage_scope: 'commercial-authorized', rights_confirmed: true, confirmed: true }
    const result = await call('register_licensed_music', input)
    assert.match(result.version_id, /^v\d{3}$/)
    assert.equal(result.selected, false)
    assert.equal((await getMusicLicense(root, input.receipt.receipt_key)).track_id, input.receipt.track_id)
    const ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8'))
    assert.equal(ledger.assets[input.target].selectedVersionId ?? null, null)
    assert.equal(ledger.assets[input.target].versions[0].provenance.parameters.music_license_receipt, input.receipt.receipt_key)
  } finally { await rm(root, { recursive: true, force: true }) }
})
