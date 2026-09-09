import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createStudioServer, DEFAULT_WORKSPACE_ROOT, initializeWorkspace } from './studio.mjs'
import { renderDocument } from '../studio/document-view.js'

const execute = promisify(execFile)
const pluginRoot = resolve(import.meta.dirname, '..')
const run = (script, args) => execute(process.execPath, [resolve(pluginRoot, 'scripts', script), ...args])

assert.equal(DEFAULT_WORKSPACE_ROOT, resolve(homedir(), 'darma_project'))

test('结构化文档递归展示字段并转义内容', () => {
  const html = renderDocument({ episode_key: 'ep-001', characters: [{ name: '<林乔>' }] })
  assert.match(html, /分集/)
  assert.match(html, /人物/)
  assert.match(html, /&lt;林乔&gt;/)
  assert.match(renderDocument({ selected_version: null }), /未设置/)
})

test('Dashboard 通过本地 HTTP API 初始化工作区并创建项目', async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'short-drama-studio-'))
  await t.test('工作区与项目写入既有项目合同', async () => {
    const originalStarrouterKey = process.env.STARROUTER_API_KEY
    const originalCredentialFile = process.env.SHORT_DRAMA_CREDENTIALS_FILE
    process.env.STARROUTER_API_KEY = 'studio-test-key'
    process.env.SHORT_DRAMA_CREDENTIALS_FILE = resolve(workspace, 'credentials.json')
    t.after(() => originalStarrouterKey === undefined ? delete process.env.STARROUTER_API_KEY : process.env.STARROUTER_API_KEY = originalStarrouterKey)
    t.after(() => originalCredentialFile === undefined ? delete process.env.SHORT_DRAMA_CREDENTIALS_FILE : process.env.SHORT_DRAMA_CREDENTIALS_FILE = originalCredentialFile)
    await initializeWorkspace(workspace, '我的短剧')
    const testedProviders = []
    const server = createStudioServer({ workspaceRoot: workspace, providerTester: async (key) => { testedProviders.push(key); if (key === 'runninghub') throw new Error('RUNNINGHUB_REQUEST_FAILED(401)') } })
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    t.after(() => new Promise((done) => server.close(done)))

    const base = `http://127.0.0.1:${server.address().port}`
    const home = await fetch(base)
    assert.equal(home.status, 200)
    assert.match(await home.text(), /短剧工厂/)
    assert.equal((await fetch(`${base}/favicon.ico`)).status, 404)
    assert.equal((await fetch(`${base}/api/v1/workspace`)).status, 200)
    const bootstrap = await fetch(`${base}/api/v1/workspace`).then((response) => response.json())
    assert.equal(bootstrap.workspace.title, '我的短剧')
    assert.deepEqual(bootstrap.projects, [])

    const providerText = await fetch(`${base}/api/v1/providers`).then((response) => response.text())
    const providerCatalog = JSON.parse(providerText).providers
    const starrouter = providerCatalog.find((item) => item.key === 'starrouter')
    assert.equal(starrouter.configured, true)
    assert.ok(starrouter.models.image.some((item) => item.id === 'gpt-image-2'))
    assert.doesNotMatch(providerText, /studio-test-key/)

    const credentialResponse = await fetch(`${base}/api/v1/providers/runninghub/credential`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-short-drama-csrf': bootstrap.csrfToken }, body: JSON.stringify({ credential: 'runninghub-test-key' }),
    })
    const credentialResult = await credentialResponse.text()
    assert.equal(credentialResponse.status, 200, credentialResult)
    assert.doesNotMatch(credentialResult, /runninghub-test-key/)
    assert.equal((await stat(process.env.SHORT_DRAMA_CREDENTIALS_FILE)).mode & 0o777, 0o600)
    assert.equal(JSON.parse(await readFile(process.env.SHORT_DRAMA_CREDENTIALS_FILE, 'utf8')).RUNNINGHUB_API_KEY, 'runninghub-test-key')
    assert.equal((await fetch(`${base}/api/v1/providers`).then((response) => response.json())).providers.find((item) => item.key === 'runninghub').configured, true)

    const connection = await fetch(`${base}/api/v1/providers/starrouter/test`, { method: 'POST', headers: { 'x-short-drama-csrf': bootstrap.csrfToken } })
    assert.deepEqual(await connection.json(), { provider: 'starrouter', ok: true, message: '连接成功' })
    const rejectedConnection = await fetch(`${base}/api/v1/providers/runninghub/test`, { method: 'POST', headers: { 'x-short-drama-csrf': bootstrap.csrfToken } })
    assert.equal(rejectedConnection.status, 502)
    assert.deepEqual(await rejectedConnection.json(), { error: '凭据无效或无权访问' })
    assert.deepEqual(testedProviders, ['starrouter', 'runninghub'])

    const denied = await fetch(`${base}/api/v1/projects`, { method: 'POST' })
    assert.equal(denied.status, 403)

    const created = await fetch(`${base}/api/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-short-drama-csrf': bootstrap.csrfToken },
      body: JSON.stringify({ key: 'demo-drama', title: '示例短剧', genre: '悬疑', episodeCount: 8, episodeDurationSeconds: 90 }),
    })
    assert.equal(created.status, 201, await created.text())

    const project = JSON.parse(await readFile(resolve(workspace, 'demo-drama/.short-drama/project.json'), 'utf8'))
    assert.equal(project.key, 'demo-drama')
    assert.equal(project.creative.genre, '悬疑')
    assert.equal(project.format.episode_count, 8)
    assert.equal(project.storyboard.type, 'single')

    const projectRoot = resolve(workspace, 'renamed-folder')
    await rename(resolve(workspace, 'demo-drama'), projectRoot)
    const detailResponse = await fetch(`${base}/api/v1/projects/demo-drama`)
    const detail = await detailResponse.json()
    assert.equal(detailResponse.status, 200, detail.error)
    assert.equal(detail.project.title, '示例短剧')
    assert.equal(detail.path, await realpath(projectRoot))
    assert.deepEqual(detail.assets, [])

    const providerHeaders = { 'content-type': 'application/json', 'x-short-drama-csrf': bootstrap.csrfToken }
    const providerSelection = await fetch(`${base}/api/v1/projects/demo-drama/providers`, {
      method: 'POST', headers: providerHeaders, body: JSON.stringify({ providers: { image: { provider: 'starrouter', model_or_workflow: 'gpt-image-2' } } }),
    })
    const configuredProject = await providerSelection.json()
    assert.equal(providerSelection.status, 200, configuredProject.error)
    assert.equal(configuredProject.project.providers.image.provider, 'starrouter')
    assert.equal(configuredProject.project.providers.video.provider, null)

    const invalidProvider = await fetch(`${base}/api/v1/projects/demo-drama/providers`, {
      method: 'POST', headers: providerHeaders, body: JSON.stringify({ providers: { video: { provider: 'unknown', model_or_workflow: 'missing' } } }),
    })
    assert.equal(invalidProvider.status, 400)

    const assetRecord = resolve(workspace, 'asset.json')
    const image = resolve(workspace, 'image.png')
    await writeFile(assetRecord, JSON.stringify({ key: 'char-demo', type: 'character', name: '示例人物' }))
    await writeFile(image, Buffer.from([1, 2, 3, 4]))
    await run('asset-ledger.mjs', ['put', projectRoot, assetRecord])
    await run('asset-ledger.mjs', ['import', projectRoot, 'char-demo', image, 'v001'])
    await run('asset-ledger.mjs', ['select', projectRoot, 'char-demo', 'v001'])
    await run('asset-ledger.mjs', ['import', projectRoot, 'char-demo', image, 'v002'])

    const selectionHeaders = { 'content-type': 'application/json', 'x-short-drama-csrf': bootstrap.csrfToken }
    const selected = await fetch(`${base}/api/v1/projects/demo-drama/assets/char-demo/select`, { method: 'POST', headers: selectionHeaders, body: JSON.stringify({ versionId: 'v002', confirmed: true }) })
    const selectedBody = await selected.json()
    assert.equal(selected.status, 200, selectedBody.error)
    assert.equal(selectedBody.assets[0].selectedVersionId, 'v002')

    const preview = await fetch(`${base}/api/v1/projects/demo-drama/assets/char-demo/versions/v002/content`, { headers: { range: 'bytes=1-2' } })
    assert.equal(preview.status, 206)
    assert.deepEqual([...new Uint8Array(await preview.arrayBuffer())], [2, 3])

    const reverted = await fetch(`${base}/api/v1/projects/demo-drama/assets/char-demo/revert`, { method: 'POST', headers: selectionHeaders, body: JSON.stringify({ confirmed: true }) })
    const revertedBody = await reverted.json()
    assert.equal(reverted.status, 200, revertedBody.error)
    assert.equal(revertedBody.assets[0].selectedVersionId, 'v001')

    const episodeRecord = resolve(workspace, 'episode.json')
    const script = resolve(workspace, 'v001.md')
    await writeFile(episodeRecord, JSON.stringify({ key: 'ep-001', title: '第一集' }))
    await writeFile(script, '# 第一集\n\n真实剧本内容。\n')
    await run('project-store.mjs', ['put-episode', projectRoot, episodeRecord])
    await run('project-store.mjs', ['put-script', projectRoot, 'ep-001', 'v001', script])
    await run('project-store.mjs', ['select-script', projectRoot, 'ep-001', 'v001', '.md'])

    const documents = await fetch(`${base}/api/v1/projects/demo-drama`).then((response) => response.json())
    assert.deepEqual(documents.documents.map((item) => item.id), ['episodes/ep-001/scripts/v001.md'])
    const document = await fetch(`${base}${documents.documents[0].contentUrl}`)
    assert.equal(document.status, 200)
    assert.match(await document.text(), /真实剧本内容/)

    await mkdir(resolve(projectRoot, 'delivery/ep-001'), { recursive: true })
    await writeFile(resolve(projectRoot, 'delivery/ep-001/final.mp4'), Buffer.from([5, 6, 7, 8]))
    await writeFile(resolve(projectRoot, 'delivery/ep-001/manifest.json'), JSON.stringify({ version: 2, project: 'demo-drama', episode_key: 'ep-001', files: { video: { path: 'delivery/ep-001/final.mp4', sizeBytes: 4, sha256: '0'.repeat(64) } } }))
    const deliveryDetail = await fetch(`${base}/api/v1/projects/demo-drama`).then((response) => response.json())
    assert.equal(deliveryDetail.deliveries[0].files.video.sizeBytes, 4)
    const delivery = await fetch(`${base}${deliveryDetail.deliveries[0].files.video.contentUrl}`, { headers: { range: 'bytes=2-3' } })
    assert.equal(delivery.status, 206)
    assert.deepEqual([...new Uint8Array(await delivery.arrayBuffer())], [7, 8])

    const validation = await fetch(`${base}/api/v1/projects/demo-drama/validation`).then((response) => response.json())
    assert.equal(typeof validation.valid, 'boolean')
    assert.ok(Array.isArray(validation.issues))

    const imported = await fetch(`${base}/api/v1/projects/demo-drama/assets/import?assetKey=scene-demo&type=scene&name=${encodeURIComponent('示例场景')}&versionId=v001&filename=scene.png`, {
      method: 'POST', headers: { 'x-short-drama-csrf': bootstrap.csrfToken, 'x-short-drama-confirmed': 'true' }, body: Buffer.from([9, 10, 11]),
    })
    const importedBody = await imported.json()
    assert.equal(imported.status, 201, importedBody.error)
    assert.equal(importedBody.assets.find((item) => item.key === 'scene-demo').versions[0].sizeBytes, 3)
  })
  await rm(workspace, { recursive: true, force: true })
})
