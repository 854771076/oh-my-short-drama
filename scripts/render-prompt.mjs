#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { injectPromptSystemVars } from './prompt-system-vars.mjs'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillMap = JSON.parse(await readFile(resolve(pluginRoot, 'references/skill-map.json'), 'utf8'))
const providerPrompts = new Set(skillMap.provider_prompts || [])

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

export function render(template, vars, locale = 'zh') {
  template = injectPromptSystemVars(template, locale)
  const missing = new Set()
  const output = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    if (!(name in vars)) { missing.add(name); return `{${name}}` }
    return typeof vars[name] === 'string' ? vars[name] : JSON.stringify(vars[name])
  })
  if (missing.size) throw new Error(`缺少提示词变量：${[...missing].join(', ')}`)
  return output
}

function rejectSecrets(value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (/(?:api[_-]?key|token|password|secret|authorization)/i.test(key)) throw new Error(`提示词变量禁止包含密钥字段：${childPath}`)
    rejectSecrets(child, childPath)
  }
}

function inside(root, value, label) {
  const path = resolve(value)
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`${label} 必须位于 ${root} 内`)
  return path
}

async function existingInside(root, value, label) {
  const [boundary, path] = await Promise.all([realpath(root), realpath(resolve(value))])
  if (path !== boundary && !path.startsWith(`${boundary}${sep}`)) throw new Error(`${label} 必须位于 ${root} 内`)
  return path
}

async function writableInside(root, value, label) {
  const path = inside(resolve(root), value, label)
  await existingInside(root, dirname(path), `${label}父目录`)
  return path
}

function rejectSecretText(value, label) {
  if (/(?:\b(?:sk|rk)-[A-Za-z0-9_-]{16,}|\bBearer\s+\S{16,}|\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S{8,})/i.test(value)) throw new Error(`${label} 疑似包含密钥`)
}

async function recordPromptRun(projectRoot, templatePath, locale, vars, template, output, outputPath, codexOutputPath) {
  rejectSecrets(vars)
  const root = await realpath(resolve(projectRoot))
  const actualOutput = await realpath(resolve(codexOutputPath || outputPath))
  const target = resolve(root, '.short-drama/prompt-runs', `prompt-${randomUUID()}.json`)
  const relativeTemplate = relative(pluginRoot, resolve(templatePath))
  const prompt = basename(templatePath).replace(/\.(?:zh|en)\.txt$/, '')
  const record = {
    version: 1,
    prompt,
    skill: skillMap.prompts[prompt],
    locale,
    template: relativeTemplate.startsWith('..') ? basename(templatePath) : relativeTemplate,
    templateSha256: createHash('sha256').update(template).digest('hex'),
    variables: vars,
    executionMode: codexOutputPath ? 'codex-contract' : 'provider-prompt',
    resolvedContractOrPrompt: output,
    outputPath: relative(root, actualOutput),
    createdAt: new Date().toISOString(),
  }
  if (codexOutputPath) {
    record.codexOutput = await readFile(codexOutputPath, 'utf8')
    rejectSecretText(record.codexOutput, 'Codex 实际产物')
    record.codexOutputSha256 = createHash('sha256').update(record.codexOutput).digest('hex')
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
  return relative(root, target)
}

async function main() {
  if (process.argv.includes('--self-check')) {
    if (render('你好，{name}', { name: '短剧' }) !== '你好，短剧') throw new Error('自检失败')
    if (render('{character_profile_enums}', {}, 'en').includes('{character_profile_enums}')) throw new Error('系统枚举注入失败')
    try { inside(pluginRoot, resolve(pluginRoot, '..', 'escape.txt'), '模板'); throw new Error('路径边界自检失败') } catch (error) { if (!String(error.message).includes('必须位于')) throw error }
    try { rejectSecretText('api_key=sk-12345678901234567890', '测试'); throw new Error('密钥自检失败') } catch (error) { if (!String(error.message).includes('疑似包含密钥')) throw error }
    return console.log('ok')
  }
  const templatePath = arg('--template')
  const varsPath = arg('--vars')
  if (!templatePath || !varsPath) throw new Error('必须提供 --template 和 --vars')
  const projectRoot = arg('--project-root')
  const root = projectRoot ? resolve(projectRoot) : null
  const safeTemplate = await existingInside(pluginRoot, templatePath, '模板')
  const safeVars = root ? await existingInside(root, varsPath, '变量文件') : resolve(varsPath)
  const outputPath = arg('--output')
  const codexOutputPath = arg('--codex-output')
  if (outputPath && codexOutputPath) throw new Error('--output 与 --codex-output 不能同时使用')
  const safeOutput = outputPath && root ? await writableInside(root, outputPath, '输出文件') : outputPath && resolve(outputPath)
  const safeCodexOutput = codexOutputPath && root ? await existingInside(root, codexOutputPath, 'Codex 产物') : codexOutputPath && resolve(codexOutputPath)
  const promptName = basename(safeTemplate).replace(/\.(?:zh|en)\.txt$/, '')
  if (outputPath && !providerPrompts.has(promptName)) throw new Error(`${promptName} 是 Codex 合同，必须使用 --codex-output`)
  if (codexOutputPath && providerPrompts.has(promptName)) throw new Error(`${promptName} 是 Provider 提示词，必须使用 --output`)
  const locale = arg('--locale') || (/\.en\.txt$/.test(safeTemplate) ? 'en' : 'zh')
  const template = await readFile(safeTemplate, 'utf8')
  const vars = JSON.parse(await readFile(safeVars, 'utf8'))
  const output = render(template, vars, locale)
  rejectSecretText(output, '解析后的合同或提示词')
  if (safeOutput) await writeFile(safeOutput, output, { flag: 'wx' })
  if (projectRoot) {
    if (!outputPath && !codexOutputPath) throw new Error('--project-root 留痕时必须提供 --output 或 --codex-output')
    console.log(await recordPromptRun(projectRoot, safeTemplate, locale, vars, template, output, safeOutput, safeCodexOutput))
  } else if (!outputPath) process.stdout.write(output)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
