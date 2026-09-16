import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createRequestSnapshot, generationProvenance, validateTaskOutput } from './task-ledger.mjs'

test('配音请求快照往返保留编译证据并绑定 provenance', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'dubbing-request-snapshot-'))
  try {
    await mkdir(resolve(root, '.short-drama'), { recursive: true })
    await writeFile(resolve(root, '.short-drama/project.json'), '{}\n')
    const compiler = {
      episode_key: 'ep-001', line_index: 1, contract_version: 'v003', timing_version: 'v002',
      target_range: { start_ms: 120, end_ms: 980 }, target_speech_ms: 760,
      text_version: 'adapted', attempt: 2, capability_gaps: [],
    }
    const saved = await createRequestSnapshot(root, {
      tool: 'generate_audio', target: 'audio-ep001-line-001', type: 'audio', provider: 'bailian', modelOrWorkflow: 'cosyvoice-v3.5-plus',
      promptDocument: { kind: 'audio-plan', episode_key: 'ep-001', version_id: 'v003', line_index: 1 },
      arguments: { model: 'cosyvoice-v3.5-plus', voice: 'linwan', input: '别回头', speed: 1.02 },
      dubbing_compiler: compiler,
    })
    const request = JSON.parse(await readFile(resolve(root, saved.requestPath), 'utf8'))
    assert.deepEqual(request.dubbing_compiler.snapshot, compiler)
    assert.match(request.dubbing_compiler.sha256, /^[0-9a-f]{64}$/)

    const task = { taskId: 'task-dub', target: 'audio-ep001-line-001', type: 'audio', provider: 'bailian' }
    const asset = { key: task.target, type: 'audio' }
    const version = { id: 'v001', provenance: generationProvenance(task, request) }
    assert.deepEqual(version.provenance.parameters.dubbing_compiler, request.dubbing_compiler)
    assert.doesNotThrow(() => validateTaskOutput(task, request, asset, version))
    assert.throws(() => validateTaskOutput(task, request, asset, { ...version, provenance: { ...version.provenance, parameters: { ...version.provenance.parameters, dubbing_compiler: { ...request.dubbing_compiler, sha256: '0'.repeat(64) } } } }), /参数与请求不一致|provenance/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
