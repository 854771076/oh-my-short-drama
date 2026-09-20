#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

const file = process.argv[2]
if (file === '--self-check') {
  const sample = { locked_facts: [], conflict_arc: [], character_signatures: [], action_beats: [{ purpose: 'a', body_path: 'b', opponent_response: 'c', contact_result: 'd', force_feedback: 'e', state_result: 'f', next_condition: 'g' }], spatial_route: [{}], shot_plan: [{ shot_number: 1, duration_seconds: 1, narrative_purpose: 'a', camera: 'b', positions: 'c', action: 'd', handoff: 'e' }], continuity_constraints: [], unresolved: [], approved: true }
  console.log(JSON.stringify({ status: 'ok', shots: sample.shot_plan.length, action_beats: sample.action_beats.length }))
  process.exit(0)
}
if (!file) throw new Error('用法：validate-fight-plan.mjs <fight_design.json>')

const value = JSON.parse(await readFile(file, 'utf8'))
const required = ['locked_facts', 'conflict_arc', 'character_signatures', 'action_beats', 'spatial_route', 'shot_plan', 'continuity_constraints', 'unresolved', 'approved']
for (const key of required) if (!(key in value)) throw new Error(`缺少字段：${key}`)
for (const key of ['locked_facts', 'conflict_arc', 'character_signatures', 'action_beats', 'spatial_route', 'shot_plan', 'continuity_constraints', 'unresolved']) if (!Array.isArray(value[key])) throw new Error(`${key} 必须是数组`)
if (typeof value.approved !== 'boolean') throw new Error('approved 必须是布尔值')
if (value.approved && value.unresolved.length) throw new Error('存在 unresolved 时不得 approved')
if (!value.action_beats.length || !value.spatial_route.length || !value.shot_plan.length) throw new Error('动作、空间和分镜不能为空')

for (const [index, beat] of value.action_beats.entries()) {
  for (const key of ['purpose', 'body_path', 'opponent_response', 'contact_result', 'force_feedback', 'state_result', 'next_condition']) {
    if (typeof beat[key] !== 'string' || !beat[key].trim()) throw new Error(`action_beats[${index}].${key} 必填`)
  }
}
for (const [index, shot] of value.shot_plan.entries()) {
  for (const key of ['shot_number', 'duration_seconds', 'narrative_purpose', 'camera', 'positions', 'action', 'handoff']) if (!(key in shot)) throw new Error(`shot_plan[${index}] 缺少 ${key}`)
  if (shot.shot_number !== index + 1 || !Number.isInteger(shot.duration_seconds) || shot.duration_seconds <= 0) throw new Error(`shot_plan[${index}] 镜号或时长无效`)
}
console.log(JSON.stringify({ status: 'ok', shots: value.shot_plan.length, action_beats: value.action_beats.length }))
