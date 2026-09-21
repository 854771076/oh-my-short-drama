import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { verifyProjectProviders } from './provider-setup.mjs'
import { validateProviderSetup } from './skill-runs.mjs'

function catalog() {
  return [
    { key: 'vision', configured: true, models: { image: [{ id: 'image-v1' }], video: [{ id: 'video-v1' }], audio: [] } },
    { key: 'voice', configured: true, models: { image: [], video: [], audio: [{ id: 'audio-v1' }] } },
  ]
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-provider-setup-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/project.json'), `${JSON.stringify({
    key: 'viral-demo', workflow: { type: 'viral-recreation' },
    providers: {
      image: { provider: 'vision', model_or_workflow: 'image-v1' },
      video: { provider: 'vision', model_or_workflow: 'video-v1' },
      audio: { provider: 'voice', model_or_workflow: 'audio-v1' },
    },
  })}\n`)
  return root
}

test('Provider 配置探测按 Provider 去重并留下项目绑定凭证', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = []
  const result = await verifyProjectProviders(root, { catalog: catalog(), testConnection: async (provider) => calls.push(provider) })
  assert.deepEqual(calls, ['vision', 'voice'])
  assert.equal(result.path, '.short-drama/provider-setup.json')
  const receipt = JSON.parse(await readFile(resolve(root, result.path), 'utf8'))
  assert.equal(receipt.project_key, 'viral-demo')
  assert.deepEqual(receipt.selections.video, { provider: 'vision', model_or_workflow: 'video-v1' })
  assert.deepEqual(receipt.providers, [{ provider: 'vision', ok: true }, { provider: 'voice', ok: true }])
})

test('Provider 探测失败时不产生成功凭证', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(verifyProjectProviders(root, { catalog: catalog(), testConnection: async () => { throw new Error('连接失败') } }), /连接失败/)
  await assert.rejects(readFile(resolve(root, '.short-drama/provider-setup.json')), { code: 'ENOENT' })
})

test('Skill 门禁拒绝与当前模型选择不一致的旧探测凭证', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await verifyProjectProviders(root, { catalog: catalog(), testConnection: async () => {} })
  await validateProviderSetup(root, ['.short-drama/provider-setup.json'], catalog())
  const projectPath = resolve(root, '.short-drama/project.json')
  const project = JSON.parse(await readFile(projectPath, 'utf8'))
  project.providers.video.model_or_workflow = 'video-v2'
  await writeFile(projectPath, `${JSON.stringify(project)}\n`)
  const expanded = catalog()
  expanded[0].models.video.push({ id: 'video-v2' })
  await assert.rejects(validateProviderSetup(root, ['.short-drama/provider-setup.json'], expanded), /video 配置已过期/)
})
