import { MEDIA_OPERATIONS } from './media-operation-contract.mjs'

const PROFILES = {
  trim: ['inside_range', 'outside_range', 'duration', 'audio_preservation'],
  'replace-audio': ['inside_range', 'outside_range', 'audio_sync', 'voice_identity', 'duration'],
  stabilize: ['inside_range', 'outside_range', 'identity', 'temporal_consistency'],
  denoise: ['inside_range', 'outside_range', 'identity', 'temporal_consistency'],
  'color-match': ['inside_range', 'outside_range', 'identity', 'temporal_consistency'],
  'mask-blur': ['inside_range', 'outside_range', 'identity', 'temporal_consistency'],
  'frame-interpolate': ['inside_range', 'outside_range', 'identity', 'temporal_consistency'],
  'video-inpaint': ['inside_range', 'outside_range', 'identity', 'temporal_consistency'],
  'lip-sync': ['sync_timing', 'identity', 'mouth_artifacts', 'non_target_faces', 'duration'],
  'video-upscale': ['resolution', 'duration_fps', 'audio_preservation', 'faces_hands_text', 'motion_artifacts', 'color_crop'],
}

export const MEDIA_OPERATION_REVIEW_PROFILES = Object.freeze(Object.fromEntries(Object.entries(PROFILES).map(([operation, keys]) => [operation, Object.freeze([...keys])])))

function validQc(qc) {
  return qc?.version === 1
    && qc.passed === true
    && Array.isArray(qc.blockers)
    && qc.blockers.length === 0
    && /^[0-9a-f]{64}$/.test(qc.video_sha256 || '')
    && Number.isInteger(qc.duration_ms)
    && qc.duration_ms > 0
    && Number.isInteger(qc.video?.width)
    && qc.video.width > 0
    && Number.isInteger(qc.video?.height)
    && qc.video.height > 0
    && typeof qc.audio === 'boolean'
}

export function validateMediaOperationReview(operation, review) {
  if (!MEDIA_OPERATIONS.has(operation) || !PROFILES[operation]) throw new Error('媒体操作审核类型无效')
  if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('媒体操作审核必须是对象')
  if (typeof review.approved !== 'boolean') throw new Error('媒体操作审核 approved 必须是布尔值')
  if (!review.observations || typeof review.observations !== 'object' || Array.isArray(review.observations)) throw new Error('媒体操作审核 observations 必填')
  for (const key of PROFILES[operation]) {
    if (typeof review.observations[key] !== 'string' || !review.observations[key].trim()) throw new Error(`媒体操作审核 observations.${key} 必填`)
  }
  if (!Array.isArray(review.issues)) throw new Error('媒体操作审核 issues[] 必填')
  for (const issue of review.issues) {
    if (!['P0', 'P1', 'P2'].includes(issue?.severity) || typeof issue.message !== 'string' || !issue.message.trim()) throw new Error('媒体操作审核 issue 必须包含有效 severity/message')
  }
  if (review.approved) {
    if (review.watched_full !== true) throw new Error('批准媒体操作前必须完整观看并听完输出')
    if (!validQc(review.qc)) throw new Error('批准媒体操作必须绑定已通过的完整结构化 QC')
    if (operation === 'video-upscale' && (!Number.isFinite(review.qc.video?.fps) || review.qc.video.fps <= 0)) throw new Error('批准视频超分必须在 QC 中记录输出帧率')
    if (review.issues.some((issue) => ['P0', 'P1'].includes(issue.severity))) throw new Error('存在 P0/P1 问题时不得批准媒体操作')
  }
  return structuredClone(review)
}
