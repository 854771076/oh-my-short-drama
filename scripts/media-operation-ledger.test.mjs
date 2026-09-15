import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createRequestSnapshot, generationProvenance, validateTaskOutput } from './task-ledger.mjs'

test('媒体操作快照保留来源且完成资产必须一致', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'short-drama-operation-ledger-'))
  try {
    await mkdir(resolve(root, '.short-drama'), { recursive: true })
    await writeFile(resolve(root, '.short-drama/project.json'), '{}')
    const input = {
      tool: 'submit_media_operation', target: 'shot-ep001-001', type: 'video', provider: 'runninghub', modelOrWorkflow: 'workflow-upscale', promptDocument: null,
      arguments: { operation: 'video-upscale', source: { asset_key: 'shot-ep001-001', version_id: 'v001' }, mask: { asset_key: 'other-mask-ep001-001', version_id: 'v001' }, parameters: { scale: 2 }, source_sha256: 'a'.repeat(64) },
    }
    const snapshot = await createRequestSnapshot(root, input)
    assert.match(snapshot.requestId, /^req-/)
    const request = JSON.parse(await readFile(resolve(root, snapshot.requestPath), 'utf8'))
    assert.equal(request.arguments.operation, 'video-upscale')
    assert.equal(request.arguments.source.version_id, 'v001')

    const task = { taskId: 'task-operation', target: input.target, type: 'video', provider: 'runninghub' }
    const asset = { key: input.target, type: 'video' }
    const version = { id: 'v002', provenance: generationProvenance(task, request) }
    assert.equal(version.provenance.origin, 'transformed')
    assert.deepEqual(version.provenance.source_assets, [{ key: 'shot-ep001-001', version_id: 'v001' }, { key: 'other-mask-ep001-001', version_id: 'v001' }])
    assert.doesNotThrow(() => validateTaskOutput(task, request, asset, version))
    assert.throws(() => validateTaskOutput(task, request, asset, { ...version, provenance: { ...version.provenance, source_assets: [{ key: 'shot-ep001-999', version_id: 'v001' }] } }), /媒体操作来源/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
