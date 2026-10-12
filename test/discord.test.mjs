// node --test test/discord.test.mjs — 가짜 디스코드(test/fake-discord.mjs)를 상대로 CLI 를 끝까지 돌린다.
// 진짜 서버에서의 첫 실행이 곧 스모크 테스트다. 여기서는 흐름·멱등·안전장치·막힘 안내를 지킨다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeDiscord } from './fake-discord.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = mkdtempSync(join(tmpdir(), 'discord-server-test-'))
process.env.DISCORD_SERVER_HOME = home
for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_PROFILE', 'DISCORD_SERVER_DIR']) delete process.env[k]

let fake = createFakeDiscord({ joined: false })
globalThis.fetch = fake.fetch
const { run, splitMessage, parseArgs } = await import('../scripts/discord.mjs')
const { looksLikeBotToken } = await import('../scripts/lib/clipboard.mjs')
const { validate, normalize, buildOverwrites, accessRules } = await import('../scripts/lib/spec.mjs')
const { perms, permNames } = await import('../scripts/lib/perms.mjs')
const { ApiError, HdError, createApi } = await import('../scripts/lib/api.mjs')

async function cli(...argv) {
  const out = []
  const log = console.log
  console.log = (...a) => out.push(a.join(' '))
  try {
    await run(argv)
  } finally {
    console.log = log
  }
  return out.join('\n')
}
const dir = (p) => join(home, p)
const state = (p) => JSON.parse(readFileSync(join(dir(p), 'state.json'), 'utf8'))
const spec = (p) => JSON.parse(readFileSync(join(dir(p), 'server.json'), 'utf8'))
const writesSince = (f, n) => f.db.calls.slice(n).filter(([m]) => m !== 'GET')
const tokenFile = (f) => {
  const file = join(home, `token-${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(file, f.token)
  return file
}
const ow = (c, id) => c.permission_overwrites.find((o) => o.id === id)
const has = (v, bit) => (BigInt(v ?? '0') & (1n << BigInt(bit))) !== 0n
const VIEW = 10
const SEND = 11
const setVar = (p, k, v) => {
  const s = spec(p)
  s.vars[k] = v
  writeFileSync(join(dir(p), 'server.json'), JSON.stringify(s, null, 2))
}

// ---------- 단위 ----------
test('splitMessage — 2000자 안으로, 내용은 그대로', () => {
  const text = Array.from({ length: 80 }, (_, i) => `${i + 1}번 문단 `.repeat(6)).join('\n\n')
  const parts = splitMessage(text)
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 2000))
  assert.equal(parts.join('').replace(/\s/g, ''), text.replace(/\s/g, ''))
  assert.deepEqual(splitMessage('짧은 글'), ['짧은 글'])
})

test('looksLikeBotToken — 봇 토큰만 받고 JWT·잡글은 거른다 (남의 키를 디스코드로 보내지 않게)', () => {
  assert.ok(looksLikeBotToken(fake.token))
  assert.ok(!looksLikeBotToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'))
  assert.ok(!looksLikeBotToken('그냥 복사한 글'))
  assert.ok(!looksLikeBotToken(''))
})

test('perms ↔ permNames — 모르는 비트도 보존한다', () => {
  const v = perms('VIEW_CHANNEL', 'SEND_MESSAGES') | (1n << 60n)
  const names = permNames(v)
  assert.deepEqual(names.slice(0, 2), ['VIEW_CHANNEL', 'SEND_MESSAGES'])
  assert.match(names.at(-1), /^bits:\d+$/)
  assert.equal(perms(names), v)
  assert.throws(() => perms('NOT_A_PERMISSION'))
})

test('parseArgs — --k v · --k=v · 불리언 · -- 뒤는 글', () => {
  const { args, opts } = parseArgs(['post', 'lounge', '--note=김 OO', '--ping', '--days', '3', '--', '--이건 글'])
  assert.deepEqual(args, ['post', 'lounge', '--이건 글'])
  assert.deepEqual(opts, { note: '김 OO', ping: true, days: '3' })
})

test('buildOverwrites — 같은 대상의 나중 규칙이 앞 규칙을 덮는다', () => {
  const [o] = buildOverwrites([['@everyone', { deny: ['VIEW_CHANNEL', 'SEND_MESSAGES'] }], ['@everyone', { allow: ['SEND_MESSAGES'] }]], { everyone: '1', roles: {} })
  assert.equal(o.deny, String(perms('VIEW_CHANNEL')))
  assert.equal(o.allow, String(perms('SEND_MESSAGES')))
})

test('템플릿 6종 — 모두 검사 통과 (오류 0)', () => {
  const root = join(ROOT, 'templates')
  let n = 0
  for (const t of readdirSync(root)) {
    for (const lang of readdirSync(join(root, t))) {
      const d = join(root, t, lang)
      const s = normalize(JSON.parse(readFileSync(join(d, 'server.json'), 'utf8')))
      const { errors } = validate(s, d)
      assert.deepEqual(errors, [], `${t}/${lang}`)
      assert.ok(existsSync(join(d, 'NOTES.md')), `${t}/${lang} NOTES.md`)
      n++
    }
  }
  assert.ok(n >= 6)
})

test('validate — 디스코드가 거절할 설계도를 미리 사람 말로 잡는다', () => {
  const bad = normalize({
    server: { name: 'x', community: false },
    roles: { member: { name: '멤버' } },
    categories: [
      { key: 'a', name: 'A', visibleTo: ['nobody'], channels: [
        { key: 'news', name: 'news', type: 'announcement' },
        { key: 'f', name: 'f', type: 'forum', tags: Array.from({ length: 21 }, (_, i) => ({ name: `t${i}` })) },
      ] },
      { key: 'a', name: 'B', channels: [{ key: 'news', name: 'dup', type: 'text' }] },
    ],
    welcomeScreen: { channels: [] },
    invite: { days: 30 },
  })
  const { errors } = validate(bad)
  const all = errors.join('\n')
  for (const needle of ['커뮤니티', 'nobody', '20개', '두 번', 'invite.days', 'welcomeScreen']) assert.match(all, new RegExp(needle))
  const community = validate(normalize({ server: { name: 'x', community: true }, categories: [] })).errors.join('\n')
  assert.match(community, /rulesChannel/)
})

test('accessRules — visibleTo 에 staff 는 늘 들어가고, readonly "comments" 는 댓글을 남긴다', () => {
  const s = normalize({ server: { name: 'x' }, roles: { staff: { name: 's', staff: true }, m: { name: 'm' } }, categories: [] })
  const rules = accessRules(s, { visibleTo: ['m'] }, { key: 'lib', type: 'forum', readonly: 'comments' })
  const targets = rules.map(([t]) => t)
  assert.ok(targets.includes('staff') && targets.includes('m'))
  const everyoneDeny = rules.filter(([t]) => t === '@everyone').flatMap(([, r]) => r.deny ?? [])
  assert.ok(everyoneDeny.includes('SEND_MESSAGES') && !everyoneDeny.includes('SEND_MESSAGES_IN_THREADS'))
})

test('설치 경로가 심링크여도(~/.claude/skills → 작업 폴더) CLI 가 돈다 — Node 는 메인 파일을 실제 경로로 읽는다', () => {
  const link = join(mkdtempSync(join(tmpdir(), 'skill-link-')), 'discord-server')
  symlinkSync(ROOT, link, process.platform === 'win32' ? 'junction' : 'dir')
  const out = execFileSync(process.execPath, [join(link, 'scripts', 'discord.mjs'), 'help'], { encoding: 'utf8' })
  assert.match(out, /discord-server .* 말로 디스코드 서버를/)
})

// ---------- 처음부터 끝까지 (클로즈베타) ----------
test('doctor — 아무것도 없으면 다음 할 일을 순서대로', async () => {
  const out = await cli('doctor')
  assert.match(out, /server\.json 없음/)
  assert.match(out, /다음에 할 일/)
})

test('init — 템플릿으로 프로필을 만들고, 덮어쓰기는 --force 일 때만', async () => {
  const out = await cli('init', '--template', 'closed-beta', '--name', 'my-beta', '--profile', 'beta')
  assert.match(out, /프로필 'beta'/)
  for (const f of ['server.json', 'content/welcome.md', 'NOTES.md', '.gitignore']) assert.ok(existsSync(join(dir('beta'), f)), f)
  assert.equal(spec('beta').server.name, 'my-beta')
  await assert.rejects(cli('init', '--profile', 'beta'), /--force/)
  await cli('init', '--profile', 'beta', '--name', 'my-beta', '--force')
  assert.ok(existsSync(join(dir('beta'), 'server.json.bak')))
  await assert.rejects(cli('init', '--template', 'nope', '--profile', 'x'), /있는 것/)
})

test('token — JWT 는 거절, 진짜 토큰은 600 파일로 저장하고 봇 초대 링크를 준다', async () => {
  const jwt = join(home, 'jwt.txt')
  writeFileSync(jwt, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')
  const n = fake.db.calls.length
  await assert.rejects(cli('token', '--file', jwt, '--profile', 'beta'), /봇 토큰이 없어요/)
  assert.equal(fake.db.calls.length, n, 'JWT 는 디스코드로 보내지 않는다')
  const out = await cli('token', '--file', tokenFile(fake), '--profile', 'beta')
  assert.match(out, /토큰 저장/)
  assert.match(out, /oauth2\/authorize\?client_id=\d+&permissions=8/)
  const env = join(dir('beta'), '.env')
  assert.match(readFileSync(env, 'utf8'), /^DISCORD_BOT_TOKEN=/m)
  if (process.platform !== 'win32') assert.equal(statSync(env).mode & 0o777, 0o600)
  assert.ok(fake.db.app.flags & (1 << 15) && fake.db.app.flags & (1 << 19), '특권 인텐트를 API 로 켰다')
})

test('setup — 봇이 서버에 없으면 초대 링크를 알려 주고 멈춘다', async () => {
  await assert.rejects(cli('setup', '--profile', 'beta'), /봇이 아직 서버에 없어요[\s\S]*oauth2/)
  fake.inviteBot()
})

test('setup --dry — 아무것도 쓰지 않는다', async () => {
  const n = fake.db.calls.length
  const out = await cli('setup', '--dry', '--profile', 'beta')
  assert.deepEqual(writesSince(fake, n), [])
  assert.match(out, /dry-run/)
})

test('setup — 빈 서버를 설계도대로 세운다', async () => {
  setVar('beta', 'app', 'https://my-app.test')
  const out = await cli('setup', '--profile', 'beta')
  assert.ok(!out.includes('⚠️'), out)
  const s = state('beta')
  const { db } = fake
  assert.ok(s.roles.staff && s.roles.tester)
  assert.ok(db.guild.features.includes('COMMUNITY'))
  assert.equal(db.guild.rules_channel_id, s.channels.welcome)
  assert.equal(db.guild.public_updates_channel_id, s.channels['ops-log'])
  assert.equal(db.guild.safety_alerts_channel_id, s.channels['ops-log'])
  assert.equal(db.guild.system_channel_id, s.channels.lounge)
  assert.equal(db.guild.system_channel_flags, 52)
  assert.equal(db.guild.default_message_notifications, 1)
  assert.equal(Object.keys(s.categories).length, 3)
  assert.equal(Object.keys(s.channels).length, 10)

  const everyone = db.roles.find((r) => r.id === db.guild.id)
  assert.ok(!has(everyone.permissions, 0) && !has(everyone.permissions, 17), 'safe: 초대 만들기·@everyone 멘션 없음')
  const beta = fake.byId(s.categories.beta)
  assert.ok(has(ow(beta, db.guild.id).deny, VIEW) && has(ow(beta, s.roles.tester).allow, VIEW) && has(ow(beta, s.roles.staff).allow, VIEW))
  const ops = fake.byId(s.channels['ops-log'])
  assert.ok(has(ow(ops, db.guild.id).deny, VIEW) && ow(ops, s.roles.tester) === undefined)
  const updates = fake.byId(s.channels.updates)
  assert.equal(updates.type, 5)
  assert.ok(has(ow(updates, db.guild.id).deny, SEND) && !has(ow(updates, s.roles.tester).allow, SEND) && has(ow(updates, s.roles.staff).allow, SEND))
  const welcome = fake.byId(s.channels.welcome)
  assert.ok(has(ow(welcome, db.guild.id).deny, SEND) && !has(ow(welcome, db.guild.id).deny, VIEW))
  const bugs = fake.byId(s.channels.bugs)
  assert.equal(bugs.type, 15)
  assert.ok(bugs.available_tags.find((t) => t.name === '해결됨' && t.moderated && t.emoji_name === '✅'))
  assert.equal(bugs.default_reaction_emoji.emoji_name, '👍')
  const [w] = db.messages.get(s.channels.welcome)
  assert.ok(w.content.includes(`<#${s.channels.bugs}>`) && w.content.includes('https://my-app.test') && !w.content.includes('{{'))
  assert.equal(w.flags & 4, 4, '고정 글은 링크 미리보기를 끈다')
  assert.ok(db.members.find((m) => m.user.id === db.guild.owner_id).roles.includes(s.roles.staff))
  assert.equal(db.welcome.welcome_channels.length, 2, '가린 서버의 환영 화면은 모두가 보는 채널만')
  assert.ok(fake.byId(s.categories.start).position < fake.byId(s.categories.beta).position)
  assert.equal(db.app.description, spec('beta').bot.description)
})

test('setup 두 번째 — 쓰기 0번 (멱등)', async () => {
  const n = fake.db.calls.length
  await cli('setup', '--profile', 'beta')
  assert.deepEqual(writesSince(fake, n), [])
})

test('setup — 누가 접근 규칙을 바꿔 놓으면 되돌리고, 고정 글은 제자리 수정·지워지면 다시 게시', async () => {
  const s = state('beta')
  const beta = fake.byId(s.categories.beta)
  beta.permission_overwrites = beta.permission_overwrites.filter((o) => o.id !== fake.db.guild.id)
  fake.db.messages.get(s.channels.welcome)[0].content = '옛 문구'
  await cli('setup', '--profile', 'beta')
  assert.ok(has(ow(fake.byId(s.categories.beta), fake.db.guild.id).deny, VIEW))
  const [w] = fake.db.messages.get(s.channels.welcome)
  assert.notEqual(w.content, '옛 문구')
  assert.equal(w.id, state('beta').messages.welcome.ids[0])
  fake.db.messages.set(s.channels.welcome, [])
  await cli('setup', '--profile', 'beta')
  assert.equal(fake.db.messages.get(s.channels.welcome).length, 1)
})

test('doctor — 다 세팅되면 막힌 곳 없음', async () => {
  const out = await cli('doctor', '--profile', 'beta')
  assert.ok(!out.includes('❌'), out)
  assert.match(out, /막힌 곳 없음/)
})

test('prune — 서버 기본 채널 중 사람 메시지 0 인 것만, --yes 일 때만 지운다', async () => {
  const voice = fake.db.channels.find((c) => c.name === '일반' && c.type === 2)
  fake.addMessage(voice.id, { author: { id: '42', username: 'someone' }, content: '안녕하세요' })
  const later = fake.addChannel({ name: '내가-만든-채널', type: 0 }, 15 * 60 * 1000)
  assert.match(await cli('prune', '--profile', 'beta'), /prune --yes/)
  assert.ok(fake.db.channels.some((c) => c.name === '채팅 채널'))
  await cli('prune', '--yes', '--profile', 'beta')
  const names = fake.db.channels.map((c) => c.name)
  assert.ok(!names.includes('채팅 채널') && !fake.db.channels.some((c) => c.name === '일반' && c.type === 0))
  assert.ok(fake.byId(voice.id) && names.includes('음성 채널'), '사람 메시지가 있는 기본 채널과 그 카테고리는 남긴다')
  assert.ok(fake.byId(later.id), '나중에 만든 채널은 절대 안 지운다')
  for (const id of [...Object.values(state('beta').channels), ...Object.values(state('beta').categories)]) assert.ok(fake.byId(id))
})

test('invite — 1회·7일·베타테스터 자동 부여, 원장 기록, 들어오면 역할이 붙는다', async () => {
  const out = await cli('invite', '--note', '김테스트 (쇼핑몰)', '--profile', 'beta')
  const s = state('beta')
  const inv = fake.db.invites.at(-1)
  assert.equal(inv.max_uses, 1)
  assert.equal(inv.max_age, 604800)
  assert.deepEqual(inv.roles.map((r) => r.id), [s.roles.tester])
  assert.ok(out.includes(`discord.gg/${inv.code}`) && !out.includes('⚠️'))
  const ledgerFile = join(dir('beta'), 'invites.json')
  assert.equal(JSON.parse(readFileSync(ledgerFile, 'utf8')).at(-1).note, '김테스트 (쇼핑몰)')
  if (process.platform !== 'win32') assert.equal(statSync(ledgerFile).mode & 0o777, 0o600)
  assert.match(await cli('invites', '--profile', 'beta'), /대기/)
  fake.join(inv.code, { id: '9000000000000000001', username: 'kimtest', global_name: '김테스트' })
  assert.ok(fake.db.members.find((m) => m.user.username === 'kimtest').roles.includes(s.roles.tester))
  assert.match(await cli('invites', '--profile', 'beta'), /사용됨 1/)
  await assert.rejects(cli('invite', '--days', '30', '--profile', 'beta'), /최대 7일/)
  const three = await cli('invite', '--count', '3', '--note', '이벤트', '--profile', 'beta')
  assert.equal(three.split('\n').filter((l) => l.includes('discord.gg/')).length, 3)
  await cli('uninvite', `https://discord.gg/${fake.db.invites.at(-1).code}`, '--profile', 'beta')
  assert.match(await cli('invites', '--profile', 'beta'), /취소 1/)
})

test('post · edit — 2000자 넘으면 나누고, @everyone 은 --ping 일 때만', async () => {
  const s = state('beta')
  const n = fake.db.calls.length
  await cli('post', 'updates', Array.from({ length: 70 }, (_, i) => `- ${i + 1}번 변경: 화면 정리`.repeat(2)).join('\n'), '--profile', 'beta')
  const posts = writesSince(fake, n).filter(([m, p]) => m === 'POST' && p === `/channels/${s.channels.updates}/messages`)
  assert.ok(posts.length >= 2 && posts.every(([, , b]) => b.content.length <= 2000 && !b.allowed_mentions.parse.includes('everyone')))
  const out = await cli('post', '공지', '점검 안내: 오늘 밤 10시', '--ping', '--profile', 'beta')
  const [, , last] = fake.db.calls.filter(([m, p]) => m === 'POST' && p === `/channels/${s.channels.notice}/messages`).at(-1)
  assert.ok(last.content.startsWith('@everyone') && last.allowed_mentions.parse.includes('everyone'))
  const msgId = out.match(/메시지 (\d+)/)[1]
  await cli('edit', 'notice', msgId, '점검 안내: 오늘 밤 11시로 바뀌었어요', '--profile', 'beta')
  assert.match(fake.db.messages.get(s.channels.notice).find((m) => m.id === msgId).content, /11시/)
  await assert.rejects(cli('post', '없는채널', '안녕', '--profile', 'beta'), /못 찾았어요/)
})

test('forum · feedback · tag · reply · read — 제보를 읽고 상태 태그는 하나만 남긴다', async () => {
  const s = state('beta')
  await cli('forum', 'qna', '설치 FAQ', '코드는 head 안에 넣어요', '--tags', '설치', '--profile', 'beta')
  assert.equal(fake.db.channels.filter((c) => c.type === 11 && c.parent_id === s.channels.qna).at(-1).applied_tags.length, 1)
  const t = fake.addThread(s.channels.bugs, {
    name: '[화면] 저장이 안 돼요', content: '저장 버튼을 눌러도 그대로예요',
    author: { id: '9000000000000000001', username: 'kimtest', global_name: '김테스트' }, tags: ['화면'], votes: 2,
  })
  const fb = await cli('feedback', '--profile', 'beta')
  assert.ok(fb.includes('[화면] 저장이 안 돼요') && fb.includes('저장 버튼을 눌러도 그대로예요') && fb.includes('👍 2'))
  const bugs = fake.byId(s.channels.bugs)
  const tagNames = () => fake.byId(t.id).applied_tags.map((id) => bugs.available_tags.find((x) => x.id === id).name).sort()
  await cli('tag', t.id, '+접수', '--profile', 'beta')
  await cli('tag', t.id, '+해결됨', '--close', '--profile', 'beta')
  assert.deepEqual(tagNames(), ['해결됨', '화면'].sort())
  assert.equal(fake.byId(t.id).thread_metadata.archived, true)
  await cli('tag', t.id, '+확인중', '--profile', 'beta')
  assert.deepEqual(tagNames(), ['확인중', '화면'].sort())
  assert.match(await cli('feedback', '--all', '--profile', 'beta'), /저장 버튼/)
  await cli('reply', t.id, '<@9000000000000000001> 고쳤어요!', '--profile', 'beta')
  assert.equal(fake.db.messages.get(t.id).length, 2)
  assert.match(await cli('read', t.id, '--profile', 'beta'), /고쳤어요/)
})

test('grant · revoke · members — 이름으로 찾아 역할을 붙이고 떼고, 1000명 넘어도 다 센다', async () => {
  const s = state('beta')
  await cli('grant', 'kimtest', 'staff', '--profile', 'beta')
  assert.ok(fake.db.members.find((m) => m.user.username === 'kimtest').roles.includes(s.roles.staff))
  await cli('revoke', '김테스트', 'staff', '--profile', 'beta')
  assert.ok(!fake.db.members.find((m) => m.user.username === 'kimtest').roles.includes(s.roles.staff))
  fake.addMembers(1005)
  const out = await cli('members', '--profile', 'beta')
  assert.match(out, new RegExp(`\\n${fake.db.members.length}명`))
  assert.match(out, /베타테스터 1명/)
  await assert.rejects(cli('grant', '없는사람', '--profile', 'beta'), /못 찾았어요/)
})

test('webhook · icon · avatar · rename — 연동과 꾸미기', async () => {
  await assert.rejects(cli('webhook', 'ops-log', '--name', 'discord-bot', '--profile', 'beta'), /discord/)
  const out = await cli('webhook', 'ops-log', '--name', '가입 알림', '--profile', 'beta')
  assert.match(out, /discord\.com\/api\/webhooks\/\d+\/wh\d+/)
  assert.ok(!(await cli('webhooks', '--profile', 'beta')).includes(fake.db.webhooks[0].token), '목록에선 토큰을 가린다')
  await cli('unwebhook', fake.db.webhooks[0].id, '--profile', 'beta')
  assert.equal(fake.db.webhooks.length, 0)
  const png = join(home, 'icon.png')
  writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))
  await cli('icon', png, '--profile', 'beta')
  assert.match(fake.db.guild.icon, /^data:image\/png;base64,/)
  await cli('avatar', png, '--profile', 'beta')
  assert.match(fake.db.me.avatar, /^data:image\/png;base64,/)
  await cli('rename', 'my-renamed-server', '--profile', 'beta')
  assert.equal(fake.db.guild.name, 'my-renamed-server')
  assert.equal(spec('beta').server.name, 'my-renamed-server')
})

test('api — {guild} 치환, 204 는 성공', async () => {
  const out = await cli('api', 'GET', '/guilds/{guild}/roles', '--profile', 'beta')
  assert.ok(JSON.parse(out).some((r) => r.name === '🧪 베타테스터'))
  const s = state('beta')
  assert.match(await cli('api', 'PUT', `/channels/${s.channels.lounge}/messages/pins/${s.messages.welcome.ids[0]}`, '--profile', 'beta'), /204/)
})

test('adopt — 이미 있는 서버를 가져오면, 바로 setup 해도 쓰기 0번', async () => {
  await cli('token', '--file', tokenFile(fake), '--profile', 'adopted')
  const out = await cli('adopt', '--profile', 'adopted')
  assert.match(out, /가져옴/)
  const s = normalize(spec('adopted'))
  assert.deepEqual(validate(s, dir('adopted')).errors, [])
  assert.ok(s.categories.some((c) => c.channels.some((ch) => ch.type === 'forum' && ch.tags.some((t) => t.staffOnly))))
  const n = fake.db.calls.length
  await cli('setup', '--profile', 'adopted')
  assert.deepEqual(writesSince(fake, n), [])
  await assert.rejects(cli('adopt', '--profile', 'adopted'), /--force/)
})

test('profiles — 여럿이면 목록을 보여 주고, 고르지 않으면 묻는다', async () => {
  const out = await cli('profiles')
  assert.match(out, /beta/)
  assert.match(out, /adopted/)
  await assert.rejects(cli('ids'), /--profile/)
})

// ---------- 다른 템플릿 · 막힘 ----------
async function freshServer(profile, template, opts = {}) {
  fake = createFakeDiscord(opts)
  globalThis.fetch = fake.fetch
  await cli('init', '--template', template, '--profile', profile, ...(opts.lang ? ['--lang', opts.lang] : []))
  await cli('token', '--file', tokenFile(fake), '--profile', profile)
  const s = spec(profile)
  for (const k of Object.keys(s.vars)) setVar(profile, k, 'https://my.test')
  return fake
}

test('community 템플릿 — 열린 서버: 멤버도 초대 가능, 역할 없이 무기한 링크, 자료실은 운영진만 글쓰기', async () => {
  const f = await freshServer('comm', 'community')
  const out = await cli('setup', '--profile', 'comm')
  assert.ok(!out.includes('⚠️'), out)
  const s = state('comm')
  const everyone = f.db.roles.find((r) => r.id === f.db.guild.id)
  assert.ok(has(everyone.permissions, 0), 'open: 멤버도 초대 링크를 만든다')
  const lib = f.byId(s.channels.resources)
  assert.ok(has(ow(lib, f.db.guild.id).deny, SEND) && !has(ow(lib, f.db.guild.id).deny, 38), '자료실: 새 글은 운영진만, 댓글은 모두')
  assert.equal(f.byId(s.channels.introductions).rate_limit_per_user, 60)
  await cli('invite', '--profile', 'comm')
  const inv = f.db.invites.at(-1)
  assert.equal(inv.max_uses, 0)
  assert.equal(inv.max_age, 0)
  assert.deepEqual(inv.roles, [])
  const n = f.db.calls.length
  await cli('setup', '--profile', 'comm')
  assert.deepEqual(writesSince(f, n), [])
})

test('course 템플릿 (영어) — 고정 글 2개, 수강생만 강의실, 다시 돌리면 쓰기 0번', async () => {
  const f = await freshServer('class', 'course', { lang: 'en' })
  const out = await cli('setup', '--profile', 'class')
  assert.ok(!out.includes('⚠️'), out)
  const s = state('class')
  assert.equal(f.db.messages.get(s.channels.curriculum).length, 1)
  assert.match(f.db.messages.get(s.channels.curriculum)[0].content, new RegExp(`<#${s.channels.lessons}>`))
  assert.ok(has(ow(f.byId(s.categories.class), f.db.guild.id).deny, VIEW))
  const n = f.db.calls.length
  await cli('setup', '--profile', 'class')
  assert.deepEqual(writesSince(f, n), [])
})

test('환영 화면에 가린 채널을 넣어도 — 검사가 미리 경고하고, 디스코드가 거절하면 모두가 보는 채널만으로 — 나머지는 끝까지, 다시 돌리면 쓰기 0번', async () => {
  const f = await freshServer('strict', 'closed-beta')
  const sj = spec('strict')
  sj.welcomeScreen.channels.push({ channel: 'lounge', emoji: '💬', description: '인사' })
  writeFileSync(join(dir('strict'), 'server.json'), JSON.stringify(sj, null, 2))
  const out = await cli('setup', '--profile', 'strict')
  assert.match(out, /'lounge' 는 역할로 가려져 있어 빠져요/)
  assert.match(out, /모두가 보는 채널만/)
  const s = state('strict')
  assert.deepEqual(f.db.welcome.welcome_channels.map((w) => w.channel_id), [s.channels.welcome, s.channels.notice])
  assert.equal(f.db.messages.get(s.channels.welcome).length, 1)
  const n = f.db.calls.length
  await cli('setup', '--profile', 'strict')
  assert.deepEqual(writesSince(f, n), [])
})

test('막힘 — 429 는 기다렸다 다시, 502 는 다시, 쓰기의 500·네트워크 오류는 다시 보내지 않는다', async () => {
  fake.failNext('GET', /^\/users\/@me$/, 429, 1)
  fake.failNext('GET', /^\/applications\/@me$/, 502, 2)
  assert.match(await cli('whoami', '--profile', 'strict'), /봇 testbot/)
  const s = state('strict')
  fake.failNext('POST', new RegExp(`^/channels/${s.channels.lounge}/messages$`), 500, 1)
  const before = fake.db.messages.get(s.channels.lounge)?.length ?? 0
  await assert.rejects(cli('post', 'lounge', '안녕', '--profile', 'strict'), /500[\s\S]*👉/)
  assert.equal(fake.db.messages.get(s.channels.lounge)?.length ?? 0, before, '실패한 쓰기를 몰래 다시 보내지 않는다')
  fake.failNext('POST', new RegExp(`^/channels/${s.channels.lounge}/messages$`), 'network', 1)
  await assert.rejects(cli('post', 'lounge', '안녕', '--profile', 'strict'), /연결하지 못했어요[\s\S]*HTTPS_PROXY/)
})

test('막힘 — 디스코드 오류 코드는 다음에 할 일로 바뀐다', () => {
  const e = new ApiError('PUT', '/x', 403, JSON.stringify({ code: 50013, message: 'Missing Permissions' }))
  assert.match(e.message, /Administrator/)
  assert.match(new ApiError('GET', '/x', 401, JSON.stringify({ code: 0, message: '401: Unauthorized' })).message, /Reset Token/)
  assert.match(new ApiError('GET', '/x', 403, '<html>cloudflare error code: 1015</html>').message, /Cloudflare/)
  assert.match(new ApiError('PATCH', '/x', 400, JSON.stringify({ code: 50035, errors: { name: { _errors: [{ code: 'BASE_TYPE_BAD_LENGTH' }] } } })).message, /세부/)
  assert.match(new ApiError('POST', '/x', 403, JSON.stringify({ code: 60003, message: 'Two factor is required' })).message, /2단계 인증/)
})

test('막힘 — 토큰이 죽었으면 doctor 가 재발급을 안내한다', async () => {
  writeFileSync(join(dir('strict'), '.env'), `DISCORD_BOT_TOKEN=${Buffer.from('123456789012345678').toString('base64')}.AAAAAA.${'y'.repeat(38)}\n`)
  const out = await cli('doctor', '--profile', 'strict')
  assert.match(out, /토큰이 거절됐어요/)
  assert.match(out, /Reset Token/)
  const api = createApi({ userAgent: 't', getToken: () => 'x' })
  assert.equal(typeof api.req, 'function')
  assert.ok(new HdError('x') instanceof Error)
})
