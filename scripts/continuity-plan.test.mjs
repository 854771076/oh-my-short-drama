import test from 'node:test'
import assert from 'node:assert/strict'
import { compareAdjacentStates, recommendTailLink, validateContinuityPlan } from './continuity-plan.mjs'

const actor = (zone, heldProps = []) => ({
  actor_key: 'char-a',
  zone,
  depth: 'mid',
  facing: 'right',
  eyeline_target: 'char-b',
  screen_direction: 'right',
  entry_edge: null,
  exit_edge: null,
  posture: 'standing',
  held_props: heldProps,
})

function shot(number, start, end, options = {}) {
  const cameraSetupId = options.cameraSetupId || 'cam-a'
  const cameraSide = options.cameraSide || 'north'
  return {
    shot_number: number,
    scene_key: options.sceneKey || 'scene-001',
    camera_setup_id: cameraSetupId,
    start_state: { actors: [start], props: [], axis_id: 'axis-a', camera_side: cameraSide, lighting_anchor: 'window-left' },
    end_state: { actors: [end], props: [], axis_id: 'axis-a', camera_side: cameraSide, lighting_anchor: 'window-left' },
    transition_link: number === 1
      ? { mode: 'independent', source_shot_number: null, source_camera_setup_id: null, enabled: false, reason: '首镜建立空间', required_provider_capability: null }
      : { mode: 'previous-tail', source_shot_number: number - 1, source_camera_setup_id: cameraSetupId, enabled: true, reason: '承接动作', required_provider_capability: 'video.first-frame' },
    inherited_fields: ['actors', 'axis_id', 'camera_side', 'lighting_anchor'],
    allowed_changes: options.allowedChanges || [],
    evidence: ['director-book:scene-001'],
  }
}

function documentWith(shots, overrides = {}) {
  return {
    episode_key: 'ep-001',
    source_versions: { storyboard: 'v001', 'director-book': 'v001', 'production-plan': 'v001' },
    scenes: [{ scene_key: 'scene-001', coordinate_mode: 'semantic', axis_id: 'axis-a', axis_description: '门到窗形成主轴线', camera_side: 'north', anchors: ['door', 'window'], lighting_anchor: 'window-left' }],
    shots,
    unresolved: [],
    approved: true,
    ...overrides,
  }
}

test('同场景同机位连续状态可建议尾帧继承', () => {
  const previous = shot(1, actor('left'), actor('center'))
  const current = shot(2, actor('center'), actor('right'))
  assert.deepEqual(recommendTailLink(previous, current), { recommended: true, reasons: [] })
})

test('切换机位时不建议尾帧继承', () => {
  const result = recommendTailLink(shot(1, actor('left'), actor('center')), shot(2, actor('center'), actor('right'), { cameraSetupId: 'cam-b' }))
  assert.equal(result.recommended, false)
  assert.ok(result.reasons.includes('camera_changed'))
})

test('无证据持物跳变会阻塞，显式允许变化可以放行', () => {
  const previous = shot(1, actor('left'), actor('center', ['prop-knife']))
  const current = shot(2, actor('center'), actor('right'))
  assert.match(compareAdjacentStates(previous, current)[0].field, /held_props/)
  current.allowed_changes = ['actors.char-a.held_props']
  assert.deepEqual(compareAdjacentStates(previous, current), [])
})

test('合法连续性计划通过严格校验', () => {
  assert.doesNotThrow(() => validateContinuityPlan(documentWith([
    shot(1, actor('left'), actor('center')),
    shot(2, actor('center'), actor('right')),
  ]), 'ep-001'))
})

test('第一镜启用 previous-tail 被拒绝', () => {
  const first = shot(1, actor('left'), actor('center'))
  first.transition_link = { mode: 'previous-tail', source_shot_number: 0, source_camera_setup_id: 'cam-a', enabled: true, reason: '错误承接', required_provider_capability: 'video.first-frame' }
  assert.throws(() => validateContinuityPlan(documentWith([first]), 'ep-001'), /第一镜/)
})

test('已批准计划不能含未决项或相邻状态跳变', () => {
  assert.throws(() => validateContinuityPlan(documentWith([shot(1, actor('left'), actor('center'))], { unresolved: [{ id: 'continuity-1', question: '人物站位未知', affects: ['shot-001'] }] }), 'ep-001'), /未决项/)
  assert.throws(() => validateContinuityPlan(documentWith([
    shot(1, actor('left'), actor('center', ['prop-knife'])),
    shot(2, actor('center'), actor('right')),
  ]), 'ep-001'), /held_props/)
})

test('顶层和人物状态拒绝未声明字段', () => {
  assert.throws(() => validateContinuityPlan({ ...documentWith([]), extra: true }, 'ep-001'), /字段/)
  const invalid = shot(1, { ...actor('left'), invented: true }, actor('center'))
  assert.throws(() => validateContinuityPlan(documentWith([invalid]), 'ep-001'), /人物状态.*字段/)
})
