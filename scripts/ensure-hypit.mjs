#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const mode = rawArgs[0] || 'check'
const hypitVersion = process.env.SHORT_DRAMA_HYPIT_VERSION || '0.2.10'
const hypitSkillSource = process.env.SHORT_DRAMA_HYPIT_SKILL_SOURCE || 'https://github.com/hypit-ai/hypit.git#b85a707777350e4c555a48550ff348965f78e2ee'
const projectIndex = rawArgs.indexOf('--project-root')
const projectArg = projectIndex >= 0 ? rawArgs[projectIndex + 1] : null
const projectRoot = projectArg ? resolve(projectArg) : null
if (!['check', 'ensure', '--self-check'].includes(mode)) throw new Error('用法：ensure-hypit.mjs check|ensure')
if (projectIndex >= 0 && !projectRoot) throw new Error('--project-root 必须提供路径')

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return { ok: result.status === 0, stdout: result.stdout?.trim() || '', stderr: result.stderr?.trim() || '' }
}

function executableStatus() {
  const result = run('hypit', ['version'])
  const paths = result.ok ? run('hypit', ['paths']) : { ok: false, stdout: '', stderr: '' }
  const version = result.ok ? result.stdout : null
  const matches = Boolean(version && new RegExp(`(^|\\D)v?${hypitVersion.replaceAll('.', '\\.')}(?=$|\\D)`).test(version))
  return { installed: result.ok && paths.ok && matches, expected_version: hypitVersion, version, paths: paths.ok ? paths.stdout : null, error: result.ok && paths.ok && matches ? null : result.stderr || paths.stderr || `Hypit 版本不匹配，期望 ${hypitVersion}` }
}

function skillStatus() {
  const direct = run('skills', ['list', '-g'])
  const result = direct.ok ? direct : run('npx', ['--no-install', 'skills', 'list', '-g'])
  return { installed: result.ok && /(^|\s)hypit(\s|$)/im.test(result.stdout), output: result.stdout, error: result.ok ? null : result.stderr || '找不到 skills CLI；ensure 模式会通过 npx 安装或更新它' }
}

function installSkill() {
  const result = run('npx', ['--yes', 'skills', 'add', hypitSkillSource, '-g'])
  if (!result.ok) throw new Error(`安装 Hypit Skill 失败：${result.stderr || result.stdout}`)
}

function installExecutable() {
  const result = run('npm', ['install', '--global', `@hypit/hypit@${hypitVersion}`])
  if (!result.ok) throw new Error(`安装 Hypit 可执行程序失败：${result.stderr || result.stdout}`)
}

if (mode === '--self-check') {
  console.log('ok')
  process.exit(0)
}

let executable = executableStatus()
let skill = skillStatus()
if (mode === 'ensure') {
  if (!skill.installed) {
    installSkill()
    const installed = run('npx', ['--yes', 'skills', 'list', '-g'])
    skill = { installed: installed.ok && /(^|\s)hypit(\s|$)/im.test(installed.stdout), output: installed.stdout?.trim() || '', error: installed.ok ? null : installed.stderr || '无法读取安装后的全局 Skill 清单' }
  }
  if (!executable.installed) {
    installExecutable()
    executable = executableStatus()
  }
  if (!skill.installed || !executable.installed) throw new Error('Hypit 安装后仍未通过环境检查')
}

const report = { schema_version: 1, executable, skill: { ...skill, expected_source: hypitSkillSource }, next: executable.installed && skill.installed ? 'ready' : 'run ensure to install missing components' }
if (projectRoot && mode === 'ensure') {
  const reportPath = resolve(projectRoot, '.short-drama/hypit/ready.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  report.project_report = '.short-drama/hypit/ready.json'
}
console.log(JSON.stringify(report, null, 2))
