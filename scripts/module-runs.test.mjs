import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { isModuleRunValid, migrateSkillRuns, readModuleRuns, recordModuleRun } from './module-runs.mjs'

const digest = (value) => createHash('sha256').update(value).digest('hex')

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'module-runs-'))
  await mkdir(resolve(root, '.short-drama'), { recursive: true })
  const project = '{"workflow":{"type":"standard","version":1}}\n'
  const evidence = '{"ok":true}\n'
  await writeFile(resolve(root, '.short-drama/project.json'), project)
  await writeFile(resolve(root, '.short-drama/evidence.json'), evidence)
  return { root, project, evidence }
}

test('module-run 绑定 reference、输入和输出哈希', async () => {
  const { root } = await fixture()
  const run = await recordModuleRun(root, 'analysis', 'manage-drama-projects', ['.short-drama/evidence.json'], { inputs: ['.short-drama/project.json'] })
  assert.match(run.referenceSha256, /^[0-9a-f]{64}$/)
  assert.equal(run.inputSha256['.short-drama/project.json'], digest('{"workflow":{"type":"standard","version":1}}\n'))
  assert.equal(run.evidenceSha256['.short-drama/evidence.json'], digest('{"ok":true}\n'))
  assert.equal(await isModuleRunValid(root, run), true)

  const changedReference = { ...run, referenceSha256: '0'.repeat(64) }
  assert.equal(await isModuleRunValid(root, changedReference), false)
})

test('旧 skill-run 只读迁移且重复执行幂等', async () => {
  const { root, evidence } = await fixture()
  const legacy = {
    version: 1,
    runs: {
      'analysis:manage-drama-projects': {
        stage: 'analysis',
        skill: 'manage-drama-projects',
        status: 'completed',
        evidence: ['.short-drama/evidence.json'],
        evidenceSha256: { '.short-drama/evidence.json': digest(evidence) },
        promptRuns: [],
        completedAt: '2026-09-24T00:00:00.000Z',
      },
    },
  }
  const legacyText = `${JSON.stringify(legacy, null, 2)}\n`
  await writeFile(resolve(root, '.short-drama/skill-runs.json'), legacyText)

  const first = await migrateSkillRuns(root)
  const firstText = await readFile(resolve(root, '.short-drama/module-runs.json'), 'utf8')
  const second = await migrateSkillRuns(root)
  const secondText = await readFile(resolve(root, '.short-drama/module-runs.json'), 'utf8')

  assert.deepEqual(second, first)
  assert.equal(secondText, firstText)
  assert.equal(second.runs['analysis:manage-drama-projects'].migratedFromSkillRun, 'analysis:manage-drama-projects')
  assert.equal(second.runs['analysis:manage-drama-projects'].legacyRunSha256, digest(JSON.stringify(legacy.runs['analysis:manage-drama-projects'])))
  assert.equal(await readFile(resolve(root, '.short-drama/skill-runs.json'), 'utf8'), legacyText)
})

test('篡改或缺失的旧凭证不能迁移', async () => {
  const { root } = await fixture()
  await writeFile(resolve(root, '.short-drama/skill-runs.json'), `${JSON.stringify({
    version: 1,
    runs: {
      'analysis:manage-drama-projects': {
        stage: 'analysis',
        skill: 'manage-drama-projects',
        status: 'completed',
        evidence: ['.short-drama/evidence.json'],
        evidenceSha256: { '.short-drama/evidence.json': 'f'.repeat(64) },
        promptRuns: [],
        completedAt: '2026-09-24T00:00:00.000Z',
      },
    },
  }, null, 2)}\n`)

  const migrated = await migrateSkillRuns(root)
  assert.deepEqual(migrated.runs, {})
  assert.deepEqual((await readModuleRuns(root)).runs, {})
})
