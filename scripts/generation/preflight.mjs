#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { call } from './mcp.mjs'

const [, , mode, projectRoot, manifestPath] = process.argv
if (process.argv.includes('--self-check')) { console.log('ok'); process.exit(0) }
if (mode !== 'images' || !projectRoot || !manifestPath) throw new Error('用法：preflight.mjs images <项目目录> <图片批量 JSON>')
const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'))
const result = await call('submit_episode_images', { project_root: projectRoot, items: manifest.items, confirmed: false })
console.log(JSON.stringify(result, null, 2))
if (!result.ready) process.exitCode = 1
