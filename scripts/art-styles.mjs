import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const catalogPath = resolve(dirname(fileURLToPath(import.meta.url)), '../references/art-styles.json')
const configuredStyles = JSON.parse(readFileSync(catalogPath, 'utf8'))
const customCatalogPath = (workspaceRoot = process.cwd()) => process.env.SHORT_DRAMA_CUSTOM_ART_STYLES_FILE || resolve(workspaceRoot, 'art-styles.custom.json')

if (!Array.isArray(configuredStyles)) throw new Error('references/art-styles.json 必须是数组')

async function readCustomStyles(workspaceRoot) {
  try {
    const styles = JSON.parse(await readFile(customCatalogPath(workspaceRoot), 'utf8'))
    if (!Array.isArray(styles)) throw new Error('自定义画风库必须是数组')
    return styles
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export const artStyleCatalog = (workspaceRoot = process.cwd()) => {
  let customStyles = []
  try { customStyles = JSON.parse(readFileSync(customCatalogPath(workspaceRoot), 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  if (!Array.isArray(customStyles)) throw new Error('自定义画风库必须是数组')
  return [...configuredStyles, ...customStyles.filter((custom) => !configuredStyles.some((system) => system.id === custom.id))].map((style) => structuredClone(style))
}

export async function saveCustomArtStyle(style, workspaceRoot = process.cwd()) {
  if (!style?.id || configuredStyles.some((system) => system.id === style.id)) return
  const customStyles = await readCustomStyles(workspaceRoot)
  const index = customStyles.findIndex((custom) => custom.id === style.id)
  if (index >= 0) customStyles[index] = structuredClone(style)
  else customStyles.push(structuredClone(style))
  await mkdir(dirname(customCatalogPath(workspaceRoot)), { recursive: true })
  await writeFile(customCatalogPath(workspaceRoot), `${JSON.stringify(customStyles, null, 2)}\n`, { mode: 0o600 })
}
