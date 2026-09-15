import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { getMusicLicense, putMusicLicense, validateMusicUse } from './music-license-ledger.mjs'

const receipt = { receipt_key: 'music-license-pixabay-track-1', catalog: 'pixabay', track_id: 'track-1', title: 'Tension', creator: 'Example', source_url: 'https://pixabay.com/music/example/', license_name: 'Pixabay Content License', license_url: 'https://pixabay.com/service/license-summary/', downloaded_at: '2026-09-16T08:00:00.000Z', attribution_required: false, attribution_text: '', content_id_risk: true, allowed_uses: ['online-video', 'commercial', 'client-project'], proof_path: 'licenses/pixabay-track-1.txt' }

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-music-license-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await mkdir(resolve(root, 'licenses'), { recursive: true })
  await writeFile(resolve(root, 'licenses/pixabay-track-1.txt'), 'download receipt')
  return root
}

test('Pixabay 收据必须保存来源和 Content ID 风险', async () => {
  const root = await fixture()
  try { await assert.rejects(putMusicLicense(root, { ...receipt, source_url: '', content_id_risk: null }), /source_url|content_id_risk/) }
  finally { await rm(root, { recursive: true, force: true }) }
})

test('Uppbeat Basic 不得用于未覆盖的付费广告', () => {
  assert.throws(() => validateMusicUse({ ...receipt, catalog: 'uppbeat', source_url: 'https://uppbeat.io/track/example', allowed_uses: ['online-video'] }, { commercial: true, paid_ad: true, client_project: false, broadcast: false }), /paid_ad/)
})

test('收据不可覆盖且可按 key 读取', async () => {
  const root = await fixture()
  try {
    await putMusicLicense(root, receipt)
    assert.equal((await getMusicLicense(root, receipt.receipt_key)).track_id, 'track-1')
    await assert.rejects(putMusicLicense(root, receipt), /已存在/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
