// 테스트용 가짜 디스코드 — CLI 가 쓰는 REST 경로만 메모리로 흉내 낸다.
// 진짜 디스코드가 거절하는 것 중 이 도구가 기대는 규칙은 똑같이 거절한다:
//   토큰 없으면 401 · 공지·스테이지 채널·환영 화면·안전 알림은 커뮤니티 서버만 · 커뮤니티는 규칙·안내 채널 + 인증 ≥1 + 필터 2 ·
//   앱 플래그는 *_LIMITED 인텐트만 바뀜 · 멤버 목록은 멤버 인텐트 · 남의 메시지 내용은 내용 인텐트 ·
//   봇은 자기 역할보다 아래 역할만 부여 · 보관된 스레드는 꺼내야 고침 · 2000자 · 초대 7일 · 웹훅 이름 규칙
const EPOCH = 1420070400000n
const MEMBERS_INTENT = (1 << 14) | (1 << 15)
const CONTENT_INTENT = (1 << 18) | (1 << 19)
const LIMITED = (1 << 13) | (1 << 15) | (1 << 19)

const err = (status, code, message) => Object.assign(new Error(message), { status, code })
const iso = () => new Date().toISOString()

// strictWelcome: 환영 화면에 @everyone 이 못 보는 채널을 넣으면 거절 (그럴 수도 있는 경우를 재현)
// joined: false 면 봇이 아직 서버에 없다 (inviteBot() 으로 들인다)
export function createFakeDiscord({ guildName = 'my-server', strictWelcome = false, joined = true } = {}) {
  let seq = 0n
  const snow = (offsetMs = 0) => String(((BigInt(Date.now() + offsetMs) - EPOCH) << 22n) + (seq++ % 4096n))
  const gid = snow()
  const botId = snow()
  const ownerId = snow()
  const botRoleId = snow()
  const bot = { id: botId, username: 'testbot', bot: true }
  const token = `${Buffer.from(botId).toString('base64').replace(/=+$/, '')}.GaBcDe.${'x'.repeat(38)}`
  const failures = [] // [{ method, path, status, times }] — 일부러 실패시킬 요청
  const db = {
    calls: [],
    joined,
    app: { id: botId, name: 'testbot', flags: 0, description: '', bot },
    me: { ...bot, avatar: null },
    guild: {
      id: gid, name: guildName, owner_id: ownerId, features: [], verification_level: 0, mfa_level: 0,
      explicit_content_filter: 0, default_message_notifications: 0, system_channel_id: null,
      system_channel_flags: 0, rules_channel_id: null, public_updates_channel_id: null,
      safety_alerts_channel_id: null, description: null, preferred_locale: 'en-US', icon: null,
    },
    roles: [
      { id: gid, name: '@everyone', permissions: '2248473465835073', position: 0 },
      { id: botRoleId, name: 'testbot', permissions: '8', position: 1, managed: true },
    ],
    members: [
      { user: { id: ownerId, username: 'owner', global_name: '주인' }, roles: [], joined_at: iso(), nick: null },
      { user: bot, roles: [botRoleId], joined_at: iso(), nick: null },
    ],
    channels: [],
    messages: new Map(),
    pins: new Map(),
    invites: [],
    webhooks: [],
    welcome: null,
  }

  const byId = (id) => db.channels.find((c) => c.id === id)
  const member = (id) => db.members.find((m) => m.user.id === id)
  function ch(props, offsetMs = 0) {
    const c = { id: snow(offsetMs), guild_id: gid, type: 0, permission_overwrites: [], parent_id: null, topic: null, position: 0, ...props }
    c.position = props.position ?? db.channels.filter((x) => x.type === c.type && x.parent_id === c.parent_id).length
    db.channels.push(c)
    return c
  }
  function msg(channelId, props) {
    const m = { id: snow(), channel_id: channelId, type: 0, content: '', attachments: [], reactions: [], flags: 0, ...props }
    db.messages.set(channelId, [...(db.messages.get(channelId) ?? []), m])
    const c = byId(channelId)
    if (c) {
      c.last_message_id = m.id
      if (c.type === 11) c.message_count = (c.message_count ?? 0) + 1
    }
    return m
  }
  const findMsg = (c, id) => (db.messages.get(c) ?? []).find((m) => m.id === id)
  const redact = (m) => (m.author.id === botId || db.app.flags & CONTENT_INTENT ? m : { ...m, content: '', attachments: [], embeds: [] })
  const botTop = () => Math.max(...member(botId).roles.map((r) => db.roles.find((x) => x.id === r)?.position ?? 0))
  const hiddenFromEveryone = (c) =>
    [c, byId(c?.parent_id)].some((x) => x && (BigInt(x.permission_overwrites.find((o) => o.id === gid)?.deny ?? '0') & (1n << 10n)))

  // 클라이언트 '서버 만들기' 가 만드는 기본 채널 + 봇 입장 시스템 메시지
  const textCat = ch({ name: '채팅 채널', type: 4 })
  const voiceCat = ch({ name: '음성 채널', type: 4 })
  const general = ch({ name: '일반', type: 0, parent_id: textCat.id })
  ch({ name: '일반', type: 2, parent_id: voiceCat.id })
  db.guild.system_channel_id = general.id
  if (joined) msg(general.id, { type: 7, author: bot })

  function route(method, path, body, q) {
    let m
    const is = (meth, re) => method === meth && (m = path.match(re))

    if (is('GET', /^\/gateway$/)) return { url: 'wss://gateway.discord.gg' }
    if (is('GET', /^\/users\/@me$/)) return db.me
    if (is('PATCH', /^\/users\/@me$/)) return Object.assign(db.me, body)
    if (is('GET', /^\/applications\/@me$/)) return db.app
    if (is('PATCH', /^\/applications\/@me$/)) {
      if (body.flags !== undefined) {
        if ((body.flags & ~LIMITED) !== (db.app.flags & ~LIMITED)) throw err(400, 50035, 'only limited intent flags')
        db.app.flags = body.flags
      }
      if (body.description !== undefined) db.app.description = body.description
      return db.app
    }
    if (is('GET', /^\/users\/@me\/guilds$/)) {
      return db.joined ? [{ id: gid, name: db.guild.name, owner: false, permissions: '2251799813685247' }] : []
    }
    if (path.startsWith(`/guilds/${gid}`) && !db.joined) throw err(403, 50001, 'Missing Access')

    if (is('GET', /^\/guilds\/(\d+)$/)) return { ...db.guild, roles: db.roles }
    if (is('PATCH', /^\/guilds\/(\d+)$/)) {
      const next = { ...db.guild, ...body }
      if (body.features) {
        if (body.features.includes('COMMUNITY') && !db.guild.features.includes('COMMUNITY')) {
          if (!next.rules_channel_id || !next.public_updates_channel_id) throw err(400, 50035, 'community needs rules + public updates channel')
          if (next.verification_level < 1 || next.explicit_content_filter !== 2) throw err(400, 50035, 'community needs verification + content filter')
        }
        next.features = [...new Set(body.features)]
      }
      if (body.safety_alerts_channel_id && !next.features.includes('COMMUNITY')) throw err(400, 50035, 'safety alerts need community')
      if (body.icon !== undefined && body.icon !== null && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(body.icon)) throw err(400, 50035, 'bad image')
      db.guild = next
      return { ...db.guild, roles: db.roles }
    }

    if (is('GET', /^\/guilds\/(\d+)\/roles$/)) return db.roles
    if (is('POST', /^\/guilds\/(\d+)\/roles$/)) {
      for (const r of db.roles) if (r.position >= 1) r.position++
      const role = {
        id: snow(), name: body.name, permissions: body.permissions ?? '0', position: 1,
        color: body.colors?.primary_color ?? 0, colors: body.colors, hoist: !!body.hoist, mentionable: !!body.mentionable, managed: false,
      }
      db.roles.push(role)
      return role
    }
    if (is('PATCH', /^\/guilds\/(\d+)\/roles\/(\d+)$/)) return Object.assign(db.roles.find((r) => r.id === m[2]), body)

    if (is('GET', /^\/guilds\/(\d+)\/channels$/)) return db.channels.filter((c) => c.type !== 11)
    if (is('POST', /^\/guilds\/(\d+)\/channels$/)) {
      if ([5, 13].includes(body.type) && !db.guild.features.includes('COMMUNITY')) throw err(400, 50024, 'needs community')
      const tags = (body.available_tags ?? []).map((t) => ({ id: snow(), emoji_id: null, emoji_name: null, moderated: false, ...t }))
      return ch({ ...body, ...(body.type === 15 ? { available_tags: tags } : {}) })
    }
    if (is('PATCH', /^\/guilds\/(\d+)\/channels$/)) {
      for (const p of body) Object.assign(byId(p.id) ?? {}, p)
      return undefined
    }

    if (is('GET', /^\/channels\/(\d+)$/)) {
      const c = byId(m[1])
      if (!c) throw err(404, 10003, 'Unknown Channel')
      return c
    }
    if (is('PATCH', /^\/channels\/(\d+)$/)) {
      const c = byId(m[1])
      const patch = { ...body }
      if (c.thread_metadata?.archived && patch.archived !== false && ('applied_tags' in patch || 'name' in patch)) {
        throw err(400, 50083, 'Thread is archived')
      }
      if (patch.available_tags) {
        patch.available_tags = patch.available_tags.map((t) => ({ emoji_id: null, emoji_name: null, moderated: false, ...t, id: t.id ?? snow() }))
      }
      for (const k of ['archived', 'locked']) {
        if (k in patch) {
          c.thread_metadata = { ...c.thread_metadata, [k]: patch[k], ...(k === 'archived' ? { archive_timestamp: iso() } : {}) }
          delete patch[k]
        }
      }
      return Object.assign(c, patch)
    }
    if (is('DELETE', /^\/channels\/(\d+)$/)) {
      const c = byId(m[1])
      db.channels = db.channels.filter((x) => x.id !== m[1])
      return c
    }
    if (is('PUT', /^\/channels\/(\d+)\/permissions\/(\d+)$/)) {
      const c = byId(m[1])
      c.permission_overwrites = [...c.permission_overwrites.filter((o) => o.id !== m[2]), { id: m[2], type: body.type, allow: body.allow, deny: body.deny }]
      return undefined
    }

    if (is('GET', /^\/channels\/(\d+)\/messages$/)) {
      return [...(db.messages.get(m[1]) ?? [])].reverse().slice(0, Number(q.get('limit') ?? 50)).map(redact)
    }
    if (is('POST', /^\/channels\/(\d+)\/messages$/)) {
      if ((body.content ?? '').length > 2000) throw err(400, 50035, 'content too long')
      return msg(m[1], { content: body.content, flags: body.flags ?? 0, author: bot, type: body.message_reference ? 19 : 0 })
    }
    if (is('GET', /^\/channels\/(\d+)\/messages\/(\d+)$/)) {
      const x = findMsg(m[1], m[2])
      if (!x) throw err(404, 10008, 'Unknown Message')
      return redact(x)
    }
    if (is('PATCH', /^\/channels\/(\d+)\/messages\/(\d+)$/)) {
      const x = findMsg(m[1], m[2])
      if (!x) throw err(404, 10008, 'Unknown Message')
      return Object.assign(x, { content: body.content, edited_timestamp: iso() })
    }
    if (is('DELETE', /^\/channels\/(\d+)\/messages\/(\d+)$/)) {
      db.messages.set(m[1], (db.messages.get(m[1]) ?? []).filter((x) => x.id !== m[2]))
      return undefined
    }
    if (is('PUT', /^\/channels\/(\d+)\/messages\/pins\/(\d+)$/)) {
      db.pins.set(m[1], new Set([...(db.pins.get(m[1]) ?? []), m[2]]))
      return undefined
    }

    if (is('POST', /^\/channels\/(\d+)\/invites$/)) {
      if (body.max_age > 604800) throw err(400, 50035, 'max_age too long')
      const roles = (body.role_ids ?? []).map((id) => {
        const r = db.roles.find((x) => x.id === id)
        if (r.position >= botTop()) throw err(403, 50013, 'Missing Permissions')
        return { id: r.id, name: r.name }
      })
      const inv = {
        code: `c${snow().slice(-8)}`, channel: { id: m[1] }, max_uses: body.max_uses ?? 0, max_age: body.max_age ?? 86400,
        uses: 0, created_at: iso(), expires_at: body.max_age ? new Date(Date.now() + body.max_age * 1000).toISOString() : null,
        roles, inviter: bot,
      }
      db.invites.push(inv)
      return inv
    }
    if (is('GET', /^\/guilds\/(\d+)\/invites$/)) return db.invites.filter((i) => !i.max_uses || i.uses < i.max_uses)
    if (is('DELETE', /^\/invites\/(\w+)$/)) {
      const inv = db.invites.find((i) => i.code === m[1])
      if (!inv) throw err(404, 10006, 'Unknown Invite')
      db.invites = db.invites.filter((i) => i !== inv)
      return inv
    }

    if (is('GET', /^\/guilds\/(\d+)\/welcome-screen$/)) return db.welcome ?? { description: null, welcome_channels: [] }
    if (is('PATCH', /^\/guilds\/(\d+)\/welcome-screen$/)) {
      if (!db.guild.features.includes('COMMUNITY')) throw err(400, 50035, 'welcome screen needs community')
      if (strictWelcome && body.welcome_channels.some((w) => hiddenFromEveryone(byId(w.channel_id)))) {
        throw err(400, 50035, 'welcome channel must be visible to everyone')
      }
      db.welcome = { description: body.description, welcome_channels: body.welcome_channels }
      if (body.enabled) db.guild.features = [...new Set([...db.guild.features, 'WELCOME_SCREEN_ENABLED'])]
      return db.welcome
    }

    if (is('GET', /^\/guilds\/(\d+)\/members$/)) {
      if (!(db.app.flags & MEMBERS_INTENT)) throw err(403, 50001, 'Missing Access')
      const after = BigInt(q.get('after') ?? '0')
      return [...db.members].sort((a, b) => (BigInt(a.user.id) < BigInt(b.user.id) ? -1 : 1))
        .filter((x) => BigInt(x.user.id) > after).slice(0, Number(q.get('limit') ?? 1))
    }
    if (is('GET', /^\/guilds\/(\d+)\/members\/search$/)) {
      const s = q.get('query').toLowerCase()
      return db.members.filter((x) => [x.user.username, x.user.global_name, x.nick].some((v) => v?.toLowerCase().startsWith(s))).slice(0, Number(q.get('limit') ?? 1))
    }
    if (is('GET', /^\/guilds\/(\d+)\/members\/(\d+)$/)) {
      const x = member(m[2])
      if (!x) throw err(404, 10007, 'Unknown Member')
      return x
    }
    if (is('PUT', /^\/guilds\/(\d+)\/members\/(\d+)\/roles\/(\d+)$/)) {
      const role = db.roles.find((r) => r.id === m[3])
      if (!role) throw err(404, 10011, 'Unknown Role')
      if (role.position >= botTop()) throw err(403, 50013, 'Missing Permissions')
      const x = member(m[2])
      if (!x.roles.includes(m[3])) x.roles.push(m[3])
      return undefined
    }
    if (is('DELETE', /^\/guilds\/(\d+)\/members\/(\d+)\/roles\/(\d+)$/)) {
      const x = member(m[2])
      x.roles = x.roles.filter((r) => r !== m[3])
      return undefined
    }

    if (is('POST', /^\/channels\/(\d+)\/threads$/)) {
      const forum = byId(m[1])
      if (forum.type !== 15) throw err(400, 50024, 'not a forum')
      if ((body.applied_tags ?? []).some((t) => !forum.available_tags.some((x) => x.id === t))) throw err(400, 50035, 'unknown tag')
      if ((body.message?.content ?? '').length > 2000) throw err(400, 50035, 'content too long')
      return addThread(forum.id, { name: body.name, content: body.message.content, author: bot, tagIds: body.applied_tags ?? [] })
    }
    if (is('GET', /^\/guilds\/(\d+)\/threads\/active$/)) {
      return { threads: db.channels.filter((c) => c.type === 11 && !c.thread_metadata.archived), members: [] }
    }
    if (is('GET', /^\/channels\/(\d+)\/threads\/archived\/public$/)) {
      return { threads: db.channels.filter((c) => c.type === 11 && c.parent_id === m[1] && c.thread_metadata.archived), members: [], has_more: false }
    }

    if (is('POST', /^\/channels\/(\d+)\/webhooks$/)) {
      if (/discord|clyde/i.test(body.name)) throw err(400, 50035, 'bad webhook name')
      const w = { id: snow(), type: 1, name: body.name, channel_id: m[1], guild_id: gid, token: `wh${snow()}` }
      db.webhooks.push(w)
      return w
    }
    if (is('GET', /^\/guilds\/(\d+)\/webhooks$/)) return db.webhooks
    if (is('DELETE', /^\/webhooks\/(\d+)$/)) {
      db.webhooks = db.webhooks.filter((w) => w.id !== m[1])
      return undefined
    }

    throw err(404, 0, `fake: no route ${method} ${path}`)
  }

  // 포럼 글 — 첫 메시지 id 는 스레드 id 와 같다 (디스코드 규칙)
  function addThread(forumId, { name, content, author, tags = [], tagIds, votes = 0 }) {
    const forum = byId(forumId)
    const ids = tagIds ?? tags.map((n) => forum.available_tags.find((t) => t.name === n).id)
    const t = ch({ name, type: 11, parent_id: forumId, applied_tags: ids, owner_id: author.id, message_count: 0, thread_metadata: { archived: false, locked: false } })
    const first = { id: t.id, channel_id: t.id, type: 0, content, author, attachments: [], reactions: votes ? [{ count: votes, emoji: { id: null, name: '👍' } }] : [], flags: 0 }
    db.messages.set(t.id, [first])
    t.last_message_id = t.id
    t.message_count = 1
    return { ...t, message: first }
  }

  async function fetch(url, init = {}) {
    const u = new URL(url)
    const path = u.pathname.replace(/^\/api\/v10/, '')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    db.calls.push([method, path, body])
    const f = failures.find((x) => x.method === method && x.path.test(path) && x.times > 0)
    if (f) {
      f.times--
      if (f.status === 'network') throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
      return new Response(f.body ?? JSON.stringify({ message: 'fail', code: 0, retry_after: 0.01 }), { status: f.status })
    }
    if (path !== '/gateway' && init.headers?.Authorization !== `Bot ${token}`) {
      return new Response(JSON.stringify({ message: '401: Unauthorized', code: 0 }), { status: 401 })
    }
    try {
      const out = route(method, path, body, u.searchParams)
      if (out === undefined) return new Response(null, { status: 204 })
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
    } catch (e) {
      if (e.status) return new Response(JSON.stringify({ code: e.code, message: e.message }), { status: e.status })
      throw e
    }
  }

  return {
    fetch,
    db,
    token,
    byId,
    inviteBot() {
      db.joined = true
      msg(general.id, { type: 7, author: bot })
    },
    // 다음 n 번의 요청을 일부러 실패시킨다 (status: 숫자 또는 'network')
    failNext(method, path, status, times = 1, body) {
      failures.push({ method, path, status, times, body })
    },
    // 테스터가 초대 링크로 들어온다 — 링크의 역할이 붙는다
    join(code, user) {
      const inv = db.invites.find((i) => i.code === code)
      if (!inv || (inv.max_uses && inv.uses >= inv.max_uses)) throw new Error('invalid invite')
      inv.uses++
      const mem = { user, roles: inv.roles.map((r) => r.id), joined_at: iso(), nick: null }
      db.members.push(mem)
      return mem
    },
    addMembers(n) {
      for (let i = 0; i < n; i++) db.members.push({ user: { id: snow(), username: `m${i}` }, roles: [], joined_at: iso(), nick: null })
    },
    addThread,
    addMessage: msg,
    addChannel: ch,
  }
}
