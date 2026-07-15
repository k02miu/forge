#!/usr/bin/env node
// forge プラグインの最小構造バリデータ。frontmatter・ファイル参照・JS スケルトン構文のみを検証する。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AGENT_TYPES = ['analyst', 'builder', 'architecture', 'security', 'tests', 'ui', 'infra', 'reuse']

const errors = []
let checks = 0

function fail(file, message) {
  errors.push(`${path.relative(ROOT, file)}: ${message}`)
}

function listFiles(dir, matcher) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(e => e.isFile() && matcher(e.name))
    .map(e => path.join(e.parentPath ?? e.path, e.name))
}

// --- frontmatter パース(単純な行パース。YAML パーサは使わない) ---
function parseFrontmatter(content) {
  const lines = content.split('\n')
  if (lines[0] !== '---') return null
  const end = lines.indexOf('---', 1)
  if (end === -1) return null
  const fm = {}
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/)
    if (m) fm[m[1]] = m[2].trim()
  }
  const body = lines.slice(end + 1).join('\n')
  return { fm, body }
}

// --- (a) frontmatter 検証 ---
function checkSkillFrontmatter(file) {
  checks++
  const dirName = path.basename(path.dirname(file))
  const content = fs.readFileSync(file, 'utf8')
  const parsed = parseFrontmatter(content)
  if (!parsed) return fail(file, 'frontmatter (--- で囲まれたブロック) が見つからない')
  const { fm } = parsed
  if (fm.name !== dirName) fail(file, `frontmatter の name(${fm.name ?? '(なし)'})がディレクトリ名(${dirName})と一致しない`)
  if (!fm.description) fail(file, 'frontmatter の description が空または欠落')
  if (fm['disable-model-invocation'] !== 'true') fail(file, 'frontmatter に disable-model-invocation: true がない')
  return parsed
}

function checkAgentFrontmatter(file) {
  checks++
  const baseName = path.basename(file, '.md')
  const content = fs.readFileSync(file, 'utf8')
  const parsed = parseFrontmatter(content)
  if (!parsed) return fail(file, 'frontmatter (--- で囲まれたブロック) が見つからない')
  const { fm } = parsed
  if (fm.name !== baseName) fail(file, `frontmatter の name(${fm.name ?? '(なし)'})がファイル名(${baseName})と一致しない`)
  if (!fm.description) fail(file, 'frontmatter の description が空または欠落')
  return parsed
}

// --- (b) ファイル参照のリンク切れ検証 ---
function checkFileLinks(file, content) {
  const pattern = /\$\{CLAUDE_PLUGIN_ROOT\}\/(references\/[A-Za-z0-9_.-]+\.md|scripts\/[A-Za-z0-9_.-]+)/g
  for (const m of content.matchAll(pattern)) {
    checks++
    const target = path.join(ROOT, m[1])
    if (!fs.existsSync(target)) fail(file, `参照先が存在しない: \${CLAUDE_PLUGIN_ROOT}/${m[1]}`)
  }
}

function checkAgentReferences(file, content) {
  // agents/<name>.md への言及
  for (const m of content.matchAll(/agents\/([A-Za-z0-9_-]+)\.md/g)) {
    checks++
    const target = path.join(ROOT, 'agents', `${m[1]}.md`)
    if (!fs.existsSync(target)) fail(file, `参照先が存在しない: agents/${m[1]}.md`)
  }
  // forge:<agentType> 名(既知の 8 種のみが agentType 名。forge:plan / forge:work 等のコマンド名は対象外)
  for (const m of content.matchAll(/forge:([A-Za-z0-9_-]+)/g)) {
    if (!AGENT_TYPES.includes(m[1])) continue
    checks++
    const target = path.join(ROOT, 'agents', `${m[1]}.md`)
    if (!fs.existsSync(target)) fail(file, `agentType forge:${m[1]} に対応する agents/${m[1]}.md が存在しない`)
  }
}

// --- (c) JS スケルトンの構文検証 ---
function checkJsBlocks(file, content) {
  const pattern = /```js\n([\s\S]*?)```/g
  let index = 0
  for (const m of content.matchAll(pattern)) {
    index++
    checks++
    // Workflow ツールのランタイムは本体を async 関数コンテキストで実行するため、
    // top-level return/await は合法。同じ実行モデルで構文チェックするため IIFE でラップする
    const body = m[1].replace(/^export const meta/m, 'const meta')
    const wrapped = `(async () => {\n${body}\n})()\n`
    const tmpFile = path.join(os.tmpdir(), `forge-validate-${path.basename(file, '.md')}-${index}-${process.pid}.mjs`)
    fs.writeFileSync(tmpFile, wrapped)
    try {
      execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' })
    } catch (e) {
      const detail = (e.stderr ?? e.message).toString().trim().split('\n').slice(0, 3).join(' / ')
      fail(file, `js ブロック #${index} が構文エラー: ${detail}`)
    } finally {
      fs.rmSync(tmpFile, { force: true })
    }
  }
}

// --- 実行 ---
const skillFiles = listFiles(path.join(ROOT, 'skills'), n => n === 'SKILL.md')
const agentFiles = listFiles(path.join(ROOT, 'agents'), n => n.endsWith('.md'))
const referenceFiles = listFiles(path.join(ROOT, 'references'), n => n.endsWith('.md'))

for (const file of skillFiles) {
  checkSkillFrontmatter(file)
  const content = fs.readFileSync(file, 'utf8')
  checkFileLinks(file, content)
  checkAgentReferences(file, content) // frontmatter・本文の両方を含む content 全体を対象にする
  checkJsBlocks(file, content)
}

for (const file of agentFiles) {
  checkAgentFrontmatter(file)
}

for (const file of referenceFiles) {
  const content = fs.readFileSync(file, 'utf8')
  checkFileLinks(file, content)
  checkJsBlocks(file, content)
}

if (errors.length > 0) {
  for (const e of errors) console.error(e)
  console.error(`\n${checks} 件中 ${errors.length} 件失敗`)
  process.exit(1)
}

console.log(`OK: ${checks} 件のチェックがすべて成功`)
process.exit(0)
