#!/usr/bin/env node
import { mkdir } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function positive(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} 必须是正整数`)
  return number
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 执行失败：${result.stderr || result.status}`)
  return result.stdout?.trim() || ''
}

function gridLayout(count, columns) {
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = column === 0 ? '0' : Array(column).fill('w0').join('+')
    const y = row === 0 ? '0' : Array(row).fill('h0').join('+')
    return `${x}_${y}`
  }).join('|')
}

function gridCellCrop(width, height, columns, rows, index, contentPercent) {
  const cellWidth = Math.floor(width / columns)
  const cellHeight = Math.floor(height * contentPercent / 100 / rows)
  return [cellWidth, cellHeight, (index - 1) % columns * cellWidth, Math.floor((index - 1) / columns) * cellHeight]
}

function distinct(input, output) {
  if (resolve(input) === resolve(output)) throw new Error('输出路径不得覆盖源文件')
}

function qualityEvents(stderr) {
  return stderr.split(/\r?\n/).map((line) => line.trim()).filter((line) => /(?:black_(?:start|end|duration)|silence_(?:start|end|duration)|freeze_(?:start|end|duration)|I:\s*-?\d|Peak:\s*-?\d)/.test(line))
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === '--self-check') {
    if (positive('2', '列数') !== 2 || gridLayout(4, 2) !== '0_0|w0_0|0_h0|w0_h0' || JSON.stringify(gridCellCrop(1200, 1000, 2, 2, 4, 80)) !== '[600,400,600,400]' || qualityEvents('[blackdetect] black_start:0 black_end:1').length !== 1) throw new Error('自检失败')
    return console.log('ok')
  }
  if (command === 'probe') {
    if (!args[0]) throw new Error('用法：probe <媒体文件>')
    return console.log(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', resolve(args[0])], true))
  }
  if (command === 'qc') {
    if (!args[0]) throw new Error('用法：qc <媒体文件>')
    const input = resolve(args[0])
    const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', input], true))
    const filters = []
    if (probe.streams?.some((stream) => stream.codec_type === 'video')) filters.push('-vf', 'blackdetect=d=0.2:pix_th=0.10,freezedetect=n=-50dB:d=2')
    if (probe.streams?.some((stream) => stream.codec_type === 'audio')) filters.push('-af', 'silencedetect=n=-50dB:d=2,ebur128=peak=true')
    if (!filters.length) throw new Error('媒体不包含可检查的音视频流')
    const result = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-i', input, ...filters, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`ffmpeg 质量检查失败：${result.stderr || result.status}`)
    return console.log(JSON.stringify({ probe, events: qualityEvents(result.stderr || '') }, null, 2))
  }
  if (command === 'extract-frame') {
    const [input, output, position = 'first'] = args
    if (!input || !output) throw new Error('用法：extract-frame <视频> <输出图片> [first|last|秒数]')
    distinct(input, output)
    await mkdir(dirname(resolve(output)), { recursive: true })
    const seek = position === 'last' ? ['-sseof', '-0.05'] : position === 'first' ? [] : ['-ss', String(Number(position))]
    if (!['first', 'last'].includes(position) && (!Number.isFinite(Number(position)) || Number(position) < 0)) throw new Error('帧位置必须是 first、last 或非负秒数')
    run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-n', ...seek, '-i', resolve(input), '-frames:v', '1', '-update', '1', resolve(output)])
    return
  }
  if (command === 'crop') {
    const [input, output, width, height, x = '0', y = '0'] = args
    if (!input || !output) throw new Error('用法：crop <图片> <输出图片> <宽> <高> [x] [y]')
    distinct(input, output)
    const values = [positive(width, '宽'), positive(height, '高'), Number(x), Number(y)]
    if (!Number.isInteger(values[2]) || values[2] < 0 || !Number.isInteger(values[3]) || values[3] < 0) throw new Error('x/y 必须是非负整数')
    await mkdir(dirname(resolve(output)), { recursive: true })
    run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-n', '-i', resolve(input), '-vf', `crop=${values.join(':')}`, '-frames:v', '1', '-update', '1', resolve(output)])
    return
  }
  if (command === 'split-grid') {
    const [input, outputDir, columnsRaw, rowsRaw] = args
    if (!input || !outputDir) throw new Error('用法：split-grid <图片> <输出目录> <列数> <行数>')
    const columns = positive(columnsRaw, '列数')
    const rows = positive(rowsRaw, '行数')
    const metadata = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', resolve(input)], true))
    const { width, height } = metadata.streams?.[0] || {}
    if (!width || !height || width % columns || height % rows) throw new Error('图片尺寸必须能被列数和行数整除')
    const cellWidth = width / columns
    const cellHeight = height / rows
    await mkdir(resolve(outputDir), { recursive: true })
    const extension = extname(input) || '.png'
    const stem = basename(input, extname(input))
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column + 1
        run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-n', '-i', resolve(input), '-vf', `crop=${cellWidth}:${cellHeight}:${column * cellWidth}:${row * cellHeight}`, '-frames:v', '1', '-update', '1', resolve(outputDir, `${stem}-${String(index).padStart(2, '0')}${extension}`)])
      }
    }
    return
  }
  if (command === 'extract-grid-cell') {
    const [input, output, columnsRaw, rowsRaw, indexRaw = '1', contentPercentRaw = '85'] = args
    if (!input || !output) throw new Error('用法：extract-grid-cell <图片> <输出图片> <列数> <行数> [格号] [画面高度百分比]')
    distinct(input, output)
    const columns = positive(columnsRaw, '列数')
    const rows = positive(rowsRaw, '行数')
    const index = positive(indexRaw, '格号')
    const contentPercent = positive(contentPercentRaw, '画面高度百分比')
    if (index > columns * rows || contentPercent < 50 || contentPercent > 100) throw new Error('格号超出范围，画面高度百分比必须为 50–100')
    const metadata = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', resolve(input)], true))
    const { width, height } = metadata.streams?.[0] || {}
    const crop = gridCellCrop(width, height, columns, rows, index, contentPercent)
    await mkdir(dirname(resolve(output)), { recursive: true })
    run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-n', '-i', resolve(input), '-vf', `crop=${crop.join(':')}`, '-frames:v', '1', '-update', '1', resolve(output)])
    return
  }
  if (command === 'compose-grid') {
    const [output, columnsRaw, ...inputs] = args
    if (!output || inputs.length < 2) throw new Error('用法：compose-grid <输出图片> <列数> <图片...>')
    for (const input of inputs) distinct(input, output)
    const columns = positive(columnsRaw, '列数')
    await mkdir(dirname(resolve(output)), { recursive: true })
    const inputArgs = inputs.flatMap((input) => ['-i', resolve(input)])
    run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-n', ...inputArgs, '-filter_complex', `xstack=inputs=${inputs.length}:layout=${gridLayout(inputs.length, columns)}:fill=black`, '-frames:v', '1', '-update', '1', resolve(output)])
    return
  }
  throw new Error('用法：media-tools.mjs probe|qc|extract-frame|crop|split-grid|extract-grid-cell|compose-grid ...')
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
