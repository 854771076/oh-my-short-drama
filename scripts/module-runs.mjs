#!/usr/bin/env node
import { access, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { stages } from './workflow-stages.mjs'
import { isH3Model } from './generation/providers.mjs'
import { readModuleMap } from './module-map.mjs'

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function selectedEpisodes(root) {
  const directory = resolve(root, 'episodes')
  if (!await exists(directory)) return []
  return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

async function selectedDocument(root, episode, kind) {
  const markerPath = resolve(root, 'episodes', episode, kind, 'selected.json')
  if (!await exists(markerPath)) return null
  const marker = JSON.parse(await readFile(markerPath, 'utf8'))
  return JSON.parse(await readFile(resolve(root, marker.path), 'utf8'))
}

function hasStructuredAction(document) {
  const items = [...(document?.scenes || []), ...(document?.shots || [])]
  return items.some((item) => item?.action_complexity === 'choreographed' || item?.fight_design || item?.fight_design_ref)
}

async function needsFightDesign(root) {
  for (const episode of await selectedEpisodes(root)) {
    for (const kind of ['director-book', 'production-plan']) {
      if (hasStructuredAction(await selectedDocument(root, episode, kind))) return true
    }
  }
  return false
}

export async function requiredModules(root, stage) {
  if (!stages.includes(stage)) throw new Error(`未知阶段：${stage}`)
  const moduleMap = await readModuleMap()
  let required = new Set(moduleMap.stages?.[stage] || [])

  if (stage === 'analysis') {
    let project = { workflow: { type: 'standard' } }
    try { project = JSON.parse(await readFile(resolve(root, '.short-drama/project.json'), 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    if (project.workflow?.type === 'viral-recreation') {
      required.delete('analyze-drama-source')
      const remainder = [...required].filter((id) => id !== 'manage-drama-projects')
      required = new Set(['manage-drama-projects', 'use-short-drama-studio', 'configure-generation-providers', 'analyze-reference-video', 'use-hypit-video', 'design-video-recreation', ...remainder])
    }
  }

  if (stage === 'asset-analysis') {
    for (const episode of await selectedEpisodes(root)) {
      const plan = await selectedDocument(root, episode, 'asset-plan')
      if (plan?.characters?.length) required.add('generate-character-profiles')
    }
  }

  if (stage === 'asset-generation') {
    let ledger = { assets: {} }
    try { ledger = JSON.parse(await readFile(resolve(root, '.short-drama/assets.json'), 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    let needsProvider = false
    for (const episode of await selectedEpisodes(root)) {
      const plan = await selectedDocument(root, episode, 'asset-plan')
      for (const [group, moduleId] of [['characters', 'generate-character-images'], ['scenes', 'generate-scene-assets'], ['props', 'generate-prop-assets']]) {
        for (const item of plan?.[group] || []) {
          const asset = ledger.assets?.[item.key]
          const version = asset?.versions?.find((entry) => entry.id === asset.selectedVersionId)
          const reusable = version && typeof version.localPath === 'string' && !asset.staleVersionIds?.includes(version.id) && version.provenance?.created_by !== 'provider' && await exists(resolve(root, version.localPath))
          if (!reusable) { required.add(moduleId); needsProvider = true }
        }
      }
    }
    if (needsProvider) required.add('drama-generation-service')
  }

  if (stage === 'production-plan') {
    required.delete('design-fight-video')
    if (await needsFightDesign(root)) required = new Set(['design-fight-video', ...required])
    for (const episode of await selectedEpisodes(root)) {
      for (const kind of ['production-plan', 'video-prompts']) {
        const document = await selectedDocument(root, episode, kind)
        if (Array.isArray(document?.unresolved) && document.unresolved.length > 0) required.add('revise-drama-storyboards')
      }
    }
  }

  if (stage === 'media-production') {
    let needsIndependentAudio = false
    for (const episode of await selectedEpisodes(root)) {
      const plan = await selectedDocument(root, episode, 'production-plan')
      for (const shot of plan?.shots || []) {
        if ((shot.storyboard_strategy?.mode || 'image') === 'image') required.add('generate-storyboard-images')
        if (shot.previz_strategy?.mode === 'blender') {
          required.add('direct-blender-previz')
          required.add('generate-blender-previz')
        }
        const mode = typeof shot.audio_strategy === 'string' ? shot.audio_strategy : shot.audio_strategy?.mode
        if (!isH3Model(shot.provider, shot.model_or_workflow) || mode !== 'native') needsIndependentAudio = true
      }
    }
    if (needsIndependentAudio) required.add('design-drama-audio')
  }

  return [...required]
}

export async function readModuleRuns(root) {
  const path = resolve(root, '.short-drama/module-runs.json')
  if (!await exists(path)) return { version: 1, runs: {} }
  return JSON.parse(await readFile(path, 'utf8'))
}
