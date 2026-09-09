import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vocabulary = JSON.parse(await readFile(resolve(root, 'references/controlled-vocabulary.json'), 'utf8'))

const terms = (groups, locale) => groups
  .map((group) => `${group[locale]}：${group[locale === 'zh' ? 'termsZh' : 'termsEn'].join(locale === 'zh' ? '、' : ', ')}`)
  .join('\n')

const sceneTypes = (locale) => vocabulary.storyboardSceneTypes
  .map((item) => `${item.code}（${item[locale]}）`)
  .join(' / ')

const sceneGuidance = (field, locale) => vocabulary.storyboardSceneTypes
  .map((item) => `- ${item.code}（${item[locale]}）：${item[`${field}${locale === 'zh' ? 'Zh' : 'En'}`]}`)
  .join('\n')

const ageRange = (item, locale) => locale === 'zh'
  ? (item.maxAge === null ? `${item.minAge}岁以上` : `约${item.minAge}-${item.maxAge}岁`)
  : (item.maxAge === null ? `age ${item.minAge}+` : `approximately age ${item.minAge}-${item.maxAge}`)

const cinema = (locale) => {
  const labels = { shotScale: locale === 'zh' ? '景别' : 'Shot scale', cameraAngle: locale === 'zh' ? '视角' : 'Camera angle', cameraMovement: locale === 'zh' ? '运镜' : 'Camera movement' }
  const lines = [locale === 'zh' ? '【规范镜头词汇】' : '[CANONICAL CINEMATOGRAPHY VOCABULARY]']
  for (const key of ['shotScale', 'cameraAngle', 'cameraMovement']) lines.push(`${labels[key]}：${vocabulary.cinematography[key].map((item) => item[locale]).join('、')}`)
  lines.push(locale === 'zh' ? 'shot_type 使用“视角+景别”，camera_move 只使用规范运镜名称。' : 'Use “camera angle + shot scale” for shot_type and only canonical movement names for camera_move.')
  return lines.join('\n')
}

export const systemVariableNames = new Set([
  'storyboard_scene_types', 'storyboard_scene_camera_styles', 'storyboard_scene_acting_styles',
  'performance_visual_vocabulary', 'character_video_subjects', 'character_profile_enums',
  'character_profile_reference_vocabulary', 'cinematography_vocabulary',
])

export function promptSystemVars(locale) {
  if (!['zh', 'en'].includes(locale)) throw new Error(`提示词语言无效：${locale}`)
  const profile = vocabulary.characterProfile
  return {
    storyboard_scene_types: locale === 'zh' ? `scene_type 只能使用：${sceneTypes(locale)}` : `scene_type must be one of: ${sceneTypes(locale)}`,
    storyboard_scene_camera_styles: sceneGuidance('camera', locale),
    storyboard_scene_acting_styles: sceneGuidance('acting', locale),
    performance_visual_vocabulary: terms(vocabulary.performanceVocabulary, locale),
    character_video_subjects: vocabulary.characterVideoSubjects.map((item) => `- ${item[locale]}：${ageRange(item, locale)}`).join('\n'),
    character_profile_enums: locale === 'zh'
      ? `role_level：${profile.roleLevels.join('/')}\ncostume_tier：${profile.costumeTiers.join('/')} 中的整数\ngender：${profile.genders.join('/')}`
      : `role_level: ${profile.roleLevels.join('/')}\ncostume_tier: integer ${Math.min(...profile.costumeTiers)}-${Math.max(...profile.costumeTiers)}\ngender: ${profile.genders.join('/')}`,
    character_profile_reference_vocabulary: terms(profile.referenceVocabulary, locale),
    cinematography_vocabulary: cinema(locale),
  }
}

export function injectPromptSystemVars(template, locale) {
  let output = template
  for (const [name, value] of Object.entries(promptSystemVars(locale))) output = output.replaceAll(`{${name}}`, value)
  return output
}
