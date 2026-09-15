export const stages = ['analysis', 'script', 'director-book', 'asset-analysis', 'asset-generation', 'production-plan', 'media-production', 'editing', 'delivery']

export const MEDIA_PIPELINE_STAGES = ['character-appeal', 'continuity-plan', 'previous-tail', 'native-audio', 'native-audio-review', 'audio-fallback', 'lip-sync', 'licensed-music', 'media-editing', 'video-upscale', 'delivery']
export const MEDIA_PIPELINE_FALLBACKS = { 'native-audio-review': ['audio-fallback'] }

export const mediaPipelineStages = () => [...MEDIA_PIPELINE_STAGES]
export const stageFallback = (stage) => [...(MEDIA_PIPELINE_FALLBACKS[stage] || [])]
