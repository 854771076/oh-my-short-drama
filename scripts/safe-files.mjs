import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

export async function fileSha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function confinedExistingFile(rootValue, localPath, label = '文件') {
  const root = await realpath(resolve(rootValue))
  const actual = await realpath(resolve(root, localPath))
  if (actual !== root && !actual.startsWith(`${root}${sep}`)) throw new Error(`${label}路径逃逸项目目录`)
  return actual
}

export async function assertSafeOutputPath(rootValue, targetValue, label = '输出') {
  const rootPath = resolve(rootValue)
  const target = resolve(targetValue)
  const local = relative(rootPath, target)
  if (!local || local === '..' || local.startsWith(`..${sep}`)) throw new Error(`${label}路径逃逸项目目录`)
  const rootReal = await realpath(rootPath)
  let cursor = rootPath
  for (const part of local.split(sep)) {
    cursor = resolve(cursor, part)
    try {
      const info = await lstat(cursor)
      if (info.isSymbolicLink()) throw new Error(`${label}路径不得包含符号链接：${relative(rootPath, cursor)}`)
      const actual = await realpath(cursor)
      if (actual !== rootReal && !actual.startsWith(`${rootReal}${sep}`)) throw new Error(`${label}路径逃逸项目目录`)
    } catch (error) {
      if (error?.code === 'ENOENT') break
      throw error
    }
  }
  return target
}
