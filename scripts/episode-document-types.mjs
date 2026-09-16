export const EPISODE_DOCUMENT_CONFIG = Object.freeze({
  'script-review': { invalidationStage: 'script', recreationConsumer: false },
  'director-book': { invalidationStage: 'director-book', recreationConsumer: true },
  'asset-plan': { invalidationStage: 'asset-analysis', recreationConsumer: false },
  'production-plan': { invalidationStage: 'production-plan', recreationConsumer: true },
  storyboard: { invalidationStage: 'production-plan', recreationConsumer: true },
  'video-prompts': { invalidationStage: 'media-production', recreationConsumer: true },
  'audio-plan': { invalidationStage: 'media-production', recreationConsumer: true },
  'recreation-workflow': { invalidationStage: 'analysis', recreationConsumer: false },
})

export const EPISODE_DOCUMENT_KINDS = Object.freeze(Object.keys(EPISODE_DOCUMENT_CONFIG))
