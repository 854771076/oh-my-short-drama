import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const paths = [
  'skills/short-drama/assets/modules/generate-character-profiles/prompts/agent_character_profile.zh.txt',
  'skills/short-drama/assets/modules/generate-character-profiles/prompts/agent_character_profile.en.txt',
  'skills/short-drama/assets/modules/generate-character-images/prompts/agent_character_visual.zh.txt',
  'skills/short-drama/assets/modules/generate-character-images/prompts/agent_character_visual.en.txt',
  'skills/short-drama/assets/modules/generate-character-images/prompts/character_asset_sheet.zh.txt',
  'skills/short-drama/assets/modules/generate-character-images/prompts/character_asset_sheet.en.txt',
]

test('中英文人物提示词覆盖成年魅力、妆造锚点和儿童保护', async () => {
  for (const path of paths) {
    const text = await readFile(path, 'utf8')
    for (const token of ['audience_appeal', 'adult-charisma', 'child-cuteness', 'grooming_and_makeup', 'costume_signature', 'memory_anchors']) assert.ok(text.includes(token), `${path} 缺少 ${token}`)
    if (path.endsWith('.zh.txt')) assert.match(text, /儿童.*(?:成人化|性化)/s)
    else assert.match(text, /child.*(?:adultified|sexualized)/is)
  }
})
