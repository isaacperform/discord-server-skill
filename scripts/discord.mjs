#!/usr/bin/env node
// discord-server — Claude Code 에서 말로 디스코드 서버를 만들고 봇으로 운영하는 CLI (의존성 0, Node 18+)
//
//   node scripts/discord.mjs help
//
// - 서버 하나 = 프로필 하나: ~/.config/discord-server/<프로필>/ 에 server.json(설계도)·content/·state.json·.env(토큰)
// - 토큰은 .env 에만 두고 절대 출력하지 않는다. 받을 때는 클립보드에서 읽고 비운다.
// - Gateway 없이 REST 만 쓴다 — 상주 프로세스·서버비 0. 그래서 봇은 늘 '오프라인'으로 보인다 (정상).
// - 봇은 서버를 만들 수 없다 (디스코드가 2025-07-15 POST /guilds 폐지). 서버 생성만 사람이 한다.

import {
  chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_BASE, ApiError, HdError, HINT_NETWORK, createApi, fail, installUrl } from './lib/api.mjs'
import { clearClipboard, looksLikeBotToken, promptHidden, readClipboard, writeClipboard } from './lib/clipboard.mjs'
import { ADMIN, permNames } from './lib/perms.mjs'
import {
  TYPES, TYPE_NAMES, KEY_RE, accessRules, allChannels, buildOverwrites, colorInt, everyonePerms, findChannel,
  normalize, readSpec, renderContent, rolePerms, validate,
} from './lib/spec.mjs'

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(SKILL_DIR, 'package.json'), 'utf8')).version
  } catch {
    return '1'
  }
})()
const USER_AGENT = `DiscordBot (https://github.com/isaacperform/discord-server-skill, ${VERSION})`

const INTENT = { MEMBERS: 1 << 14, MEMBERS_LIMITED: 1 << 15, CONTENT: 1 << 18, CONTENT_LIMITED: 1 << 19 }
const SUPPRESS_EMBEDS = 1 << 2
const SUPPRESS_NOTIFICATIONS = 1 << 12
const SHOWN = [0, 19, 21] // 일반 · 답장 · 스레드 시작 글 (시스템 메시지는 뺀다)
const EPOCH = 1420070400000n

const log = (...a) => console.log(...a)
const loadJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, data, mode) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n', mode ? { mode } : undefined)
const snowTime = (id) => Number((BigInt(id) >> 22n) + EPOCH)
const fmtTime = (ms) => new Date(ms).toLocaleString('sv-SE').slice(0, 16)
const link = (gid, ch, msg) => `https://discord.com/channels/${gid}/${ch}${msg ? '/' + msg : ''}`
const displayName = (m) => m.nick ?? m.user.global_name ?? m.user.username
const byPos = (a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1)

const HUMAN_STEPS = `사람이 해야 하는 일 (디스코드 정책상 봇이 못 해요 — 5분)
  1) 서버 만들기: 디스코드 앱 왼쪽 + (서버 추가하기) → 직접 만들기 → 이름 정하고 만들기
  2) 앱 만들기: https://discord.com/developers/applications → New Application → 이름 → Create
  3) 토큰 복사: 왼쪽 Bot → Reset Token → Yes, do it! → Copy   (2단계 인증 코드를 물어볼 수 있어요)
  4) 복사한 그대로: token        ← 클립보드에서 읽어 저장하고 비워요. 토큰을 채팅에 붙이지 마세요
  5) token 이 알려 주는 초대 링크를 열어 1)의 서버를 고르고 승인`

// ---------- 프로필 ----------
const homeDir = () => process.env.DISCORD_SERVER_HOME ?? join(homedir(), '.config', 'discord-server')
function listProfiles(home) {
  if (!existsSync(home)) return []
  return readdirSync(home, { withFileTypes: true })
    .filter((d) => d.isDirectory() && ['server.json', '.env', 'state.json'].some((f) => existsSync(join(home, d.name, f))))
    .map((d) => d.name)
    .sort()
}
function resolveProfile(opts, { strict = true } = {}) {
  const home = homeDir()
  let name = opts.profile ?? process.env.DISCORD_PROFILE
  const existing = listProfiles(home)
  if (!name) {
    if (existing.length > 1 && strict && !opts.dir && !process.env.DISCORD_SERVER_DIR) {
      fail(`프로필이 여러 개예요 (${existing.join(', ')}) — --profile <이름> 으로 골라 주세요`)
    }
    name = existing.length === 1 ? existing[0] : 'default'
  }
  if (!KEY_RE.test(name)) fail(`프로필 이름 '${name}' — 글자·숫자·-·_ 만 써요`)
  const dir = resolve(opts.dir ?? process.env.DISCORD_SERVER_DIR ?? join(home, name))
  return { home, name, dir, existing }
}

function readToken(dir) {
  if (process.env.DISCORD_BOT_TOKEN) return { value: process.env.DISCORD_BOT_TOKEN.trim(), source: '환경변수 DISCORD_BOT_TOKEN' }
  const file = join(dir, '.env')
  if (!existsSync(file)) return null
  const m = readFileSync(file, 'utf8').match(/^DISCORD_BOT_TOKEN=(.+)$/m)
  return m ? { value: m[1].trim().replace(/^["']|["']$/g, ''), source: file } : null
}
function writeToken(dir, token) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, '.env')
  const keep = existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.startsWith('DISCORD_BOT_TOKEN='))
    : []
  writeFileSync(file, [...keep, `DISCORD_BOT_TOKEN=${token}`].join('\n') + '\n', { mode: 0o600 })
  chmodSync(file, 0o600)
  ensureGitignore(dir)
  return file
}
function ensureGitignore(dir) {
  const file = join(dir, '.gitignore')
  if (!existsSync(file)) writeFileSync(file, '# 토큰·초대 받은 사람 메모 — 공개 저장소에 올리지 않는다\n.env\ninvites.json\n')
}

function makeContext(opts) {
  const p = resolveProfile(opts, { strict: !['init', 'profiles', 'help', 'doctor'].includes(opts._cmd) })
  const stateFile = join(p.dir, 'state.json')
  const ctx = {
    ...p,
    opts,
    dry: !!opts.dry,
    state: loadJson(stateFile, {}),
    _spec: undefined,
    spec() {
      if (this._spec === undefined) this._spec = readSpec(this.dir)
      return this._spec
    },
    trySpec() {
      try {
        return this.spec()
      } catch {
        return null
      }
    },
    saveState() {
      if (this.dry) return
      mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      writeJson(stateFile, this.state)
    },
  }
  const api = createApi({
    userAgent: USER_AGENT,
    dry: ctx.dry,
    getToken() {
      const t = readToken(ctx.dir)
      if (!t) fail(`봇 토큰이 없어요 (프로필 ${ctx.name})\n${HUMAN_STEPS}`)
      return t.value
    },
  })
  ctx.req = api.req
  ctx.setReason = (cmd) => api.setReason(`discord-server-skill ${cmd}`)
  return ctx
}

// ---------- 서버 고르기 ----------
async function pickGuild(ctx) {
  const guilds = await ctx.req('GET', '/users/@me/guilds')
  const want = ctx.opts.guild ?? ctx.state.guild_id
  if (want) {
    const g = guilds.find((x) => x.id === want)
    if (g) return g
    if (ctx.opts.guild) fail(`봇이 서버 ${ctx.opts.guild} 에 없어요 — whoami 로 봇이 있는 서버를 보세요`)
    log(`⚠️  예전에 고른 서버(${want})에 봇이 없어요 — 다시 고릅니다`)
  }
  const name = ctx.trySpec()?.server?.name
  const named = name ? guilds.filter((g) => g.name.toLowerCase() === name.toLowerCase()) : []
  if (named.length === 1) return named[0]
  if (guilds.length === 1) return guilds[0]
  if (!guilds.length) return null
  fail(`봇이 서버 ${guilds.length}곳에 있어요: ${guilds.map((g) => `${g.name} (${g.id})`).join(', ')}\n   👉 --guild <id> 로 골라 주세요 (한 번 고르면 기억해요)`)
}

async function notInGuildMessage(ctx) {
  const app = await ctx.req('GET', '/applications/@me')
  return `봇이 아직 서버에 없어요.\n  1) (서버가 없으면) 디스코드 앱 왼쪽 + → 직접 만들기 → 이름 정하고 만들기\n  2) 이 링크를 열어 그 서버를 고르고 승인:\n     ${installUrl(app.id)}`
}

async function ensureGuild(ctx) {
  if (ctx.opts.guild) ctx.state.guild_id = ctx.opts.guild
  if (ctx.state.guild_id) return ctx.state.guild_id
  const g = await pickGuild(ctx)
  if (!g) fail(await notInGuildMessage(ctx))
  ctx.state.guild_id = g.id
  return g.id
}

// 100서버 미만 봇은 특권 인텐트 *_LIMITED 를 API 로 켤 수 있다 — 멤버 목록·메시지 내용 읽기에 필요
async function ensureIntents(ctx, app) {
  const f = app.flags ?? 0
  const members = f & (INTENT.MEMBERS | INTENT.MEMBERS_LIMITED)
  const content = f & (INTENT.CONTENT | INTENT.CONTENT_LIMITED)
  if (members && content) return { ok: true, text: '켜져 있음' }
  const want = f | (members ? 0 : INTENT.MEMBERS_LIMITED) | (content ? 0 : INTENT.CONTENT_LIMITED)
  try {
    await ctx.req('PATCH', '/applications/@me', { flags: want })
    return { ok: true, text: '방금 켬 (서버 멤버 · 메시지 내용)' }
  } catch (e) {
    return {
      ok: false,
      text: `API 로 못 켰어요 (${e.message.split('\n')[0]})\n   👉 개발자 포털 → Bot → Privileged Gateway Intents 에서 SERVER MEMBERS INTENT · MESSAGE CONTENT INTENT 를 켜고 Save`,
    }
  }
}

async function resolveChannel(ctx, ref, gid) {
  if (!ref) fail('채널을 정해 주세요 (key · 이름 일부 · ID) — ids 로 목록을 보세요')
  const mention = String(ref).match(/^<#(\d+)>$/)
  if (mention) return mention[1]
  if (/^\d{15,}$/.test(ref)) return ref
  if (ctx.state.channels?.[ref]) return ctx.state.channels[ref]
  const channels = await ctx.req('GET', `/guilds/${gid}/channels`)
  const exact = channels.filter((c) => c.type !== TYPES.category && c.name === ref)
  const hits = exact.length ? exact : channels.filter((c) => c.type !== TYPES.category && c.name.includes(ref))
  if (hits.length === 1) return hits[0].id
  fail(hits.length
    ? `'${ref}' 에 맞는 채널이 여럿이에요: ${hits.map((c) => c.name).join(', ')}`
    : `'${ref}' 채널을 못 찾았어요 — ids 로 목록을 보세요`)
}

async function resolveMember(ctx, ref, gid) {
  if (!ref) fail('멤버를 정해 주세요 (ID · <@멘션> · 이름)')
  const id = String(ref).match(/^<@!?(\d+)>$/) ?? String(ref).match(/^(\d{15,})$/)
  if (id) return id[1]
  const q = String(ref).replace(/^@/, '')
  const hits = await ctx.req('GET', `/guilds/${gid}/members/search`, undefined, { query: { query: q, limit: '10' } })
  const exact = hits.filter((x) => [x.user.username, x.user.global_name, x.nick].includes(q))
  const pick = exact.length === 1 ? exact : hits
  if (pick.length === 1) return pick[0].user.id
  fail(pick.length
    ? `'${q}' 에 맞는 멤버가 여럿이에요: ${pick.map((x) => `${displayName(x)} (@${x.user.username} · ${x.user.id})`).join(', ')}`
    : `'${q}' 멤버를 못 찾았어요 — members 로 목록을 보세요`)
}

function findTag(forum, name) {
  const tags = forum.available_tags ?? []
  const clean = String(name).replace(/^[+-]/, '').trim()
  const exact = tags.find((t) => t.name === clean || `${t.emoji_name ?? ''}${t.name}` === clean)
  if (exact) return exact
  const part = tags.filter((t) => t.name.includes(clean))
  if (part.length === 1) return part[0]
  fail(`'${forum.name}' 에 '${clean}' 태그가 ${part.length ? '여럿이에요' : '없어요'} — 있는 태그: ${tags.map((t) => t.name).join(', ')}`)
}

function readText(arg) {
  if (arg === undefined || arg === '') fail('보낼 글이 없어요 (글 · @파일 · - 표준입력)')
  if (arg === '-') return readFileSync(0, 'utf8')
  if (arg.startsWith('@') && existsSync(arg.slice(1))) return readFileSync(arg.slice(1), 'utf8')
  return arg
}

// 2000자 제한 — 빈 줄 > 줄바꿈 > 글자 순으로 자른다
export function splitMessage(text, max = 2000) {
  const out = []
  let rest = text.trim()
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max)
    if (cut < max / 2) cut = rest.lastIndexOf('\n', max)
    if (cut < max / 2) cut = max
    out.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest) out.push(rest)
  return out
}

// ---------- setup ----------
const tagBody = (t) => ({ name: t.name, moderated: !!t.staffOnly, ...(t.emoji ? { emoji_name: t.emoji } : {}) })

async function syncOverwrites(ctx, ch, want) {
  let changed = 0
  for (const o of want) {
    const cur = (ch.permission_overwrites ?? []).find((x) => x.id === o.id)
    if (cur && cur.allow === o.allow && cur.deny === o.deny) continue
    await ctx.req('PUT', `/channels/${ch.id}/permissions/${o.id}`, { type: 0, allow: o.allow, deny: o.deny })
    changed++
  }
  if (changed) log(`  ~ 접근 규칙: ${ch.name} (${changed})`)
}

async function ensureChannel(ctx, g, spec, parentId, overwrites, bucket, stats) {
  const type = TYPES[spec.type]
  const known = ctx.state[bucket]?.[spec.key]
  let ch = g.channels.find((c) => c.id === known)
    ?? g.channels.find((c) => c.name === spec.name && c.type === type && (c.parent_id ?? null) === (parentId ?? null))
  if (!ch) {
    const body = { name: spec.name, type, permission_overwrites: overwrites }
    if (parentId) body.parent_id = parentId
    if (spec.topic && ![TYPES.voice, TYPES.stage].includes(type)) body.topic = spec.topic
    if (spec.slowmode) body.rate_limit_per_user = spec.slowmode
    if (type === TYPES.forum) {
      Object.assign(body, {
        available_tags: (spec.tags ?? []).map(tagBody),
        default_reaction_emoji: spec.reaction ? { emoji_id: null, emoji_name: spec.reaction } : null,
        default_sort_order: spec.sort === 'created' ? 1 : 0,
        default_forum_layout: spec.layout === 'gallery' ? 2 : 1,
        default_auto_archive_duration: 10080,
      })
    }
    ch = await ctx.req('POST', `/guilds/${g.gid}/channels`, body)
    g.channels.push(ch)
    stats.created++
    log(`  + ${TYPE_NAMES[type]} ${spec.name}`)
  } else {
    await syncOverwrites(ctx, ch, overwrites)
    const patch = {}
    if (spec.topic && ![TYPES.voice, TYPES.stage].includes(type) && (ch.topic ?? '') !== spec.topic) patch.topic = spec.topic
    if (spec.slowmode !== undefined && (ch.rate_limit_per_user ?? 0) !== spec.slowmode) patch.rate_limit_per_user = spec.slowmode
    if (type === TYPES.forum && spec.tags) {
      const have = ch.available_tags ?? []
      const missing = spec.tags.filter((t) => !have.some((h) => h.name === t.name))
      if (missing.length) patch.available_tags = [...have, ...missing.map(tagBody)]
    }
    if (Object.keys(patch).length) {
      await ctx.req('PATCH', `/channels/${ch.id}`, patch)
      log(`  ~ ${spec.name} (${Object.keys(patch).join(', ')})`)
    }
  }
  ;(ctx.state[bucket] ??= {})[spec.key] = ch.id
  return ch
}

async function loadGuild(ctx) {
  const app = await ctx.req('GET', '/applications/@me')
  const me = await ctx.req('GET', '/users/@me')
  const pick = await pickGuild(ctx)
  if (!pick) fail(await notInGuildMessage(ctx))
  ctx.state.app_id = app.id
  ctx.state.guild_id = pick.id
  const gid = pick.id
  const [guild, roles, channels] = await Promise.all([
    ctx.req('GET', `/guilds/${gid}`), ctx.req('GET', `/guilds/${gid}/roles`), ctx.req('GET', `/guilds/${gid}/channels`),
  ])
  return { app, me, gid, guild, roles, channels, perms: BigInt(pick.permissions ?? 0) }
}

// 커뮤니티 = 공지·스테이지 채널·환영 화면의 전제. 규칙·안내 채널 + 인증 ≥1 + 콘텐츠 필터 '모든 멤버' 가 한 번에 가야 한다
async function ensureCommunity(ctx, g, s) {
  if (!s.server.community || g.guild.features.includes('COMMUNITY')) return
  const S = s.server
  const body = {
    features: [...new Set([...g.guild.features, 'COMMUNITY'])],
    verification_level: Math.max(g.guild.verification_level ?? 0, 1),
    explicit_content_filter: 2,
    rules_channel_id: ctx.state.channels[S.rulesChannel],
    public_updates_channel_id: ctx.state.channels[S.updatesChannel],
    ...(S.locale ? { preferred_locale: S.locale } : {}),
    ...(S.description !== undefined ? { description: S.description } : {}),
    ...(S.notifications ? { default_message_notifications: S.notifications === 'all' ? 0 : 1 } : {}),
  }
  try {
    await ctx.req('PATCH', `/guilds/${g.gid}`, body)
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 400) throw e
    // 기존 features 에 바꿀 수 없는 값이 섞여 거절됐을 수 있다 — COMMUNITY 만 보내 본다
    await ctx.req('PATCH', `/guilds/${g.gid}`, { ...body, features: ['COMMUNITY'] })
  }
  Object.assign(g.guild, body)
  log('  + 커뮤니티 기능 (공지 채널·환영 화면)')
}

async function finishGuild(ctx, g, s) {
  const S = s.server
  const ch = (k) => ctx.state.channels[k]
  const want = {}
  if (S.systemChannel) want.system_channel_id = ch(S.systemChannel)
  if (S.systemChannelFlags !== undefined) want.system_channel_flags = S.systemChannelFlags
  if (S.notifications) want.default_message_notifications = S.notifications === 'all' ? 0 : 1
  if (g.guild.features.includes('COMMUNITY')) {
    if (S.rulesChannel) want.rules_channel_id = ch(S.rulesChannel)
    if (S.updatesChannel) want.public_updates_channel_id = ch(S.updatesChannel)
    if (S.safetyChannel) want.safety_alerts_channel_id = ch(S.safetyChannel)
    if (S.description !== undefined) want.description = S.description
    if (S.locale) want.preferred_locale = S.locale
  }
  const patch = Object.fromEntries(Object.entries(want).filter(([k, v]) => (g.guild[k] ?? null) !== v))
  if (!Object.keys(patch).length) return
  await ctx.req('PATCH', `/guilds/${g.gid}`, patch)
  Object.assign(g.guild, patch)
  log(`  ~ 서버 설정 (${Object.keys(patch).join(', ')})`)
}

// 환영 화면은 있으면 좋은 것 — 실패해도 setup 을 멈추지 않는다.
// 역할로 가린 채널을 디스코드가 거절하면 모두가 보는 채널만으로 다시 건다
async function syncWelcomeScreen(ctx, g, s) {
  const W = s.welcomeScreen
  if (!W || !g.guild.features.includes('COMMUNITY')) return
  const open = new Set()
  for (const cat of s.categories) {
    for (const ch of cat.channels) {
      const rules = accessRules(s, cat, ch)
      if (!rules.some(([t, r]) => t === '@everyone' && (r.deny ?? []).includes('VIEW_CHANNEL'))) open.add(ch.key)
    }
  }
  const body = (items) => ({
    enabled: true,
    description: W.description ?? null,
    welcome_channels: items.map((w) => ({
      channel_id: ctx.state.channels[w.channel], description: w.description ?? '', emoji_id: null, emoji_name: w.emoji ?? null,
    })),
  })
  const full = body(W.channels ?? [])
  const fallback = body((W.channels ?? []).filter((w) => open.has(w.channel)))
  const shape = (list) => JSON.stringify((list ?? []).map((c) => [c.channel_id, c.description, c.emoji_name]))
  const cur = await ctx.req('GET', `/guilds/${g.gid}/welcome-screen`).catch(() => null)
  // 켜짐 여부는 응답이 아니라 서버 기능 목록(WELCOME_SCREEN_ENABLED)에 있다
  if (cur && (cur.description ?? null) === full.description && g.guild.features.includes('WELCOME_SCREEN_ENABLED')
    && [full, fallback].some((b) => shape(b.welcome_channels) === shape(cur.welcome_channels))) return
  try {
    await ctx.req('PATCH', `/guilds/${g.gid}/welcome-screen`, full)
    log('  ~ 환영 화면')
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 400) return log(`⚠️  환영 화면 건너뜀: ${e.message}`)
    try {
      await ctx.req('PATCH', `/guilds/${g.gid}/welcome-screen`, fallback)
      log('  ~ 환영 화면 (모두가 보는 채널만 — 디스코드가 가린 채널을 거절)')
    } catch (e2) {
      log(`⚠️  환영 화면 건너뜀: ${e2.message}`)
    }
  }
}

// 봇이 관리하는 고정 글: 내용이 바뀌면 같은 메시지를 고치고, 지워졌거나 조각 수가 바뀌면 다시 올린다
async function syncMessages(ctx, s) {
  ctx.state.messages ??= {}
  for (const m of s.messages) {
    const chId = ctx.state.channels[m.channel]
    const chunks = splitMessage(renderContent(readFileSync(join(ctx.dir, m.file), 'utf8'), s, ctx.state))
    const prev = ctx.state.messages[m.key]
    const ids = prev?.channel === chId ? [...prev.ids] : []
    const current = []
    for (const id of ids) {
      try {
        current.push(await ctx.req('GET', `/channels/${chId}/messages/${id}`))
      } catch (e) {
        if (e.status === 404) current.push(null)
        else throw e
      }
    }
    if (current.length === chunks.length && current.every(Boolean)) {
      for (let i = 0; i < chunks.length; i++) {
        if (current[i].content === chunks[i]) continue
        await ctx.req('PATCH', `/channels/${chId}/messages/${ids[i]}`, { content: chunks[i], allowed_mentions: { parse: [] } })
        log(`  ~ 고정 글 수정: ${m.key}`)
      }
    } else {
      for (const [i, msg] of current.entries()) if (msg) await ctx.req('DELETE', `/channels/${chId}/messages/${ids[i]}`)
      ids.length = 0
      for (const c of chunks) {
        const sent = await ctx.req('POST', `/channels/${chId}/messages`, {
          content: c, allowed_mentions: { parse: [] }, ...(m.embeds ? {} : { flags: SUPPRESS_EMBEDS }),
        })
        ids.push(sent.id)
      }
      if (m.pin) for (const id of ids) await ctx.req('PUT', `/channels/${chId}/messages/pins/${id}`)
      log(`  + 고정 글 게시: ${m.key}`)
    }
    ctx.state.messages[m.key] = { channel: chId, ids }
  }
}

async function giveOwnerRoles(ctx, g, s) {
  const owner = g.guild.owner_id
  const keys = Object.entries(s.roles).filter(([, r]) => r.giveOwner).map(([k]) => k)
  if (!owner || !keys.length) return
  const member = await ctx.req('GET', `/guilds/${g.gid}/members/${owner}`)
  for (const k of keys) {
    if (member.roles.includes(ctx.state.roles[k])) continue
    await ctx.req('PUT', `/guilds/${g.gid}/members/${owner}/roles/${ctx.state.roles[k]}`)
    log(`  + 서버 소유자에게 ${s.roles[k].name}`)
  }
}

async function sortChannels(ctx, g, s) {
  const order = []
  let ci = 0
  for (const cat of s.categories) {
    if (cat.name !== null) order.push({ id: ctx.state.categories[cat.key], position: ci++ })
    cat.channels.forEach((ch, i) => order.push({ id: ctx.state.channels[ch.key], position: i }))
  }
  const specCats = new Set(Object.values(ctx.state.categories ?? {}))
  g.channels
    .filter((c) => c.type === TYPES.category && !specCats.has(c.id))
    .forEach((c, i) => order.push({ id: c.id, position: ci + i }))
  await ctx.req('PATCH', `/guilds/${g.gid}/channels`, order)
}

// 봇은 자기 최상위 역할보다 아래 역할만 부여할 수 있다 — 초대 링크의 역할 자동 부여도 같다.
// 디스코드 위계: position 이 크면 위, 같으면 먼저 만든(ID 가 작은) 역할이 위. 새 역할은 맨 아래 순번(1)으로
// 생기고 다른 역할을 밀어 올리지 않아서 봇 역할과 순번이 같아지는 게 보통이다 — 그래도 봇이 먼저 들어왔으면 봇이 위다 (실측)
export const roleAbove = (a, b) => a.position > b.position || (a.position === b.position && BigInt(a.id) < BigInt(b.id))
async function botRoleProblems(ctx, gid, meId, roleIds) {
  const roles = await ctx.req('GET', `/guilds/${gid}/roles`)
  const me = await ctx.req('GET', `/guilds/${gid}/members/${meId}`)
  const mine = roles.filter((r) => me.roles.includes(r.id))
  if (!mine.length) return roleIds.filter(([, id]) => id).map(([name]) => name)
  const top = mine.reduce((a, b) => (roleAbove(a, b) ? a : b))
  return roleIds
    .filter(([, id]) => {
      const r = roles.find((x) => x.id === id)
      return r && !roleAbove(top, r)
    })
    .map(([name]) => name)
}

async function cmdSetup(ctx) {
  ctx.setReason('setup')
  const s = ctx.spec()
  const { errors, warnings } = validate(s, ctx.dir)
  for (const w of warnings) log(`⚠️  ${w}`)
  if (errors.length) fail(`server.json 에 고칠 곳이 ${errors.length}개 있어요:\n${errors.map((e) => `   - ${e}`).join('\n')}`)
  const g = await loadGuild(ctx)
  if ((g.perms & ADMIN) !== ADMIN) fail(`봇에 관리자 권한이 없어요 — 이 링크로 다시 승인해 주세요 (Administrator 체크된 링크):\n   ${installUrl(g.app.id)}`)
  const stats = { created: 0 }
  log(`서버 ${g.guild.name} (${g.gid})${ctx.dry ? '  [dry-run — 아무것도 바꾸지 않아요]' : ''}`)

  // 1) 앱: 특권 인텐트 + 봇 소개
  const intents = await ensureIntents(ctx, g.app)
  if (s.bot?.description && g.app.description !== s.bot.description) {
    await ctx.req('PATCH', '/applications/@me', { description: s.bot.description })
  }

  // 2) @everyone 기본 권한
  const base = everyonePerms(s)
  const everyone = g.roles.find((r) => r.id === g.gid)
  if (base !== null && BigInt(everyone.permissions) !== base) {
    await ctx.req('PATCH', `/guilds/${g.gid}/roles/${g.gid}`, { permissions: String(base) })
    log('  ~ @everyone 기본 권한')
  }

  // 3) 역할 — 봇이 만든 역할은 봇 역할 아래에 생긴다 (그래서 봇이 부여할 수 있다)
  ctx.state.roles ??= {}
  for (const [key, r] of Object.entries(s.roles)) {
    let role = g.roles.find((x) => x.id === ctx.state.roles[key]) ?? g.roles.find((x) => x.name === r.name)
    if (!role) {
      role = await ctx.req('POST', `/guilds/${g.gid}/roles`, {
        name: r.name, permissions: String(rolePerms(r)), colors: { primary_color: colorInt(r.color) },
        hoist: r.hoist, mentionable: r.mentionable,
      })
      g.roles.push(role)
      stats.created++
      log(`  + 역할 ${r.name}`)
    }
    ctx.state.roles[key] = role.id
  }
  const ids = { everyone: g.gid, roles: ctx.state.roles }

  // 4) 카테고리 → 커뮤니티 필수 채널(규칙·안내) → 커뮤니티 → 나머지 채널 (공지 채널은 커뮤니티 서버에서만 생긴다)
  ctx.state.categories ??= {}
  ctx.state.channels ??= {}
  const parents = {}
  for (const cat of s.categories) {
    if (cat.name === null) continue
    const ch = await ensureChannel(ctx, g, { key: cat.key, name: cat.name, type: 'category' }, null,
      buildOverwrites(accessRules(s, cat), ids), 'categories', stats)
    parents[cat.key] = ch.id
  }
  const first = new Set(s.server.community ? [s.server.rulesChannel, s.server.updatesChannel] : [])
  const place = async (pick) => {
    for (const cat of s.categories) {
      for (const ch of cat.channels.filter(pick)) {
        await ensureChannel(ctx, g, ch, parents[cat.key] ?? null, buildOverwrites(accessRules(s, cat, ch), ids), 'channels', stats)
      }
    }
  }
  await place((ch) => first.has(ch.key))
  await ensureCommunity(ctx, g, s)
  await place((ch) => !first.has(ch.key))

  // 5) 서버 설정 · 고정 글 · 소유자 역할 · 순서 · 환영 화면(실패해도 계속) · 점검
  await finishGuild(ctx, g, s)
  await syncMessages(ctx, s)
  await giveOwnerRoles(ctx, g, s)
  if (stats.created) await sortChannels(ctx, g, s)
  await syncWelcomeScreen(ctx, g, s)
  if (!g.guild.features.includes('COMMUNITY') && !s.server.community) {
    // 커뮤니티가 아니면 공지 채널 등은 검사에서 이미 막혔다
  } else if (!s.server.community && g.guild.features.includes('COMMUNITY')) {
    log('ℹ️  서버는 커뮤니티 서버인데 server.community 가 false 예요 — 끄지는 않아요')
  }
  if (!ctx.dry) {
    const low = await botRoleProblems(ctx, g.gid, g.me.id, Object.entries(s.roles).map(([k, r]) => [r.name, ctx.state.roles[k]]))
    if (low.length) log(`⚠️  봇 역할이 ${low.join(', ')} 보다 아래예요 — 서버 설정 → 역할에서 '${g.me.username}' 역할을 맨 위로 끌어 올려 주세요 (안 그러면 역할 부여·초대 링크 역할이 실패해요)`)
  }

  const keep = new Set([...Object.values(ctx.state.channels), ...Object.values(ctx.state.categories)])
  const extra = g.channels.filter((c) => !keep.has(c.id) && ![10, 11, 12].includes(c.type))
  log(`\n✅ setup ${ctx.dry ? '(dry-run) ' : ''}끝 — 새로 만든 것 ${stats.created}개 · 특권 인텐트 ${intents.text}`)
  if (!ctx.dry) {
    const landing = ctx.state.channels[s.invite.channel] ?? Object.values(ctx.state.channels)[0]
    if (landing) log(`   ${link(g.gid, landing)}`)
  }
  if (extra.length) log(`   server.json 에 없는 채널 ${extra.length}개 (${extra.map((c) => c.name).join(', ')}) — 새 서버의 기본 채널이면: prune`)
}

// 스펙 밖 채널 정리. 지우는 건 '서버와 같이 생긴 기본 채널 + 사람 메시지 0' 뿐 — 나중에 만든 채널은 절대 안 지운다
async function cmdPrune(ctx, _args, opts) {
  ctx.setReason('prune')
  const gid = await ensureGuild(ctx)
  const keep = new Set([...Object.values(ctx.state.channels ?? {}), ...Object.values(ctx.state.categories ?? {})])
  if (!keep.size) fail('setup 을 먼저 돌려 주세요 (지킬 채널 목록이 비어 있어요)')
  const channels = await ctx.req('GET', `/guilds/${gid}/channels`)
  const extra = channels.filter((c) => !keep.has(c.id))
  if (!extra.length) return log('server.json 에 없는 채널이 없어요.')
  const born = snowTime(gid)
  const rows = []
  for (const c of extra) {
    const isDefault = snowTime(c.id) - born < 10 * 60 * 1000
    let human = 0
    if ([TYPES.text, TYPES.voice, TYPES.announcement].includes(c.type)) {
      const msgs = await ctx.req('GET', `/channels/${c.id}/messages`, undefined, { query: { limit: '50' } })
      human = msgs.filter((m) => !m.author?.bot && SHOWN.includes(m.type)).length
    }
    rows.push({ c, isDefault, human })
  }
  for (const r of rows.filter((x) => x.c.type === TYPES.category)) {
    r.blocked = channels.filter((x) => x.parent_id === r.c.id).some((k) => {
      const row = rows.find((y) => y.c.id === k.id)
      return !row || !(row.isDefault && row.human === 0)
    })
  }
  const deletable = (r) => r.isDefault && r.human === 0 && !r.blocked
  for (const r of rows) {
    const why = `${r.isDefault ? '서버 기본' : '나중에 만든 것'} · 사람 메시지 ${r.human}${r.blocked ? ' · 안에 남는 채널' : ''}`
    log(`${deletable(r) ? '🗑️ ' : '·  '} ${TYPE_NAMES[r.c.type] ?? r.c.type} ${r.c.name} (${r.c.id}) — ${why}${deletable(r) ? '' : ' → 남김'}`)
  }
  const targets = rows.filter(deletable).sort((a, b) => (a.c.type === TYPES.category) - (b.c.type === TYPES.category))
  if (!opts.yes) {
    log(targets.length ? `\n지울 것 ${targets.length}개 — 지우려면: prune --yes` : '\n지울 것 없음 (서버 기본 채널 + 사람 메시지 0 인 것만 지워요)')
    return
  }
  for (const r of targets) {
    await ctx.req('DELETE', `/channels/${r.c.id}`)
    log(`  - ${r.c.name}`)
  }
}

// 이미 있는 서버를 server.json 으로 가져온다 — 이후 setup 은 바뀐 것만 맞춘다 (처음 돌리면 쓰기 0번)
async function cmdAdopt(ctx, _args, opts) {
  const file = join(ctx.dir, 'server.json')
  if (existsSync(file) && !opts.force) fail(`이미 ${file} 이 있어요 — 덮어쓰려면 --force (기존 파일은 server.json.bak 으로 남겨요)`)
  const g = await loadGuild(ctx)
  const warnings = []
  const keyer = () => {
    const used = new Set()
    return (name, fallback) => {
      let base = String(name ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40)
      if (!base) base = fallback
      let k = base
      for (let i = 2; used.has(k); i++) k = `${base}-${i}`
      used.add(k)
      return k
    }
  }
  const roleKey = keyer()
  const chKey = keyer()
  const state = { guild_id: g.gid, app_id: g.app.id, roles: {}, categories: {}, channels: {} }
  const roles = {}
  const keyOfRole = new Map()
  const STAFF_BITS = ['ADMINISTRATOR', 'MANAGE_GUILD', 'MANAGE_CHANNELS', 'MANAGE_MESSAGES', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MODERATE_MEMBERS']
  for (const r of [...g.roles].sort((a, b) => b.position - a.position)) {
    if (r.id === g.gid || r.managed) continue
    const k = roleKey(r.name, 'role')
    keyOfRole.set(r.id, k)
    state.roles[k] = r.id
    const names = permNames(r.permissions)
    const color = r.colors?.primary_color ?? r.color ?? 0
    roles[k] = {
      name: r.name, ...(color ? { color: `#${color.toString(16).padStart(6, '0')}` } : {}),
      hoist: !!r.hoist, mentionable: !!r.mentionable, permissions: names,
      ...(names.some((n) => STAFF_BITS.includes(n)) ? { staff: true } : {}),
    }
  }
  const target = (id) => (id === g.gid ? '@everyone' : keyOfRole.get(id))
  const permsOf = (ows, where) => {
    const o = {}
    for (const w of ows ?? []) {
      if (w.type !== 0) {
        warnings.push(`${where}: 멤버 한 명에게 건 권한은 가져오지 않았어요 (그대로 남아요)`)
        continue
      }
      const t = target(w.id)
      if (!t) continue
      const allow = permNames(w.allow)
      const deny = permNames(w.deny)
      if (allow.length || deny.length) o[t] = { ...(allow.length ? { allow } : {}), ...(deny.length ? { deny } : {}) }
    }
    return Object.keys(o).length ? o : undefined
  }
  const owKey = (ows) => JSON.stringify((ows ?? []).filter((w) => w.type === 0).map((w) => [w.id, w.allow, w.deny]).sort())
  const typeName = (t) => Object.entries(TYPES).find(([, v]) => v === t)?.[0]
  const toChannel = (c, parent) => {
    const type = typeName(c.type)
    if (!type || type === 'category') {
      warnings.push(`${c.name}: 지원하지 않는 채널 종류(${TYPE_NAMES[c.type] ?? c.type}) — 건너뜀`)
      return null
    }
    const k = chKey(c.name, 'channel')
    state.channels[k] = c.id
    const ch = { key: k, name: c.name, type }
    if (c.topic) ch.topic = c.topic
    if (c.rate_limit_per_user) ch.slowmode = c.rate_limit_per_user
    if (type === 'forum') {
      ch.tags = (c.available_tags ?? []).map((t) => ({ name: t.name, ...(t.emoji_name ? { emoji: t.emoji_name } : {}), ...(t.moderated ? { staffOnly: true } : {}) }))
      if (c.default_reaction_emoji?.emoji_name) ch.reaction = c.default_reaction_emoji.emoji_name
      ch.sort = c.default_sort_order === 1 ? 'created' : 'activity'
      ch.layout = c.default_forum_layout === 2 ? 'gallery' : 'list'
    }
    if (!(parent && owKey(c.permission_overwrites) === owKey(parent.permission_overwrites))) {
      ch.inherit = false
      const p = permsOf(c.permission_overwrites, c.name)
      if (p) ch.permissions = p
    }
    return ch
  }
  const categories = []
  const kids = (pid) => g.channels.filter((c) => (c.parent_id ?? null) === pid && c.type !== TYPES.category && ![10, 11, 12].includes(c.type))
  const top = kids(null).sort(byPos).map((c) => toChannel(c, null)).filter(Boolean)
  if (top.length) categories.push({ key: chKey('top', 'top'), name: null, channels: top })
  for (const cat of g.channels.filter((c) => c.type === TYPES.category).sort(byPos)) {
    const k = chKey(cat.name, 'category')
    state.categories[k] = cat.id
    const entry = { key: k, name: cat.name }
    const p = permsOf(cat.permission_overwrites, cat.name)
    if (p) entry.permissions = p
    entry.channels = kids(cat.id).sort(byPos).map((c) => toChannel(c, cat)).filter(Boolean)
    categories.push(entry)
  }
  const keyOfChannel = (id) => Object.entries(state.channels).find(([, v]) => v === id)?.[0]
  const gd = g.guild
  const community = gd.features.includes('COMMUNITY')
  const everyone = g.roles.find((r) => r.id === g.gid)
  const server = {
    name: gd.name,
    community,
    everyone: permNames(everyone.permissions),
    notifications: gd.default_message_notifications === 0 ? 'all' : 'mentions',
    systemChannelFlags: gd.system_channel_flags ?? 0,
    ...(gd.system_channel_id && keyOfChannel(gd.system_channel_id) ? { systemChannel: keyOfChannel(gd.system_channel_id) } : {}),
  }
  if (community) {
    for (const [field, id] of [['rulesChannel', gd.rules_channel_id], ['updatesChannel', gd.public_updates_channel_id], ['safetyChannel', gd.safety_alerts_channel_id]]) {
      if (id && keyOfChannel(id)) server[field] = keyOfChannel(id)
    }
    if (gd.description) server.description = gd.description
    if (gd.preferred_locale) server.locale = gd.preferred_locale
  }
  const spec = { version: 1, server, vars: {}, roles, categories, messages: [] }
  if (community) {
    const ws = await ctx.req('GET', `/guilds/${g.gid}/welcome-screen`).catch(() => null)
    const chans = (ws?.welcome_channels ?? []).filter((w) => keyOfChannel(w.channel_id))
    if (ws && (ws.description || chans.length)) {
      spec.welcomeScreen = {
        ...(ws.description ? { description: ws.description } : {}),
        channels: chans.map((w) => ({ channel: keyOfChannel(w.channel_id), ...(w.emoji_name ? { emoji: w.emoji_name } : {}), ...(w.description ? { description: w.description } : {}) })),
      }
    }
  }
  const firstText = allChannels(spec).find((c) => c.type === 'text')?.key
  spec.invite = { channel: server.rulesChannel ?? firstText, roles: [], maxUses: 1, days: 7 }
  if (!spec.invite.channel) delete spec.invite.channel
  const v = validate(normalize(spec), ctx.dir)
  if (v.errors.length) fail(`가져온 구조가 검사를 통과하지 못했어요 (도구의 빈틈 — 이슈로 알려 주세요):\n${v.errors.map((e) => `   - ${e}`).join('\n')}`)
  mkdirSync(join(ctx.dir, 'content'), { recursive: true, mode: 0o700 })
  if (existsSync(file)) renameSync(file, `${file}.bak`)
  writeJson(file, spec)
  ensureGitignore(ctx.dir)
  ctx.state = { ...ctx.state, ...state }
  for (const w of [...new Set(warnings)]) log(`⚠️  ${w}`)
  log(`✅ 가져옴 → ${file}\n   역할 ${Object.keys(roles).length} · 카테고리 ${Object.keys(state.categories).length} · 채널 ${Object.keys(state.channels).length}`)
  log('   이제 server.json 을 고치고 setup 하면 바뀐 것만 반영돼요 (지금 setup 하면 아무것도 안 바뀌어야 정상).')
}

async function cmdIds(ctx) {
  const gid = await ensureGuild(ctx)
  const [roles, channels] = await Promise.all([ctx.req('GET', `/guilds/${gid}/roles`), ctx.req('GET', `/guilds/${gid}/channels`)])
  const keyById = new Map()
  for (const bucket of ['roles', 'categories', 'channels']) {
    for (const [k, v] of Object.entries(ctx.state[bucket] ?? {})) keyById.set(v, k)
  }
  const keyOf = (id) => keyById.get(id) ?? ''
  log(`서버 ${gid} (프로필 ${ctx.name})\n\n역할 (위가 높음)`)
  for (const r of [...roles].sort((a, b) => b.position - a.position)) log(`  ${keyOf(r.id).padEnd(12)} ${r.name}  ${r.id}`)
  log('\n채널 (key · 종류 · 이름 · id)')
  const line = (c, indent) => {
    log(`${indent}${keyOf(c.id).padEnd(12)} ${TYPE_NAMES[c.type] ?? c.type} ${c.name}  ${c.id}`)
    if (c.type === TYPES.forum) {
      log(`${indent}             태그: ${(c.available_tags ?? []).map((t) => `${t.emoji_name ?? ''}${t.name}${t.moderated ? '*' : ''}`).join(' · ') || '없음'}`)
    }
  }
  for (const c of channels.filter((x) => x.type !== TYPES.category && !x.parent_id).sort(byPos)) line(c, '  ')
  for (const cat of channels.filter((x) => x.type === TYPES.category).sort(byPos)) {
    line(cat, '  ')
    for (const c of channels.filter((x) => x.parent_id === cat.id).sort(byPos)) line(c, '    ')
  }
  log('\n(* = 운영진만 붙이는 상태 태그)')
}

// ---------- 시작 ----------
function templatesList() {
  const root = join(SKILL_DIR, 'templates')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) =>
    readdirSync(join(root, d.name), { withFileTypes: true }).filter((l) => l.isDirectory()).map((l) => `${d.name}/${l.name}`))
}

async function cmdInit(ctx, _args, opts) {
  const tpl = opts.template ?? 'closed-beta'
  const lang = opts.lang ?? 'ko'
  const src = join(SKILL_DIR, 'templates', tpl, lang)
  if (!existsSync(src)) fail(`템플릿 '${tpl}/${lang}' 이 없어요 — 있는 것: ${templatesList().join(', ')}`)
  const file = join(ctx.dir, 'server.json')
  if (existsSync(file) && !opts.force) fail(`이미 ${file} 이 있어요 — 덮어쓰려면 --force (기존 파일은 server.json.bak 으로 남겨요)`)
  mkdirSync(ctx.dir, { recursive: true, mode: 0o700 })
  if (existsSync(file)) renameSync(file, `${file}.bak`)
  cpSync(src, ctx.dir, { recursive: true, force: true })
  const spec = JSON.parse(readFileSync(file, 'utf8'))
  if (opts.name) spec.server.name = String(opts.name)
  writeJson(file, spec)
  ensureGitignore(ctx.dir)
  const v = validate(readSpec(ctx.dir), ctx.dir)
  log(`✅ 프로필 '${ctx.name}' 만듦 (템플릿 ${tpl}/${lang}) → ${ctx.dir}`)
  log('   server.json = 서버 설계도 · content/ = 고정 글 · NOTES.md = 이 서버 운영 메모')
  for (const w of v.warnings) log(`⚠️  ${w}`)
  log(`\n다음:\n  - 서버 이름·채널·문구를 바꾸려면 server.json · content/*.md 를 고치고 validate\n${readToken(ctx.dir) ? '  - token 이미 있음 → setup --dry 로 미리 보고 setup' : '  - ' + HUMAN_STEPS.replace(/\n/g, '\n    ')}`)
}

async function cmdToken(ctx, _args, opts) {
  let raw
  let fromClipboard = false
  if (opts.stdin) raw = readFileSync(0, 'utf8')
  else if (opts.file) {
    if (!existsSync(opts.file)) fail(`파일이 없어요: ${opts.file}`)
    raw = readFileSync(opts.file, 'utf8')
  } else if (opts.prompt) raw = await promptHidden('봇 토큰을 붙여넣고 Enter (화면에 안 보여요): ').catch((e) => fail(e.message))
  else {
    const c = readClipboard()
    if (!c.ok) fail(c.message)
    raw = c.text
    fromClipboard = true
  }
  raw = String(raw).trim()
  if (!looksLikeBotToken(raw)) {
    fail(`${fromClipboard ? '클립보드에' : '받은 값에'} 봇 토큰이 없어요\n   👉 개발자 포털 → Bot → Reset Token → Copy 를 누른 직후에 다시 실행하세요. (다른 걸 복사하면 덮여요 · 토큰은 채팅에 붙이지 마세요)`)
  }
  const api = createApi({ userAgent: USER_AGENT, getToken: () => raw })
  let me
  let app
  try {
    me = await api.req('GET', '/users/@me')
    app = await api.req('GET', '/applications/@me')
  } catch (e) {
    fail(e.status === 401 ? '디스코드가 이 토큰을 거절했어요 (401) — Reset Token 을 다시 누르고 Copy 한 뒤 바로 실행하세요' : e.message)
  }
  const file = writeToken(ctx.dir, raw)
  const cleared = fromClipboard && clearClipboard()
  log(`✅ 토큰 저장 → ${file} (권한 600) · 봇 ${me.username} (${me.id})${fromClipboard ? (cleared ? ' · 클립보드 비움' : ' · ⚠️ 클립보드를 직접 비워 주세요') : ''}`)
  if (opts.file) log(`   ${opts.file} 는 이제 지워도 돼요`)
  const intents = await ensureIntents({ req: api.req }, app)
  log(`   특권 인텐트: ${intents.text}`)
  const guilds = await api.req('GET', '/users/@me/guilds')
  if (!guilds.length) {
    log(`\n다음: 이 링크를 열어 내 서버를 고르고 승인하세요 (서버가 없으면 디스코드 앱 왼쪽 + 로 먼저 만들기)\n   ${installUrl(app.id)}`)
  } else {
    log(`\n봇이 들어가 있는 서버: ${guilds.map((x) => x.name).join(', ')} — 다음: setup --dry → setup`)
  }
}

async function cmdBotInvite(ctx) {
  const app = await ctx.req('GET', '/applications/@me')
  log(installUrl(app.id))
}

async function cmdWhoami(ctx) {
  const me = await ctx.req('GET', '/users/@me')
  const app = await ctx.req('GET', '/applications/@me')
  ctx.state.app_id = app.id
  log(`봇 ${me.username} (${me.id}) · 앱 ${app.name} (${app.id}) · 프로필 ${ctx.name}`)
  log(`특권 인텐트: ${(await ensureIntents(ctx, app)).text}`)
  const g = await pickGuild(ctx)
  if (!g) return log(`\n${await notInGuildMessage(ctx)}`)
  ctx.state.guild_id = g.id
  const admin = (BigInt(g.permissions ?? 0) & ADMIN) === ADMIN
  log(`서버 ${g.name} (${g.id}) · 관리자 권한 ${admin ? '있음' : `없음 — 이 링크로 다시 승인해 주세요:\n   ${installUrl(app.id)}`}`)
}

async function cmdProfiles(ctx) {
  const list = listProfiles(ctx.home)
  if (!list.length) return log(`프로필이 없어요 (${ctx.home}) — init 으로 만드세요`)
  for (const p of list) {
    const dir = join(ctx.home, p)
    const name = loadJson(join(dir, 'server.json'), {})?.server?.name ?? '(server.json 없음)'
    const st = loadJson(join(dir, 'state.json'), {})
    log(`${p.padEnd(16)} ${name}${st.guild_id ? ` · 서버 ${st.guild_id}` : ''}${readToken(dir) ? ' · 토큰 있음' : ' · 토큰 없음'}`)
  }
}

async function cmdValidate(ctx) {
  const { errors, warnings } = validate(ctx.spec(), ctx.dir)
  for (const w of warnings) log(`⚠️  ${w}`)
  for (const e of errors) log(`❌ ${e}`)
  if (errors.length) fail(`고칠 곳 ${errors.length}개`)
  log(`✅ server.json 통과 (${allChannels(ctx.spec()).length}개 채널 · 역할 ${Object.keys(ctx.spec().roles).length}개)`)
}

// 막힌 곳을 한 번에 찾고 '다음에 할 일' 을 순서대로 알려 준다. 고칠 수 있는 건(특권 인텐트) 바로 고친다
async function cmdDoctor(ctx) {
  const lines = []
  const next = []
  const ok = (m) => lines.push(`✅ ${m}`)
  const warn = (m) => lines.push(`⚠️  ${m}`)
  const bad = (m, fix) => {
    lines.push(`❌ ${m}`)
    if (fix) next.push(fix)
  }
  const finish = () => {
    log(lines.join('\n'))
    log(next.length ? `\n다음에 할 일\n${next.map((n, i) => `${i + 1}. ${n}`).join('\n')}` : '\n🎉 막힌 곳 없음')
  }
  const major = Number(process.versions.node.split('.')[0])
  if (major >= 18) ok(`Node ${process.versions.node}`)
  else bad(`Node ${process.versions.node} — 18 이상이 필요해요`, 'https://nodejs.org 에서 LTS 설치 (macOS: brew install node · Windows: winget install OpenJS.NodeJS.LTS)')
  if (ctx.existing.length > 1 && !ctx.opts.profile && !process.env.DISCORD_PROFILE) {
    warn(`프로필 여러 개 (${ctx.existing.join(', ')}) — 지금은 '${ctx.name}' 를 봐요. 다른 건 --profile <이름>`)
  }
  ok(`프로필 ${ctx.name} → ${ctx.dir}`)

  let spec = null
  if (!existsSync(join(ctx.dir, 'server.json'))) {
    bad('server.json 없음', 'init --template closed-beta|community|course --name "서버 이름"   (이미 있는 서버를 쓰려면 토큰 저장 뒤 adopt)')
  } else {
    try {
      spec = ctx.spec()
      const v = validate(spec, ctx.dir)
      for (const w of v.warnings) warn(w)
      if (v.errors.length) bad(`server.json 에 고칠 곳 ${v.errors.length}개:\n${v.errors.map((e) => `     - ${e}`).join('\n')}`, 'server.json 을 고치고 validate')
      else ok(`server.json (${allChannels(spec).length}개 채널)`)
    } catch (e) {
      bad(e.message, 'server.json 을 고치세요')
    }
  }

  try {
    const res = await fetch(`${API_BASE}/gateway`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    ok('discord.com 연결')
  } catch (e) {
    bad(`discord.com 에 연결이 안 돼요 (${e.cause?.code ?? e.message})`, HINT_NETWORK)
    return finish()
  }

  const tok = readToken(ctx.dir)
  if (!tok) {
    bad('봇 토큰 없음', HUMAN_STEPS)
    return finish()
  }
  if (!looksLikeBotToken(tok.value)) {
    bad(`저장된 토큰 모양이 이상해요 (${tok.source})`, 'Reset Token → Copy 후 token')
    return finish()
  }
  let me
  let app
  try {
    me = await ctx.req('GET', '/users/@me')
    app = await ctx.req('GET', '/applications/@me')
    ok(`봇 ${me.username} (토큰: ${tok.source})`)
  } catch (e) {
    bad(e.status === 401 ? '토큰이 거절됐어요 (재발급됐거나 틀림)' : e.message.split('\n')[0], 'Reset Token → Copy 후 token')
    return finish()
  }
  const intents = await ensureIntents(ctx, app)
  if (intents.ok) ok(`특권 인텐트 ${intents.text}`)
  else bad(`특권 인텐트 ${intents.text}`)

  let g
  try {
    g = await pickGuild(ctx)
  } catch (e) {
    bad(e.message)
    return finish()
  }
  if (!g) {
    bad('봇이 아직 서버에 없어요', `(서버가 없으면 디스코드 앱 왼쪽 + 로 만들고) 이 링크로 봇 초대: ${installUrl(app.id)}`)
    return finish()
  }
  ctx.state.guild_id = g.id
  ctx.state.app_id = app.id
  if ((BigInt(g.permissions ?? 0) & ADMIN) === ADMIN) ok(`서버 ${g.name} · 관리자 권한`)
  else bad(`서버 ${g.name} 에서 봇에 관리자 권한이 없어요`, `이 링크로 다시 승인 (Administrator 체크됨): ${installUrl(app.id)}`)
  const guild = await ctx.req('GET', `/guilds/${g.id}`)
  if (guild.mfa_level === 1) warn('서버가 관리 작업에 2단계 인증을 요구해요 — 봇을 만든 디스코드 계정에도 2단계 인증이 켜져 있어야 일부 작업(60003)이 돼요')

  if (spec) {
    const live = new Set((await ctx.req('GET', `/guilds/${g.id}/channels`)).map((c) => c.id))
    const roleIds = new Set((await ctx.req('GET', `/guilds/${g.id}/roles`)).map((r) => r.id))
    const missing = [
      ...Object.keys(spec.roles).filter((k) => !roleIds.has(ctx.state.roles?.[k])),
      ...spec.categories.filter((c) => c.name !== null && !live.has(ctx.state.categories?.[c.key])).map((c) => c.key),
      ...allChannels(spec).filter((c) => !live.has(ctx.state.channels?.[c.key])).map((c) => c.key),
    ]
    if (missing.length) bad(`아직 세팅 안 된 것 ${missing.length}개 (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''})`, 'setup --dry 로 미리 보고 setup')
    else {
      ok('서버 구조 = server.json')
      const low = await botRoleProblems(ctx, g.id, me.id, Object.entries(spec.roles).map(([k, r]) => [r.name, ctx.state.roles?.[k]]))
      if (low.length) bad(`봇 역할이 ${low.join(', ')} 보다 아래예요`, `서버 설정 → 역할에서 '${me.username}' 역할을 맨 위로 끌어 올리기`)
    }
  }
  finish()
}

// ---------- 게시 ----------
async function cmdPost(ctx, args, opts) {
  ctx.setReason('post')
  const gid = await ensureGuild(ctx)
  const [ref, ...rest] = args
  const chId = await resolveChannel(ctx, ref, gid)
  let text = readText(rest.join(' ')).trim()
  if (opts.ping) text = `@everyone\n${text}`
  const chunks = splitMessage(text)
  const flags = (opts.silent ? SUPPRESS_NOTIFICATIONS : 0) | (opts.noembed ? SUPPRESS_EMBEDS : 0)
  const sent = []
  for (const [i, c] of chunks.entries()) {
    const m = await ctx.req('POST', `/channels/${chId}/messages`, {
      content: c,
      allowed_mentions: { parse: opts.ping && i === 0 ? ['everyone'] : ['users'] },
      ...(flags ? { flags } : {}),
    })
    sent.push(m.id)
  }
  if (opts.pin) await ctx.req('PUT', `/channels/${chId}/messages/pins/${sent[0]}`)
  log(`게시 ${chunks.length}개${opts.pin ? ' · 고정' : ''} → ${link(gid, chId, sent[0])}  (메시지 ${sent.join(', ')})`)
}

async function cmdEdit(ctx, args) {
  ctx.setReason('edit')
  const gid = await ensureGuild(ctx)
  const [ref, msgId, ...rest] = args
  if (!msgId) fail('사용법: edit <채널> <메시지ID> <글|@파일>')
  const chId = await resolveChannel(ctx, ref, gid)
  const text = readText(rest.join(' ')).trim()
  if (text.length > 2000) fail('수정은 2000자까지예요 — 길면 지우고 post 로 다시 올려 주세요')
  await ctx.req('PATCH', `/channels/${chId}/messages/${msgId}`, { content: text, allowed_mentions: { parse: ['users'] } })
  log(`수정 → ${link(gid, chId, msgId)}`)
}

async function cmdForum(ctx, args, opts) {
  ctx.setReason('forum')
  const gid = await ensureGuild(ctx)
  const [ref, title, ...rest] = args
  if (!title) fail('사용법: forum <포럼> <제목> <글|@파일> [--tags 태그,태그]')
  const forumId = await resolveChannel(ctx, ref, gid)
  const forum = await ctx.req('GET', `/channels/${forumId}`)
  if (forum.type !== TYPES.forum) fail(`${forum.name} 은 포럼이 아니에요`)
  const tagIds = (opts.tags ? String(opts.tags).split(',') : []).filter(Boolean).map((n) => findTag(forum, n).id)
  if (tagIds.length > 5) fail('글 하나에 태그는 5개까지예요')
  const chunks = splitMessage(readText(rest.join(' ')).trim())
  const thread = await ctx.req('POST', `/channels/${forumId}/threads`, {
    name: title.slice(0, 100), applied_tags: tagIds, message: { content: chunks[0], allowed_mentions: { parse: ['users'] } },
  })
  for (const c of chunks.slice(1)) {
    await ctx.req('POST', `/channels/${thread.id}/messages`, { content: c, allowed_mentions: { parse: ['users'] } })
  }
  log(`포럼 글 → ${link(gid, thread.id)}  (스레드 ${thread.id})`)
}

async function cmdReply(ctx, args, opts) {
  ctx.setReason('reply')
  const gid = await ensureGuild(ctx)
  const [ref, ...rest] = args
  const chId = await resolveChannel(ctx, ref, gid)
  let first
  for (const [i, c] of splitMessage(readText(rest.join(' ')).trim()).entries()) {
    const m = await ctx.req('POST', `/channels/${chId}/messages`, {
      content: c,
      allowed_mentions: { parse: ['users'], replied_user: true },
      ...(i === 0 && opts.to ? { message_reference: { message_id: String(opts.to), fail_if_not_exists: false } } : {}),
    })
    first ??= m.id
  }
  log(`답글 → ${link(gid, chId, first)}`)
}

// ---------- 멤버 ----------
async function cmdInvite(ctx, _args, opts) {
  ctx.setReason('invite')
  const gid = await ensureGuild(ctx)
  const s = ctx.spec()
  const I = s.invite
  const chKey = opts.channel ?? I.channel
  const chId = ctx.state.channels?.[chKey] ?? (chKey ? await resolveChannel(ctx, chKey, gid) : fail('invite.channel 이 없어요 — server.json 에 정하거나 --channel'))
  const roleKeys = opts.role !== undefined ? String(opts.role).split(',').filter(Boolean) : I.roles
  const roleIds = roleKeys.map((k) => ctx.state.roles?.[k] ?? fail(`역할 '${k}' 이 서버에 없어요 — setup 을 먼저 돌려 주세요`))
  const uses = Number(opts.uses ?? I.maxUses)
  const days = Number(opts.days ?? I.days)
  const count = Number(opts.count ?? 1)
  if (!(Number.isInteger(uses) && uses >= 0 && uses <= 100)) fail('--uses 는 0(무제한)~100')
  if (!(days >= 0 && days <= 7)) fail('디스코드 초대 링크는 최대 7일이에요 (--days 0 = 만료 없음)')
  if (!(Number.isInteger(count) && count >= 1 && count <= 50)) fail('--count 는 1~50')
  const ledgerFile = join(ctx.dir, 'invites.json')
  const ledger = loadJson(ledgerFile, [])
  const roleNames = roleKeys.map((k) => s.roles[k]?.name ?? k).join(', ')
  for (let i = 0; i < count; i++) {
    const inv = await ctx.req('POST', `/channels/${chId}/invites`, {
      max_age: Math.round(days * 86400), max_uses: uses, unique: true, ...(roleIds.length ? { role_ids: roleIds } : {}),
    })
    const note = opts.note ? (count > 1 ? `${opts.note} #${i + 1}` : String(opts.note)) : ''
    ledger.push({ code: inv.code, note, max_uses: uses, expires_at: inv.expires_at ?? null, created_at: new Date().toISOString(), roles: roleKeys })
    log(`https://discord.gg/${inv.code}  (${uses ? `${uses}회` : '무제한'} · ${days ? `${days}일` : '만료 없음'}${roleNames ? ` · 들어오면 ${roleNames}` : ''})${note ? `  — ${note}` : ''}`)
    if (!ctx.dry && roleIds.length && !(inv.roles ?? []).length) {
      log('   ⚠️ 응답에 역할 정보가 없어요 — 첫 입장 뒤 members 로 역할이 붙었는지 확인해 주세요')
    }
  }
  if (!ctx.dry) writeJson(ledgerFile, ledger, 0o600)
}

async function cmdInvites(ctx) {
  const gid = await ensureGuild(ctx)
  const ledger = loadJson(join(ctx.dir, 'invites.json'), [])
  const live = await ctx.req('GET', `/guilds/${gid}/invites`)
  const byCode = new Map(live.map((i) => [i.code, i]))
  const now = Date.now()
  const count = { 사용됨: 0, 대기: 0, 만료: 0, 취소: 0 }
  for (const row of ledger) {
    const l = byCode.get(row.code)
    const st = row.revoked ? '취소' : l ? '대기' : row.expires_at && Date.parse(row.expires_at) < now ? '만료' : '사용됨'
    count[st]++
    log(`${row.created_at.slice(0, 10)}  discord.gg/${row.code}  ${st}${l ? ` (${l.uses}/${l.max_uses || '∞'}회)` : ''}  ${row.note ?? ''}`)
  }
  for (const i of live.filter((x) => !ledger.some((r) => r.code === x.code))) {
    log(`(직접 만든 링크) discord.gg/${i.code}  ${i.uses}/${i.max_uses || '∞'}회 · ${i.inviter?.username ?? '?'}${(i.roles ?? []).length ? '' : ' · 역할 자동 부여 없음'}`)
  }
  log(`\n사용됨 ${count.사용됨} · 대기 ${count.대기} · 만료 ${count.만료} · 취소 ${count.취소}  (1회용 링크는 쓰이면 사라져서 '사용됨'으로 셉니다)`)
}

async function cmdUninvite(ctx, args) {
  ctx.setReason('uninvite')
  const code = String(args[0] ?? '').replace(/^https?:\/\/(www\.)?discord(\.gg|\.com\/invite)\//, '')
  if (!code) fail('사용법: uninvite <코드|링크>')
  await ctx.req('DELETE', `/invites/${code}`)
  const file = join(ctx.dir, 'invites.json')
  const ledger = loadJson(file, [])
  const row = ledger.find((r) => r.code === code)
  if (row && !ctx.dry) {
    row.revoked = true
    writeJson(file, ledger, 0o600)
  }
  log(`취소: discord.gg/${code}${row?.note ? `  — ${row.note}` : ''}`)
}

async function cmdMembers(ctx) {
  const gid = await ensureGuild(ctx)
  const members = []
  try {
    let after = '0'
    for (;;) {
      const page = await ctx.req('GET', `/guilds/${gid}/members`, undefined, { query: { limit: '1000', after } })
      members.push(...page)
      if (page.length < 1000) break
      after = page.at(-1).user.id
    }
  } catch (e) {
    if (e.status === 403) fail('멤버 목록이 막혀 있어요 — 서버 멤버 인텐트가 꺼졌을 수 있어요: whoami (자동으로 켜요)')
    throw e
  }
  const roles = await ctx.req('GET', `/guilds/${gid}/roles`)
  const rname = (id) => roles.find((r) => r.id === id)?.name ?? id
  for (const m of [...members].sort((a, b) => a.joined_at.localeCompare(b.joined_at))) {
    log(`${m.joined_at.slice(0, 10)}  ${displayName(m)} (@${m.user.username} · ${m.user.id})${m.user.bot ? ' [봇]' : ''}  ${m.roles.map(rname).join(', ') || '역할 없음'}`)
  }
  const s = ctx.trySpec()
  const counts = Object.entries(ctx.state.roles ?? {}).map(([k, id]) => `${s?.roles?.[k]?.name ?? k} ${members.filter((m) => m.roles.includes(id)).length}명`)
  log(`\n${members.length}명${counts.length ? ` · ${counts.join(' · ')}` : ''}`)
}

async function cmdRole(ctx, args, add) {
  ctx.setReason(add ? 'grant' : 'revoke')
  const gid = await ensureGuild(ctx)
  const [who, roleRef] = args
  const s = ctx.trySpec()
  const key = roleRef ?? s?.invite?.roles?.[0] ?? Object.keys(ctx.state.roles ?? {}).find((k) => !s?.roles?.[k]?.staff)
  if (!key) fail('어느 역할인지 정해 주세요: grant <멤버> <역할key>')
  const uid = await resolveMember(ctx, who, gid)
  const rid = ctx.state.roles?.[key] ?? (/^\d{15,}$/.test(key) ? key : fail(`역할 '${key}' 를 몰라요 (${Object.keys(ctx.state.roles ?? {}).join(' · ')} 또는 ID)`))
  await ctx.req(add ? 'PUT' : 'DELETE', `/guilds/${gid}/members/${uid}/roles/${rid}`)
  log(`${add ? '부여' : '회수'}: ${who} (${uid}) ${add ? '←' : '→'} ${s?.roles?.[key]?.name ?? key}`)
}

// ---------- 피드백 ----------
function printMessage(m) {
  const who = m.author.global_name ?? m.author.username
  log(`- **${who}**${m.author.bot ? ' [봇]' : ''} ${fmtTime(snowTime(m.id))}  (msg ${m.id})`)
  if (m.content) log(m.content.split('\n').map((l) => `> ${l}`).join('\n'))
  for (const a of m.attachments ?? []) log(`> 📎 ${a.filename} ${a.url}`)
  if (!m.content && !(m.attachments ?? []).length && !m.author.bot) {
    log('> (내용이 비어 있어요 — 메시지 내용 인텐트가 꺼졌으면: whoami)')
  }
}

async function cmdFeedback(ctx, _args, opts) {
  const gid = await ensureGuild(ctx)
  const keys = opts.forum ? String(opts.forum).split(',') : ctx.trySpec()?.feedback ?? []
  if (!keys.length) fail('읽을 포럼이 없어요 — --forum <key> 또는 server.json 의 feedback')
  const forums = new Map()
  for (const k of keys) {
    const id = await resolveChannel(ctx, k, gid)
    forums.set(id, await ctx.req('GET', `/channels/${id}`))
  }
  const threads = (await ctx.req('GET', `/guilds/${gid}/threads/active`)).threads.filter((t) => forums.has(t.parent_id))
  for (const id of forums.keys()) {
    let before
    for (let page = 0; page < 4; page++) {
      const r = await ctx.req('GET', `/channels/${id}/threads/archived/public`, undefined, { query: { limit: '50', ...(before ? { before } : {}) } })
      threads.push(...r.threads)
      if (!r.has_more || !r.threads.length) break
      before = r.threads.at(-1).thread_metadata.archive_timestamp
    }
  }
  const days = Number(opts.days ?? 7)
  const since = opts.all ? 0 : Date.now() - days * 86400000
  const seen = new Set()
  const list = threads
    .filter((t) => !seen.has(t.id) && seen.add(t.id))
    .map((t) => ({ t, last: snowTime(t.last_message_id ?? t.id) }))
    .filter(({ t, last }) => last >= since || snowTime(t.id) >= since)
    .sort((a, b) => b.last - a.last)
  const span = opts.all ? '전체' : `최근 ${days}일`
  if (!list.length) return log(`${span} 새 글·답글 없음`)
  log(`${span} 활동 ${list.length}건 (최근 활동순)`)
  for (const { t } of list) {
    const forum = forums.get(t.parent_id)
    const tagNames = (t.applied_tags ?? []).map((id) => {
      const x = forum.available_tags.find((y) => y.id === id)
      return x ? `${x.emoji_name ?? ''}${x.name}` : id
    })
    const limit = String(Math.min(100, Number(opts.limit ?? 30)))
    const msgs = (await ctx.req('GET', `/channels/${t.id}/messages`, undefined, { query: { limit } })).reverse()
    const emoji = forum.default_reaction_emoji?.emoji_name
    const votes = msgs.find((m) => m.id === t.id)?.reactions?.find((r) => emoji && r.emoji?.name === emoji)?.count ?? 0
    log(`\n### ${forum.name} · ${t.name}`)
    log(`스레드 ${t.id} · ${fmtTime(snowTime(t.id))} · 태그 ${tagNames.join(', ') || '없음'}${votes ? ` · ${emoji} ${votes}` : ''}${t.thread_metadata?.archived ? ' · 보관됨' : ''}`)
    log(link(gid, t.id))
    for (const m of msgs.filter((x) => SHOWN.includes(x.type))) printMessage(m)
  }
}

async function cmdRead(ctx, args, opts) {
  const gid = await ensureGuild(ctx)
  const chId = await resolveChannel(ctx, args[0], gid)
  const limit = String(Math.min(100, Number(opts.limit ?? 30)))
  const msgs = (await ctx.req('GET', `/channels/${chId}/messages`, undefined, { query: { limit } })).reverse()
  for (const m of msgs.filter((x) => SHOWN.includes(x.type))) printMessage(m)
  log(link(gid, chId))
}

async function cmdTag(ctx, args, opts) {
  ctx.setReason('tag')
  await ensureGuild(ctx)
  const [tid, spec] = args
  if (!tid || (!spec && !opts.close && !opts.open)) fail('사용법: tag <스레드ID> <+태그,-태그> [--close|--open]')
  const t = await ctx.req('GET', `/channels/${tid}`)
  const forum = await ctx.req('GET', `/channels/${t.parent_id}`)
  if (forum.type !== TYPES.forum) fail('포럼 글(스레드)에만 태그를 붙일 수 있어요')
  const tags = new Set(t.applied_tags ?? [])
  for (const part of String(spec ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const x = findTag(forum, part)
    if (part.startsWith('-')) {
      tags.delete(x.id)
      continue
    }
    // 상태 태그(운영진 전용)는 하나만 — 접수 → 확인중 → 해결됨 으로 갈아 끼운다
    if (x.moderated) for (const y of forum.available_tags) if (y.moderated) tags.delete(y.id)
    tags.add(x.id)
  }
  if (tags.size > 5) fail('글 하나에 태그는 5개까지예요')
  const body = { applied_tags: [...tags] }
  if (t.thread_metadata?.archived || opts.open) body.archived = false // 보관된 스레드는 꺼내야 고칠 수 있다
  if (opts.open) body.locked = false
  await ctx.req('PATCH', `/channels/${tid}`, body)
  if (opts.close) await ctx.req('PATCH', `/channels/${tid}`, { archived: true })
  const names = [...tags].map((id) => forum.available_tags.find((y) => y.id === id)?.name ?? id)
  log(`태그 ${t.name} → ${names.join(', ') || '없음'}${opts.close ? ' · 보관' : ''}${opts.open ? ' · 다시 엶' : ''}`)
}

// ---------- 서버 꾸미기 · 연동 ----------
function imageData(path) {
  if (!path || !existsSync(path)) fail(`이미지 파일이 없어요: ${path}`)
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[extname(path).toLowerCase()]
  if (!mime) fail('이미지는 png · jpg · gif · webp 만 돼요')
  if (statSync(path).size > 8 * 1024 * 1024) fail('이미지가 8MB 를 넘어요 — 512×512 정도로 줄여 주세요')
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}

async function cmdRename(ctx, args) {
  ctx.setReason('rename')
  const gid = await ensureGuild(ctx)
  const name = args.join(' ').trim()
  if (name.length < 2 || name.length > 100) fail('서버 이름은 2~100자예요')
  await ctx.req('PATCH', `/guilds/${gid}`, { name })
  const file = join(ctx.dir, 'server.json')
  if (existsSync(file) && !ctx.dry) {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    raw.server = { ...(raw.server ?? {}), name }
    writeJson(file, raw)
  }
  log(`서버 이름 → ${name}`)
}

async function cmdIcon(ctx, args) {
  ctx.setReason('icon')
  const gid = await ensureGuild(ctx)
  await ctx.req('PATCH', `/guilds/${gid}`, { icon: imageData(args[0]) })
  log('서버 아이콘 바꿈')
}

async function cmdAvatar(ctx, args) {
  ctx.setReason('avatar')
  await ctx.req('PATCH', '/users/@me', { avatar: imageData(args[0]) })
  log('봇 프로필 사진 바꿈 (디스코드가 시간당 바꾸는 횟수를 제한해요)')
}

async function cmdWebhook(ctx, args, opts) {
  ctx.setReason('webhook')
  const gid = await ensureGuild(ctx)
  const chId = await resolveChannel(ctx, args[0], gid)
  const name = String(opts.name ?? 'app').slice(0, 80)
  if (/discord|clyde/i.test(name)) fail("웹훅 이름에 'discord'·'clyde' 는 못 써요 (디스코드 규칙)")
  const wh = await ctx.req('POST', `/channels/${chId}/webhooks`, { name })
  const url = `https://discord.com/api/webhooks/${wh.id}/${wh.token}`
  // 주소 = 비밀번호. 화면에 찍으면 터미널 기록·AI 대화 기록에 남는다 — 기본은 가리고 클립보드로, 파이프용은 --raw, 꼭 봐야 하면 --reveal
  if (opts.raw) {
    log(url)
    console.error(`웹훅 만듦: ${wh.name} (${wh.id}) — 주소는 표준 출력으로만 내보냈어요 (예: … --raw | npx wrangler secret put DISCORD_WEBHOOK_URL)`)
    return
  }
  log(`웹훅 만듦: ${wh.name} (${wh.id})`)
  if (opts.reveal) {
    log(`URL: ${url}`)
  } else {
    log(`URL: https://discord.com/api/webhooks/${wh.id}/${wh.token.slice(0, 4)}…`)
    log(writeClipboard(url)
      ? '전체 주소를 클립보드에 복사했어요 — 앱의 환경변수(.env)·비밀값에 붙여 넣은 뒤 클립보드를 비우세요'
      : '전체 주소는 화면에 찍지 않았어요 — --raw 로 다른 명령에 바로 넘기거나(… --raw | npx wrangler secret put DISCORD_WEBHOOK_URL) --reveal 로 보세요')
  }
  log('⚠️  이 주소를 아는 사람은 누구나 이 채널에 글을 쓸 수 있어요 — 내 앱의 환경변수(.env)에만 넣고 공개 저장소·채팅에 올리지 마세요')
  log(`보내기 예: curl -H "Content-Type: application/json" -d '{"content":"새 가입 1건"}' "<URL>"`)
}

async function cmdWebhooks(ctx, _args, opts) {
  const gid = await ensureGuild(ctx)
  const list = await ctx.req('GET', `/guilds/${gid}/webhooks`)
  if (!list.length) return log('웹훅 없음')
  for (const w of list) {
    const reveal = opts.reveal || opts.show
    const url = w.token ? `https://discord.com/api/webhooks/${w.id}/${reveal ? w.token : `${w.token.slice(0, 4)}…`}` : '(토큰 없음 — 다른 앱이 만든 웹훅)'
    log(`${w.id}  ${w.name}  채널 ${w.channel_id}  ${url}`)
  }
  if (!opts.reveal && !opts.show) log('\n전체 주소가 필요하면 --reveal (주소는 비밀번호처럼 다루세요 — 화면에 찍으면 대화 기록에 남아요)')
}

async function cmdUnwebhook(ctx, args) {
  ctx.setReason('unwebhook')
  if (!args[0]) fail('사용법: unwebhook <웹훅ID>')
  await ctx.req('DELETE', `/webhooks/${args[0]}`)
  log(`웹훅 지움: ${args[0]}`)
}

async function cmdApi(ctx, args) {
  ctx.setReason('api')
  const [method, rawPath, bodyArg] = args
  if (!method || !rawPath) fail('사용법: api <GET|POST|PATCH|PUT|DELETE> <경로> [JSON|@파일]')
  let path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  if (path.includes('{guild}')) path = path.replaceAll('{guild}', await ensureGuild(ctx))
  if (path.includes('{app}')) path = path.replaceAll('{app}', ctx.state.app_id ?? (await ctx.req('GET', '/applications/@me')).id)
  let body
  if (bodyArg) {
    try {
      body = JSON.parse(readText(bodyArg))
    } catch (e) {
      fail(`JSON 이 틀렸어요: ${e.message}`)
    }
  }
  const res = await ctx.req(method.toUpperCase(), path, body)
  log(res === null ? '(204 — 성공, 돌려준 내용 없음)' : JSON.stringify(res, null, 2))
}

const HELP = `discord-server ${VERSION} — 말로 디스코드 서버를 만들고 봇으로 운영 (node scripts/discord.mjs <명령>)

시작
  doctor                     막힌 곳 점검 + 다음에 할 일 (먼저 이것)
  init [--template closed-beta|community|course] [--lang ko|en] [--name 이름] [--force]
  token [--prompt|--stdin|--file 경로]   봇 토큰 저장 (기본: 클립보드에서 읽고 비움)
  bot-invite                 봇 초대 링크
  whoami · profiles · validate

서버 구조 (원천: <프로필>/server.json · content/*.md)
  setup [--dry]              설계도대로 맞춤 — 없는 것만 만들고 접근 규칙·주제·태그·고정 글을 맞춤 (지우지 않음)
  prune [--yes]              설계도 밖 채널 목록 — --yes 면 '서버 기본 채널 + 사람 메시지 0' 만 지움
  adopt [--force]            이미 있는 서버를 server.json 으로 가져오기
  ids                        역할·채널·포럼 태그 ID
  rename <이름> · icon <이미지> · avatar <이미지>

게시
  post <채널> <글|@파일|-> [--ping] [--pin] [--silent] [--noembed]
  edit <채널> <메시지ID> <글|@파일> · forum <포럼> <제목> <글|@파일> [--tags a,b]
  reply <채널|스레드ID> <글|@파일> [--to 메시지ID]

멤버
  invite [--note 이름] [--uses 1] [--days 7] [--count N] [--role key,key] [--channel key]
  invites · uninvite <코드> · members · grant <멤버> [역할key] · revoke <멤버> [역할key]

피드백
  feedback [--days 7] [--all] [--forum key] [--limit 30] · read <채널|스레드ID> [--limit 30]
  tag <스레드ID> <+태그,-태그> [--close|--open]

연동 · 원시 REST
  webhook <채널> [--name 이름] [--raw | --reveal] · webhooks [--reveal] · unwebhook <ID>
  api <METHOD> <경로> [JSON|@파일]   {guild}·{app} 치환. 예) api GET /guilds/{guild}/roles

공통: --profile <이름> (서버가 여럿일 때) · --guild <서버ID> · --dir <폴더>
채널 지정: server.json 의 key · 이름 일부 · ID · <#ID>`

const BOOL_FLAGS = new Set(['dry', 'ping', 'pin', 'silent', 'noembed', 'yes', 'all', 'close', 'open', 'force', 'stdin', 'prompt', 'show', 'reveal', 'raw', 'help'])
export function parseArgs(argv) {
  const args = []
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      args.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=')
      if (eq > 2) opts[a.slice(2, eq)] = a.slice(eq + 1)
      else {
        const k = a.slice(2)
        opts[k] = BOOL_FLAGS.has(k) ? true : argv[++i]
      }
    } else args.push(a)
  }
  return { args, opts }
}

const COMMANDS = {
  doctor: cmdDoctor, init: cmdInit, token: cmdToken, 'bot-invite': cmdBotInvite, whoami: cmdWhoami, profiles: cmdProfiles,
  validate: cmdValidate, setup: cmdSetup, prune: cmdPrune, adopt: cmdAdopt, ids: cmdIds,
  rename: cmdRename, icon: cmdIcon, avatar: cmdAvatar,
  post: cmdPost, edit: cmdEdit, forum: cmdForum, reply: cmdReply,
  invite: cmdInvite, invites: cmdInvites, uninvite: cmdUninvite, members: cmdMembers,
  grant: (ctx, a) => cmdRole(ctx, a, true), revoke: (ctx, a) => cmdRole(ctx, a, false),
  feedback: cmdFeedback, read: cmdRead, tag: cmdTag,
  webhook: cmdWebhook, webhooks: cmdWebhooks, unwebhook: cmdUnwebhook, api: cmdApi,
}

export async function run(argv) {
  if (typeof fetch !== 'function') fail('Node.js 18 이상이 필요해요 — https://nodejs.org 에서 LTS 를 설치하세요')
  const { args, opts } = parseArgs(argv)
  const [cmd, ...rest] = args
  const fn = COMMANDS[cmd]
  if (!fn || opts.help) return log(HELP)
  opts._cmd = cmd
  const ctx = makeContext(opts)
  await fn(ctx, rest, opts)
  ctx.saveState()
}

// 직접 실행됐을 때만 돈다. 심링크(~/.claude/skills/…)·npx 로 실행하면 Node 는 이 파일을 실제 경로로 읽으므로 둘 다 실제 경로로 비교한다
const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isMain) {
  run(process.argv.slice(2)).catch((e) => {
    console.error(`❌ ${e instanceof HdError || e instanceof ApiError ? e.message : e.stack}`)
    process.exit(1)
  })
}
