// server.json — 서버 설계도. 읽고, 빈칸을 기본값으로 채우고,
// 디스코드에 보내기 전에 틀린 곳을 사람 말로 짚는다 (API 오류 코드보다 먼저 잡는 게 목적).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from './api.mjs'
import { PRESETS, isPermName, perms } from './perms.mjs'

export const TYPES = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 }
export const TYPE_NAMES = {
  0: '텍스트', 2: '음성', 4: '카테고리', 5: '공지', 10: '공지 스레드', 11: '스레드', 12: '비공개 스레드',
  13: '스테이지', 15: '포럼', 16: '미디어',
}
export const KEY_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u
const TEXTISH = ['text', 'announcement']

export function readSpec(dir) {
  const file = join(dir, 'server.json')
  if (!existsSync(file)) {
    fail(`server.json 이 없어요 (${file})\n   👉 init --template closed-beta|community|course --name "서버 이름" 으로 만드세요`)
  }
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    fail(`server.json 이 올바른 JSON 이 아니에요: ${e.message}`)
  }
  return normalize(raw)
}

export const allChannels = (s) => (s.categories ?? []).flatMap((c) => c.channels ?? [])
export const findChannel = (s, key) => allChannels(s).find((c) => c.key === key)
export const staffKeys = (s) => Object.entries(s.roles ?? {}).filter(([, r]) => r.staff).map(([k]) => k)

export function normalize(raw) {
  const s = JSON.parse(JSON.stringify(raw ?? {}))
  s.version ??= 1
  s.server ??= {}
  s.server.everyone ??= 'keep'
  s.vars ??= {}
  s.roles ??= {}
  for (const r of Object.values(s.roles)) {
    r.permissions ??= 'none'
    r.hoist ??= false
    r.mentionable ??= false
    r.staff ??= false
  }
  s.categories ??= []
  for (const c of s.categories) {
    c.visibleTo ??= 'everyone'
    c.channels ??= []
  }
  s.messages ??= []
  s.invite ??= {}
  s.invite.roles ??= []
  s.invite.maxUses ??= 1
  s.invite.days ??= 7
  s.invite.channel ??= s.server.rulesChannel ?? allChannels(s).find((c) => TEXTISH.includes(c.type))?.key
  s.feedback ??= allChannels(s).filter((c) => c.type === 'forum').map((c) => c.key)
  return s
}

export function rolePerms(r) {
  const p = r.permissions
  if (typeof p === 'string') {
    const list = PRESETS.role[p] ?? fail(`역할 권한 이름표 '${p}' 를 몰라요 (none · moderator · admin 또는 권한 이름 배열)`)
    return perms(list)
  }
  return perms(p)
}

// null = 손대지 않음
export function everyonePerms(s) {
  const e = s.server.everyone
  if (e === 'keep') return null
  if (typeof e === 'string') {
    return perms(PRESETS.everyone[e] ?? fail(`server.everyone '${e}' 를 몰라요 (safe · open · keep 또는 권한 이름 배열)`))
  }
  return perms(e)
}

export const colorInt = (c) => (typeof c === 'number' ? c : c ? parseInt(String(c).replace('#', ''), 16) : 0)

// 접근 규칙 → [[대상, { allow, deny }], ...]  대상 = '@everyone' 또는 역할 key
//   visibleTo: 'everyone' | [역할 key...]   목록 밖은 못 본다. staff 역할은 늘 본다
//   readonly : true      아무도 못 쓴다 (staff 만)
//              'comments' 새 글·스레드는 못 쓰고, 스레드 안 댓글은 쓴다 (포럼 자료실처럼)
//   permissions: { 대상: { allow, deny } }  위 규칙 뒤에 덧붙이는 세부 규칙
//   inherit: false        채널이 카테고리 규칙을 물려받지 않는다
export function accessRules(s, cat, ch) {
  const staff = staffKeys(s)
  const rules = []
  const visible = (v) => {
    if (!v || v === 'everyone') return
    rules.push(['@everyone', { deny: ['VIEW_CHANNEL'] }])
    for (const k of new Set([...v, ...staff])) rules.push([k, { allow: ['VIEW_CHANNEL'] }])
  }
  const extra = (p) => {
    for (const [t, r] of Object.entries(p ?? {})) rules.push([t, r])
  }
  if (!ch) {
    visible(cat.visibleTo)
    extra(cat.permissions)
    return rules
  }
  if (ch.inherit === false) visible(ch.visibleTo)
  else {
    visible(ch.visibleTo ?? cat.visibleTo)
    extra(cat.permissions)
  }
  if (ch.readonly) {
    const deny = ['SEND_MESSAGES', 'CREATE_PUBLIC_THREADS', 'CREATE_PRIVATE_THREADS']
    if (ch.readonly !== 'comments') deny.push('SEND_MESSAGES_IN_THREADS')
    rules.push(['@everyone', { deny }])
    for (const k of staff) rules.push([k, { allow: ['SEND_MESSAGES', 'SEND_MESSAGES_IN_THREADS', 'CREATE_PUBLIC_THREADS'] }])
  }
  extra(ch.permissions)
  return rules
}

// 규칙 → 디스코드 permission_overwrites. 같은 대상의 나중 규칙이 앞 규칙을 덮는다
export function buildOverwrites(rules, ids) {
  const map = new Map()
  for (const [target, r] of rules) {
    const id = target === '@everyone' ? ids.everyone : ids.roles[target]
    if (!id) fail(`접근 규칙의 대상 '${target}' 이 roles 에 없어요`)
    const cur = map.get(id) ?? { allow: 0n, deny: 0n }
    const a = perms(r.allow ?? [])
    const d = perms(r.deny ?? [])
    cur.allow = (cur.allow & ~d) | a
    cur.deny = (cur.deny & ~a) | d
    map.set(id, cur)
  }
  return [...map].map(([id, v]) => ({ id, type: 0, allow: String(v.allow), deny: String(v.deny) }))
}

// {{name}} = vars · {{#채널key}} = 채널 링크 · {{@&역할key}} = 역할 멘션
export function renderContent(text, s, state) {
  return text
    .replace(/\{\{#([\p{L}\p{N}_-]+)\}\}/gu, (_, k) => (state.channels?.[k] ? `<#${state.channels[k]}>` : `#${k}`))
    .replace(/\{\{@&([\p{L}\p{N}_-]+)\}\}/gu, (_, k) => (state.roles?.[k] ? `<@&${state.roles[k]}>` : `@${k}`))
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in s.vars ? String(s.vars[k]) : m))
    .trim()
}

export function validate(s, dir) {
  const errors = []
  const warnings = []
  const E = (m) => errors.push(m)
  const W = (m) => warnings.push(m)
  const roleKeys = new Set(Object.keys(s.roles))

  const checkVisible = (v, label) => {
    if (v === undefined || v === 'everyone') return
    if (!Array.isArray(v)) return E(`${label}: visibleTo 는 "everyone" 또는 역할 key 배열이에요`)
    for (const k of v) if (!roleKeys.has(k)) E(`${label}: visibleTo 의 역할 '${k}' 이 roles 에 없어요`)
  }
  const checkPermsObj = (p, label) => {
    if (p === undefined) return
    if (typeof p !== 'object' || Array.isArray(p) || p === null) {
      return E(`${label}: permissions 는 { "대상": { "allow": [...], "deny": [...] } } 모양이에요`)
    }
    for (const [t, r] of Object.entries(p)) {
      if (t !== '@everyone' && !roleKeys.has(t)) E(`${label}: permissions 의 대상 '${t}' — '@everyone' 또는 역할 key`)
      for (const n of [...(r?.allow ?? []), ...(r?.deny ?? [])]) if (!isPermName(n)) E(`${label}: 모르는 권한 이름 '${n}'`)
    }
  }
  const checkTextChannel = (key, label, required) => {
    if (key === undefined) {
      if (required) E(`server.${label} 이 필요해요 (커뮤니티 서버 필수 · 텍스트 채널 key)`)
      return
    }
    const ch = findChannel(s, key)
    if (!ch) E(`server.${label} 의 채널 '${key}' 이 없어요`)
    else if (ch.type !== 'text') E(`server.${label} '${key}' 는 텍스트 채널이어야 해요 (지금 ${ch.type})`)
  }

  if (s.version !== 1) E(`version 은 1 이어야 해요 (지금 ${s.version})`)
  if (!s.server.name || typeof s.server.name !== 'string') E('server.name 이 필요해요 — 봇이 들어간 서버 중 이 이름의 서버를 골라요')
  const ev = s.server.everyone
  if (Array.isArray(ev) ? ev.some((p) => !isPermName(p)) : !['keep', ...Object.keys(PRESETS.everyone)].includes(ev)) {
    E('server.everyone 은 safe · open · keep 또는 권한 이름 배열이에요')
  }
  if (s.server.notifications !== undefined && !['mentions', 'all'].includes(s.server.notifications)) {
    E('server.notifications 는 "mentions" 또는 "all"')
  }
  if (s.server.systemChannelFlags !== undefined && !Number.isInteger(s.server.systemChannelFlags)) {
    E('server.systemChannelFlags 는 정수예요')
  }

  for (const [k, r] of Object.entries(s.roles)) {
    if (!KEY_RE.test(k)) E(`역할 key '${k}' — 글자·숫자로 시작하고 글자·숫자·-·_ 만 써요`)
    if (typeof r.name !== 'string' || !r.name.length || r.name.length > 100) E(`roles.${k}.name 은 1~100자예요`)
    if (r.color !== undefined && !(typeof r.color === 'number' || /^#?[0-9a-f]{6}$/i.test(String(r.color)))) {
      E(`roles.${k}.color 는 "#RRGGBB" 모양이에요`)
    }
    const p = r.permissions
    if (typeof p === 'string' ? !(p in PRESETS.role) : !Array.isArray(p) || p.some((n) => !isPermName(n))) {
      E(`roles.${k}.permissions 는 none · moderator · admin 또는 권한 이름 배열이에요`)
    }
    if (p === 'admin') W(`roles.${k} 에 관리자 권한 — 꼭 필요한 게 아니면 moderator 를 쓰세요`)
  }

  const seen = new Set()
  let total = 0
  for (const c of s.categories) {
    const label = `카테고리 ${c.key ?? '(key 없음)'}`
    if (!KEY_RE.test(c.key ?? '')) E(`${label}: key 가 비었거나 형식이 틀렸어요`)
    else if (seen.has(c.key)) E(`key '${c.key}' 가 두 번 나와요 — 카테고리·채널 key 는 모두 달라야 해요`)
    seen.add(c.key)
    if (c.name !== null && (typeof c.name !== 'string' || !c.name.length || c.name.length > 100)) {
      E(`${label}: name 은 1~100자예요 (카테고리 없이 맨 위에 둘 채널 묶음이면 "name": null)`)
    }
    checkVisible(c.visibleTo, label)
    checkPermsObj(c.permissions, label)
    if (c.channels.length > 50) E(`${label}: 채널이 50개를 넘어요 (디스코드 한도)`)
    for (const ch of c.channels) {
      total++
      const cl = `채널 ${ch.key ?? '(key 없음)'}`
      if (!KEY_RE.test(ch.key ?? '')) E(`${cl}: key 가 비었거나 형식이 틀렸어요`)
      else if (seen.has(ch.key)) E(`key '${ch.key}' 가 두 번 나와요 — 카테고리·채널 key 는 모두 달라야 해요`)
      seen.add(ch.key)
      if (!(ch.type in TYPES) || ch.type === 'category') E(`${cl}: type 은 text · announcement · forum · voice · stage 예요`)
      if (typeof ch.name !== 'string' || !ch.name.length || ch.name.length > 100) E(`${cl}: name 은 1~100자예요`)
      else if (['text', 'announcement', 'forum'].includes(ch.type) && /[A-Z ]/.test(ch.name)) {
        W(`${cl}: 디스코드가 이름의 대문자·공백을 소문자·'-' 로 바꿔요 ('${ch.name}')`)
      }
      if (ch.topic !== undefined) {
        const max = ch.type === 'forum' ? 4096 : 1024
        if (['voice', 'stage'].includes(ch.type)) W(`${cl}: 음성·스테이지 채널에는 topic 이 붙지 않아요`)
        else if (String(ch.topic).length > max) E(`${cl}: topic 이 ${max}자를 넘어요`)
      }
      if (ch.readonly !== undefined && ![true, false, 'comments'].includes(ch.readonly)) E(`${cl}: readonly 는 true · false · "comments"`)
      if (ch.slowmode !== undefined && !(Number.isInteger(ch.slowmode) && ch.slowmode >= 0 && ch.slowmode <= 21600)) {
        E(`${cl}: slowmode 는 0~21600 초예요`)
      }
      if (ch.inherit !== undefined && typeof ch.inherit !== 'boolean') E(`${cl}: inherit 는 true · false`)
      checkVisible(ch.visibleTo, cl)
      checkPermsObj(ch.permissions, cl)
      if (ch.type === 'forum') {
        const tags = ch.tags ?? []
        if (tags.length > 20) E(`포럼 ${ch.key}: 태그는 20개까지예요`)
        const names = new Set()
        for (const t of tags) {
          if (typeof t.name !== 'string' || !t.name.length || t.name.length > 20) E(`포럼 ${ch.key}: 태그 이름은 1~20자예요 ('${t.name}')`)
          if (names.has(t.name)) E(`포럼 ${ch.key}: 태그 '${t.name}' 가 두 번 나와요`)
          names.add(t.name)
        }
        if (ch.sort !== undefined && !['activity', 'created'].includes(ch.sort)) E(`포럼 ${ch.key}: sort 는 "activity" 또는 "created"`)
        if (ch.layout !== undefined && !['list', 'gallery'].includes(ch.layout)) E(`포럼 ${ch.key}: layout 은 "list" 또는 "gallery"`)
      } else if (ch.tags || ch.reaction) W(`${cl}: tags·reaction 은 포럼에서만 써요`)
      if (['announcement', 'stage'].includes(ch.type) && !s.server.community) {
        E(`${cl}: ${ch.type === 'stage' ? '스테이지' : '공지'} 채널은 커뮤니티 서버에서만 만들 수 있어요 — server.community 를 true 로`)
      }
    }
  }
  if (total > 500) E('채널이 500개를 넘어요 (디스코드 한도)')

  checkTextChannel(s.server.rulesChannel, 'rulesChannel', !!s.server.community)
  checkTextChannel(s.server.updatesChannel, 'updatesChannel', !!s.server.community)
  checkTextChannel(s.server.systemChannel, 'systemChannel', false)
  checkTextChannel(s.server.safetyChannel, 'safetyChannel', false)
  if (s.server.safetyChannel && !s.server.community) E('server.safetyChannel 은 커뮤니티 서버에서만 써요')

  for (const m of s.messages) {
    const ml = `messages.${m.key ?? '(key 없음)'}`
    if (!KEY_RE.test(m.key ?? '')) E(`${ml}: key 가 비었거나 형식이 틀렸어요`)
    const ch = findChannel(s, m.channel)
    if (!ch) E(`${ml}: 채널 '${m.channel}' 이 없어요`)
    else if (!TEXTISH.includes(ch.type)) E(`${ml}: 고정 글은 텍스트·공지 채널에만 둘 수 있어요`)
    if (!m.file) {
      E(`${ml}: file 이 필요해요 (예: content/welcome.md)`)
      continue
    }
    if (!dir) continue
    const file = join(dir, m.file)
    if (!existsSync(file)) {
      E(`${ml}: 파일이 없어요 (${file})`)
      continue
    }
    const text = readFileSync(file, 'utf8')
    for (const [, v] of text.matchAll(/\{\{(\w+)\}\}/g)) if (!(v in s.vars)) W(`${ml}: {{${v}}} 값이 vars 에 없어요`)
    for (const [, k] of text.matchAll(/\{\{#([\p{L}\p{N}_-]+)\}\}/gu)) if (!findChannel(s, k)) W(`${ml}: {{#${k}}} 채널이 없어요`)
    for (const [, k] of text.matchAll(/\{\{@&([\p{L}\p{N}_-]+)\}\}/gu)) if (!roleKeys.has(k)) W(`${ml}: {{@&${k}}} 역할이 없어요`)
  }
  for (const [k, v] of Object.entries(s.vars)) {
    if (/example\.(com|org|net)/.test(String(v))) W(`vars.${k} 가 아직 예시 값이에요 (${v}) — 내 주소로 바꾸세요`)
  }

  if (s.welcomeScreen) {
    const w = s.welcomeScreen
    if (!s.server.community) E('welcomeScreen 은 커뮤니티 서버에서만 써요 — server.community 를 true 로')
    if (String(w.description ?? '').length > 140) E('welcomeScreen.description 은 140자까지예요')
    if ((w.channels ?? []).length > 5) E('welcomeScreen.channels 는 5개까지예요')
    for (const c of w.channels ?? []) {
      const ch = findChannel(s, c.channel)
      if (!ch) {
        E(`welcomeScreen: 채널 '${c.channel}' 이 없어요`)
        continue
      }
      const cat = s.categories.find((x) => x.channels.includes(ch))
      const hidden = accessRules(s, cat, ch).some(([t, r]) => t === '@everyone' && (r.deny ?? []).includes('VIEW_CHANNEL'))
      if (hidden) W(`welcomeScreen: '${c.channel}' 는 역할로 가려져 있어 빠져요 — 디스코드 규칙: 환영 화면 채널은 모두가 읽을 수 있어야 해요`)
    }
  }

  const inv = s.invite
  if (inv.channel !== undefined && !findChannel(s, inv.channel)) E(`invite.channel '${inv.channel}' 이 없어요`)
  for (const r of inv.roles) if (!roleKeys.has(r)) E(`invite.roles 의 역할 '${r}' 이 roles 에 없어요`)
  if (!(Number.isInteger(inv.maxUses) && inv.maxUses >= 0 && inv.maxUses <= 100)) E('invite.maxUses 는 0(무제한)~100 이에요')
  if (!(typeof inv.days === 'number' && inv.days >= 0 && inv.days <= 7)) E('invite.days 는 0(만료 없음)~7 이에요 — 디스코드 초대 링크 한도')
  for (const k of s.feedback) {
    const ch = findChannel(s, k)
    if (!ch) E(`feedback 의 채널 '${k}' 이 없어요`)
    else if (ch.type !== 'forum') E(`feedback 의 '${k}' 는 포럼이어야 해요`)
  }
  return { errors, warnings }
}
