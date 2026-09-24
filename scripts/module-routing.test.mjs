import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { requiredModules } from './module-runs.mjs'

async function projectFixture(workflowType = 'standard') {
  const root = await mkdtemp(resolve(tmpdir(), 'module-routing-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  await mkdir(resolve(root, 'episodes/ep-001'), { recursive: true })
  await writeFile(resolve(root, '.short-drama/project.json'), `${JSON.stringify({ workflow: { type: workflowType, version: 1 } })}\n`)
  return root
}

async function putSelected(root, kind, value) {
  const directory = resolve(root, 'episodes/ep-001', kind)
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'v001.json'), `${JSON.stringify(value)}\n`)
  await writeFile(resolve(directory, 'selected.json'), `${JSON.stringify({ versionId: 'v001', path: `episodes/ep-001/${kind}/v001.json` })}\n`)
}

test('普通 production-plan 不加载打斗模块', async () => {
  const root = await projectFixture()
  const modules = await requiredModules(root, 'production-plan')
  assert.equal(modules.includes('design-fight-video'), false)
  assert.deepEqual(modules, ['build-drama-storyboard', 'plan-drama-production', 'plan-shot-continuity', 'write-drama-video-prompts'])
})

test('导演本显式结构化复杂动作时加载打斗模块', async () => {
  const root = await projectFixture()
  await putSelected(root, 'director-book', {
    scenes: [{ scene_key: 'scene-001', action_complexity: 'choreographed' }],
  })
  const modules = await requiredModules(root, 'production-plan')
  assert.equal(modules[0], 'design-fight-video')
  assert.equal(modules.filter((id) => id === 'design-fight-video').length, 1)
})

test('中英文导演本合同都要求结构化动作复杂度', async () => {
  for (const locale of ['zh', 'en']) {
    const prompt = await readFile(resolve(import.meta.dirname, `../skills/write-drama-director-book/assets/prompts/director_book.${locale}.txt`), 'utf8')
    assert.match(prompt, /action_complexity/)
    assert.match(prompt, /ordinary/)
    assert.match(prompt, /choreographed/)
  }
})

test('媒体阶段按逐镜分镜策略选择图片或 Blender 模块', async () => {
  const root = await projectFixture()
  await putSelected(root, 'production-plan', {
    shots: [
      { shot_number: 1, storyboard_strategy: { mode: 'image' }, previz_strategy: { mode: 'none' }, provider: 'runninghub', model_or_workflow: 'minimax-h3-reference-to-video', audio_strategy: { mode: 'native' } },
      { shot_number: 2, storyboard_strategy: { mode: 'blender' }, previz_strategy: { mode: 'blender', purpose: 'review', fps: 12 }, provider: 'runninghub', model_or_workflow: 'minimax-h3-reference-to-video', audio_strategy: { mode: 'native' } },
    ],
  })
  const modules = await requiredModules(root, 'media-production')
  assert.ok(modules.includes('generate-storyboard-images'))
  assert.ok(modules.includes('direct-blender-previz'))
  assert.ok(modules.includes('generate-blender-previz'))
  assert.equal(modules.includes('design-drama-audio'), false)
})

test('viral-recreation analysis 保持 Dashboard、Provider、Hypit 与复刻模块顺序', async () => {
  const root = await projectFixture('viral-recreation')
  const modules = await requiredModules(root, 'analysis')
  assert.deepEqual(modules.slice(0, 6), [
    'manage-drama-projects',
    'use-short-drama-studio',
    'configure-generation-providers',
    'analyze-reference-video',
    'use-hypit-video',
    'design-video-recreation',
  ])
  assert.equal(modules.includes('analyze-drama-source'), false)
})
