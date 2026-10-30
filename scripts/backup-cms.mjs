#!/usr/bin/env node
/**
 * 白标 CMS 备份打包脚本
 * 用法: 在 white-label-cms 目录下执行 `node scripts/backup-cms.mjs`
 * 输出: 上级目录（D:\AI）下的 cms-backup-<YYYYMMDD-HHmmss>.zip
 * 排除: node_modules、.wrangler、dist、build、.git（不备份依赖与缓存）
 */
import JSZip from 'jszip'
import { createReadStream, createWriteStream, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'

const streamPipeline = promisify(pipeline)

const PROJECT = resolve('.')      // 白标 CMS 项目根（cwd 运行时即本目录）
const OUT_DIR = resolve('..')     // 备份文件输出到上一级目录 D:\AI
const SKIP = new Set(['node_modules', '.wrangler', 'dist', 'build', '.git'])

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d+Z$/, '')
  .replace('T', '-')
// 例如: 20261028-173700

const zipName = `cms-backup-${stamp}.zip`
const outPath = join(OUT_DIR, zipName)

const zip = new JSZip()

function addDir(dirPath, folder) {
  for (const name of readdirSync(dirPath)) {
    if (SKIP.has(name)) continue
    const full = join(dirPath, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      addDir(full, folder.folder(name))
    } else {
      folder.file(name, createReadStream(full))
    }
  }
}

addDir(PROJECT, zip)

await streamPipeline(
  zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true }),
  createWriteStream(outPath)
)

console.log(`✔ 已打包: ${outPath}`)
