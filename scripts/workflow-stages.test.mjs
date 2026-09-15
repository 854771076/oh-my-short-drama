import test from 'node:test'
import assert from 'node:assert/strict'
import { mediaPipelineStages, stageFallback } from './workflow-stages.mjs'

test('新能力在主编排流程中有唯一顺序和回退边', () => {
  assert.deepEqual(mediaPipelineStages(), ['character-appeal', 'continuity-plan', 'previous-tail', 'native-audio', 'native-audio-review', 'audio-fallback', 'lip-sync', 'licensed-music', 'media-editing', 'video-upscale', 'delivery'])
  assert.deepEqual(stageFallback('native-audio-review'), ['audio-fallback'])
  assert.deepEqual(stageFallback('previous-tail'), [])
})

