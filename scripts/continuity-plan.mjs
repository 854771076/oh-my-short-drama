const TOP_LEVEL_FIELDS = ['episode_key', 'source_versions', 'scenes', 'shots', 'unresolved', 'approved']
const SOURCE_VERSION_FIELDS = ['storyboard', 'director-book', 'production-plan']
const SCENE_FIELDS = ['scene_key', 'coordinate_mode', 'axis_id', 'axis_description', 'camera_side', 'anchors', 'lighting_anchor']
const SHOT_FIELDS = ['shot_number', 'scene_key', 'camera_setup_id', 'start_state', 'end_state', 'transition_link', 'inherited_fields', 'allowed_changes', 'evidence']
const STATE_FIELDS = ['actors', 'props', 'axis_id', 'camera_side', 'lighting_anchor']
const ACTOR_FIELDS = ['actor_key', 'zone', 'depth', 'facing', 'eyeline_target', 'screen_direction', 'entry_edge', 'exit_edge', 'posture', 'held_props', 'visual_identity']
const VISUAL_IDENTITY_FIELDS = ['appearance_id', 'memory_anchors', 'costume_signature']
const PROP_FIELDS = ['prop_key', 'zone', 'depth', 'state', 'held_by']
const LINK_FIELDS = ['mode', 'source_shot_number', 'source_camera_setup_id', 'enabled', 'reason', 'required_provider_capability']
const POSITION_FIELDS = ['zone', 'depth', 'facing', 'eyeline_target', 'screen_direction', 'entry_edge', 'exit_edge', 'posture', 'held_props']

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  return value
}

function exactFields(value, fields, label) {
  const keys = Object.keys(object(value, label)).sort()
  if (JSON.stringify(keys) !== JSON.stringify([...fields].sort())) throw new Error(`${label} 字段必须且只能是：${fields.join(', ')}`)
}

function text(value, label, allowNull = false) {
  if (allowNull && value === null) return
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串${allowNull ? '或 null' : ''}`)
}

function textList(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${label} 必须是至少 ${min} 项的非空字符串数组`)
  if (new Set(value).size !== value.length) throw new Error(`${label} 不得重复`)
}

function validateActor(actor, label) {
  exactFields(actor, ACTOR_FIELDS, label)
  for (const field of ['actor_key', 'zone', 'depth', 'facing', 'screen_direction', 'posture']) text(actor[field], `${label}.${field}`)
  text(actor.eyeline_target, `${label}.eyeline_target`, true)
  text(actor.entry_edge, `${label}.entry_edge`, true)
  text(actor.exit_edge, `${label}.exit_edge`, true)
  textList(actor.held_props, `${label}.held_props`)
  exactFields(actor.visual_identity, VISUAL_IDENTITY_FIELDS, `${label}.visual_identity`)
  if (!Number.isInteger(actor.visual_identity.appearance_id) || actor.visual_identity.appearance_id < 1) throw new Error(`${label}.visual_identity.appearance_id 必须是正整数`)
  textList(actor.visual_identity.memory_anchors, `${label}.visual_identity.memory_anchors`, { min: 1 })
  text(actor.visual_identity.costume_signature, `${label}.visual_identity.costume_signature`)
}

function validateProp(prop, label) {
  exactFields(prop, PROP_FIELDS, label)
  for (const field of ['prop_key', 'zone', 'depth', 'state']) text(prop[field], `${label}.${field}`)
  text(prop.held_by, `${label}.held_by`, true)
}

function validateState(state, label) {
  exactFields(state, STATE_FIELDS, label)
  if (!Array.isArray(state.actors) || !Array.isArray(state.props)) throw new Error(`${label}.actors/props 必须是数组`)
  state.actors.forEach((actor, index) => validateActor(actor, `${label}.人物状态[${index}]`))
  state.props.forEach((prop, index) => validateProp(prop, `${label}.道具状态[${index}]`))
  const actorKeys = state.actors.map((actor) => actor.actor_key)
  const propKeys = state.props.map((prop) => prop.prop_key)
  if (new Set(actorKeys).size !== actorKeys.length) throw new Error(`${label}.actors actor_key 不得重复`)
  if (new Set(propKeys).size !== propKeys.length) throw new Error(`${label}.props prop_key 不得重复`)
  for (const field of ['axis_id', 'camera_side', 'lighting_anchor']) text(state[field], `${label}.${field}`)
}

function validateLink(link, label) {
  exactFields(link, LINK_FIELDS, label)
  if (!['independent', 'previous-tail'].includes(link.mode)) throw new Error(`${label}.mode 无效`)
  if (typeof link.enabled !== 'boolean') throw new Error(`${label}.enabled 必须是布尔值`)
  text(link.reason, `${label}.reason`)
  if (link.mode === 'independent') {
    if (link.enabled || link.source_shot_number !== null || link.source_camera_setup_id !== null || link.required_provider_capability !== null) throw new Error(`${label} independent 不得绑定来源或能力`)
    return
  }
  if (!link.enabled || !Number.isInteger(link.source_shot_number) || link.source_shot_number < 1) throw new Error(`${label} previous-tail 必须启用并绑定正整数来源镜号`)
  text(link.source_camera_setup_id, `${label}.source_camera_setup_id`)
  if (link.required_provider_capability !== 'video.first-frame') throw new Error(`${label} previous-tail 必须要求 video.first-frame`)
}

function differenceAllowed(allowed, path) {
  return allowed.has(path) || allowed.has(path.replace(/\.[^.]+$/, '.*'))
}

export function compareAdjacentStates(previous, current) {
  const allowed = new Set(current.allowed_changes || [])
  const beforeState = previous.end_state
  const afterState = current.start_state
  const issues = []
  const add = (field) => issues.push({ field, reason: '上一镜结束状态与下一镜开始状态不一致且没有允许变化' })

  for (const field of ['axis_id', 'camera_side', 'lighting_anchor']) {
    if (beforeState[field] !== afterState[field] && !differenceAllowed(allowed, field)) add(field)
  }

  const beforeActors = new Map(beforeState.actors.map((actor) => [actor.actor_key, actor]))
  const afterActors = new Map(afterState.actors.map((actor) => [actor.actor_key, actor]))
  for (const actorKey of new Set([...beforeActors.keys(), ...afterActors.keys()])) {
    const before = beforeActors.get(actorKey)
    const after = afterActors.get(actorKey)
    const presencePath = `actors.${actorKey}.presence`
    if (!before || !after) {
      const motivated = before?.exit_edge !== null || after?.entry_edge !== null
      if (!motivated && !differenceAllowed(allowed, presencePath)) add(presencePath)
      continue
    }
    for (const field of POSITION_FIELDS) {
      const path = `actors.${actorKey}.${field}`
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field]) && !differenceAllowed(allowed, path)) add(path)
    }
    for (const field of VISUAL_IDENTITY_FIELDS) {
      const path = `actors.${actorKey}.visual_identity.${field}`
      if (JSON.stringify(before.visual_identity[field]) !== JSON.stringify(after.visual_identity[field]) && !differenceAllowed(allowed, path)) add(path)
    }
  }

  const beforeProps = new Map(beforeState.props.map((prop) => [prop.prop_key, prop]))
  const afterProps = new Map(afterState.props.map((prop) => [prop.prop_key, prop]))
  for (const propKey of new Set([...beforeProps.keys(), ...afterProps.keys()])) {
    const before = beforeProps.get(propKey)
    const after = afterProps.get(propKey)
    for (const field of PROP_FIELDS.filter((name) => name !== 'prop_key')) {
      const path = `props.${propKey}.${field}`
      if (JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]) && !differenceAllowed(allowed, path)) add(path)
    }
  }
  return issues
}

export function recommendTailLink(previous, current) {
  const reasons = []
  if (previous.scene_key !== current.scene_key) reasons.push('scene_changed')
  if (previous.camera_setup_id !== current.camera_setup_id) reasons.push('camera_changed')
  if (previous.end_state.axis_id !== current.start_state.axis_id || previous.end_state.camera_side !== current.start_state.camera_side) reasons.push('axis_changed')
  const beforeActors = new Map(previous.end_state.actors.map((actor) => [actor.actor_key, actor]))
  for (const actor of current.start_state.actors) {
    if (beforeActors.has(actor.actor_key) && JSON.stringify(beforeActors.get(actor.actor_key).visual_identity) !== JSON.stringify(actor.visual_identity)) reasons.push(`actors.${actor.actor_key}.visual_identity`)
  }
  reasons.push(...compareAdjacentStates(previous, current).map((item) => item.field))
  return { recommended: reasons.length === 0, reasons: [...new Set(reasons)] }
}

export function validateContinuityPlan(document, episodeKey) {
  exactFields(document, TOP_LEVEL_FIELDS, 'continuity-plan')
  if (document.episode_key !== episodeKey || !/^ep-\d{3}$/.test(document.episode_key)) throw new Error('continuity-plan episode_key 与目标分集不一致')
  exactFields(document.source_versions, SOURCE_VERSION_FIELDS, 'continuity-plan.source_versions')
  for (const [kind, version] of Object.entries(document.source_versions)) if (!/^v\d{3}$/.test(version)) throw new Error(`continuity-plan.source_versions.${kind} 必须为 v001 格式`)
  if (!Array.isArray(document.scenes) || !Array.isArray(document.shots) || !Array.isArray(document.unresolved) || typeof document.approved !== 'boolean') throw new Error('continuity-plan scenes/shots/unresolved/approved 合同无效')

  const sceneKeys = new Set()
  document.scenes.forEach((scene, index) => {
    const label = `continuity-plan.scenes[${index}]`
    exactFields(scene, SCENE_FIELDS, label)
    for (const field of ['scene_key', 'axis_id', 'axis_description', 'camera_side', 'lighting_anchor']) text(scene[field], `${label}.${field}`)
    if (!['semantic', 'blender-world'].includes(scene.coordinate_mode)) throw new Error(`${label}.coordinate_mode 无效`)
    textList(scene.anchors, `${label}.anchors`)
    if (sceneKeys.has(scene.scene_key)) throw new Error(`scene_key 重复：${scene.scene_key}`)
    sceneKeys.add(scene.scene_key)
  })

  document.unresolved.forEach((item, index) => {
    const label = `continuity-plan.unresolved[${index}]`
    exactFields(item, ['id', 'question', 'affects'], label)
    text(item.id, `${label}.id`)
    text(item.question, `${label}.question`)
    textList(item.affects, `${label}.affects`, { min: 1 })
  })
  if (document.approved && document.unresolved.length) throw new Error('continuity-plan 存在未决项时不得 approved')

  const shotNumbers = new Set()
  let previous = null
  for (const [index, shot] of document.shots.entries()) {
    const label = `continuity-plan.shots[${index}]`
    exactFields(shot, SHOT_FIELDS, label)
    if (!Number.isInteger(shot.shot_number) || shot.shot_number < 1 || shotNumbers.has(shot.shot_number)) throw new Error(`${label}.shot_number 无效或重复`)
    shotNumbers.add(shot.shot_number)
    if (!sceneKeys.has(shot.scene_key)) throw new Error(`${label}.scene_key 未在 scenes 中声明`)
    text(shot.camera_setup_id, `${label}.camera_setup_id`)
    validateState(shot.start_state, `${label}.start_state`)
    validateState(shot.end_state, `${label}.end_state`)
    if (index === 0 && shot.transition_link?.mode !== 'independent') throw new Error('第一镜必须使用 independent，不能启用 previous-tail')
    validateLink(shot.transition_link, `${label}.transition_link`)
    textList(shot.inherited_fields, `${label}.inherited_fields`)
    textList(shot.allowed_changes, `${label}.allowed_changes`)
    textList(shot.evidence, `${label}.evidence`, { min: 1 })
    if (shot.allowed_changes.some((path) => /\.visual_identity(?:\.|$)/.test(path)) && !shot.evidence.some((item) => /(?:换装|妆造|发型|年龄变化|伪装|appearance|costume|identity)/i.test(item))) throw new Error(`${label} 人物妆造变化必须有明确剧情证据`)

    if (previous) {
      const issues = compareAdjacentStates(previous, shot)
      if (document.approved && issues.length) throw new Error(`镜头 ${previous.shot_number}→${shot.shot_number} 连续性失败：${issues.map((item) => item.field).join(', ')}`)
      if (shot.transition_link.mode === 'previous-tail') {
        if (shot.transition_link.source_shot_number !== previous.shot_number || shot.transition_link.source_camera_setup_id !== previous.camera_setup_id) throw new Error(`${label}.transition_link 必须绑定上一镜及其机位`)
        const recommendation = recommendTailLink(previous, shot)
        if (!recommendation.recommended) throw new Error(`${label} 不满足 previous-tail 条件：${recommendation.reasons.join(', ')}`)
      }
    }
    previous = shot
  }
  return document
}
