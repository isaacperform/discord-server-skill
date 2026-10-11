// Discord REST 클라이언트 — 이 도구의 모든 호출이 여기를 지난다.
// 막힘을 줄이는 장치: 429 는 retry_after 만큼 기다렸다 다시 · 502 와 GET 의 5xx·네트워크 오류는 물러섰다 다시 ·
// 30초 시간 제한 · 쓰기에는 감사 로그 사유 · 실패하면 디스코드 오류 코드를 '다음에 할 일' 로 바꿔 보여 준다.

export const API_BASE = 'https://discord.com/api/v10'

// 사용자에게 그대로 보여 줄 오류 (스택 없이)
export class HdError extends Error {}
export const fail = (msg) => {
  throw new HdError(msg)
}

export const HINT_NETWORK =
  '인터넷 연결·방화벽을 확인하세요. 회사망이라 프록시를 써야 하면 HTTPS_PROXY 를 설정하고 NODE_USE_ENV_PROXY=1 을 함께 주세요 (Node 24+). VPN 을 켜고 끄며 다시 해 보세요.'
const HINT_CLOUDFLARE =
  '디스코드 앞단(Cloudflare)이 요청을 막았어요. 몇 분 뒤 다시 해 보고, 계속되면 VPN·프록시를 끄거나 다른 네트워크에서 하세요.'

// 디스코드 JSON 오류 코드 → 다음에 할 일
const CODE_HINTS = {
  0: '토큰이 틀렸거나 재발급돼 예전 토큰이 죽었어요 → 개발자 포털 Bot → Reset Token → Copy 한 뒤 token 명령',
  10003: '채널이 없어요 (지워졌거나 다른 서버) → ids 로 지금 채널을 확인하세요',
  10004: '봇이 이 서버에 없어요 → whoami 가 초대 링크를 알려 줘요',
  10006: '없거나 만료된 초대 코드예요',
  10007: '서버에 없는 멤버예요 → members 로 확인',
  10008: '메시지가 없어요 (지워졌을 수 있어요)',
  10011: '역할이 없어요 → setup 을 다시 돌리세요',
  10013: '모르는 사용자예요',
  10014: '모르는 이모지예요 — 포럼 태그·반응에는 유니코드 이모지만 쓰세요',
  10015: '웹훅이 없어요 → webhooks 로 확인',
  20012: '이 앱을 고칠 권한이 없어요 — 토큰이 다른 앱의 것인지 확인하세요',
  30005: '역할이 250개 한도에 걸렸어요',
  30013: '채널이 500개 한도에 걸렸어요',
  30007: '이 채널의 웹훅이 15개 한도에 걸렸어요',
  40001: '인증 실패 → token 명령으로 토큰을 다시 저장하세요',
  50001: '볼 권한이 없어요 — 봇을 관리자 권한으로 초대했는지, 특권 인텐트가 켜졌는지 확인 → doctor',
  50013: '권한이 모자라요 — 봇이 관리자(Administrator)로 초대됐는지, 서버 설정 → 역할에서 봇 역할이 대상 역할보다 위에 있는지 확인 → doctor',
  50024: '이 채널 종류에서는 안 되는 작업이에요 (공지·스테이지 채널은 커뮤니티 서버에서만)',
  50035: '보낸 값이 틀렸어요 — 아래 세부 내용을 보고 server.json 을 고친 뒤 validate',
  50083: '보관된 스레드예요 — tag/edit 전에 꺼내야 해요 (tag ... --open)',
  50109: 'JSON 형식이 틀렸어요',
  60003: '이 서버는 관리 작업에 2단계 인증을 요구해요 — 봇을 만든 디스코드 계정에 2단계 인증을 켜거나, 서버 설정 → 안전 설정에서 그 요구를 끄세요',
  160005: '잠긴 스레드예요 — tag ... --open 으로 다시 여세요',
}
function hintFor(status, code) {
  if (code !== undefined && CODE_HINTS[code] && !(code === 0 && status !== 401)) return CODE_HINTS[code]
  if (status === 401) return CODE_HINTS[0]
  if (status === 403) return CODE_HINTS[50013]
  if (status === 404) return '대상이 없어요 — ID·이름을 다시 확인하세요 (ids)'
  if (status >= 500) return '디스코드 쪽 장애예요. https://discordstatus.com 을 보고 잠시 뒤 다시 해 보세요'
  return null
}

export class ApiError extends Error {
  constructor(method, path, status, text) {
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}
    const blocked = !json && /<html|cloudflare|error code: 10\d\d/i.test(text)
    let msg = `${method} ${path} → ${status}`
    if (json) msg += `${json.code !== undefined ? ` (${json.code})` : ''} ${json.message ?? ''}`.trimEnd()
    else if (text && !blocked) msg += ` ${text.slice(0, 200)}`
    if (json?.errors) msg += `\n   세부: ${JSON.stringify(json.errors).slice(0, 600)}`
    const hint = blocked ? HINT_CLOUDFLARE : hintFor(status, json?.code)
    if (hint) msg += `\n   👉 ${hint}`
    super(msg)
    this.status = status
    this.code = json?.code
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// getToken 은 처음 필요할 때 부른다 — 토큰이 필요 없는 명령은 토큰 없이도 돈다
export function createApi({ getToken, dry = false, userAgent, log = console.log, timeoutMs = 30000 }) {
  let reason = 'discord-server-skill'
  let dryN = 0
  async function req(method, path, body, { query, auth = true } = {}) {
    if (dry && method !== 'GET') {
      log(`  · [dry] ${method} ${path}${body ? ' ' + JSON.stringify(body).slice(0, 140) : ''}`)
      return Array.isArray(body) ? null : { id: `dry${++dryN}`, ...(body ?? {}) }
    }
    const url = API_BASE + path + (query ? '?' + new URLSearchParams(query) : '')
    const headers = { 'User-Agent': userAgent }
    if (auth) headers.Authorization = `Bot ${getToken()}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (method !== 'GET') headers['X-Audit-Log-Reason'] = encodeURIComponent(reason)
    for (let attempt = 0; ; attempt++) {
      let res
      try {
        res = await fetch(url, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (e) {
        // 보낸 뒤 끊겼을 수 있는 쓰기는 다시 보내지 않는다 (글이 두 번 올라가는 사고 방지)
        if (method === 'GET' && attempt < 2) {
          await sleep(1000 * (attempt + 1))
          continue
        }
        const why = e.name === 'TimeoutError' ? `${timeoutMs / 1000}초 안에 답이 없음` : (e.cause?.code ?? e.message)
        throw new HdError(`디스코드에 연결하지 못했어요 (${method} ${path}: ${why})\n   👉 ${HINT_NETWORK}`)
      }
      if (res.status === 429 && attempt < 6) {
        const d = await res.json().catch(() => ({}))
        await sleep(Math.ceil(Number(d.retry_after ?? res.headers.get('retry-after') ?? 1) * 1000) + 250)
        continue
      }
      // 502 는 처리 전 실패라 어떤 요청이든 다시, 나머지 5xx 는 읽기만 다시
      if ((res.status === 502 || (res.status >= 500 && method === 'GET')) && attempt < 3) {
        await sleep(800 * 2 ** attempt)
        continue
      }
      if (res.status === 204) return null
      const text = await res.text()
      if (!res.ok) throw new ApiError(method, path, res.status, text)
      return text ? JSON.parse(text) : null
    }
  }
  return {
    req,
    setReason(r) {
      reason = r
    },
  }
}

export const installUrl = (appId) =>
  `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=8&integration_type=0&scope=bot+applications.commands`
