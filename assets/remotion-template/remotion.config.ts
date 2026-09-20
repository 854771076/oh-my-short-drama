import { Config } from '@remotion/cli/config'

Config.setEntryPoint('./src/index.ts')
Config.setOverwriteOutput(true)
Config.setVideoImageFormat('jpeg')
Config.setCodec('h264')
Config.setPixelFormat('yuv420p')
