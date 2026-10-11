// 디스코드 권한 비트 (API v10) — server.json 에는 이름으로 쓰고, 여기서 비트로 바꾼다.
// 표에 없는 비트(디스코드가 나중에 추가하는 권한)는 "bits:<10진수>" 로 그대로 보존한다.

export const PERM_BITS = {
  CREATE_INSTANT_INVITE: 0, KICK_MEMBERS: 1, BAN_MEMBERS: 2, ADMINISTRATOR: 3, MANAGE_CHANNELS: 4,
  MANAGE_GUILD: 5, ADD_REACTIONS: 6, VIEW_AUDIT_LOG: 7, PRIORITY_SPEAKER: 8, STREAM: 9,
  VIEW_CHANNEL: 10, SEND_MESSAGES: 11, SEND_TTS_MESSAGES: 12, MANAGE_MESSAGES: 13, EMBED_LINKS: 14,
  ATTACH_FILES: 15, READ_MESSAGE_HISTORY: 16, MENTION_EVERYONE: 17, USE_EXTERNAL_EMOJIS: 18,
  VIEW_GUILD_INSIGHTS: 19, CONNECT: 20, SPEAK: 21, MUTE_MEMBERS: 22, DEAFEN_MEMBERS: 23,
  MOVE_MEMBERS: 24, USE_VAD: 25, CHANGE_NICKNAME: 26, MANAGE_NICKNAMES: 27, MANAGE_ROLES: 28,
  MANAGE_WEBHOOKS: 29, MANAGE_GUILD_EXPRESSIONS: 30, USE_APPLICATION_COMMANDS: 31,
  REQUEST_TO_SPEAK: 32, MANAGE_EVENTS: 33, MANAGE_THREADS: 34, CREATE_PUBLIC_THREADS: 35,
  CREATE_PRIVATE_THREADS: 36, USE_EXTERNAL_STICKERS: 37, SEND_MESSAGES_IN_THREADS: 38,
  USE_EMBEDDED_ACTIVITIES: 39, MODERATE_MEMBERS: 40, VIEW_CREATOR_MONETIZATION_ANALYTICS: 41,
  USE_SOUNDBOARD: 42, CREATE_GUILD_EXPRESSIONS: 43, CREATE_EVENTS: 44, USE_EXTERNAL_SOUNDS: 45,
  SEND_VOICE_MESSAGES: 46, SET_VOICE_CHANNEL_STATUS: 48, SEND_POLLS: 49, USE_EXTERNAL_APPS: 50,
  PIN_MESSAGES: 51, BYPASS_SLOWMODE: 52,
}

// 멤버가 기본으로 할 수 있는 것 — 초대 만들기·@everyone 멘션·이벤트 만들기는 뺐다 (초대는 운영진만)
const MEMBER_BASE = [
  'VIEW_CHANNEL', 'SEND_MESSAGES', 'SEND_MESSAGES_IN_THREADS', 'CREATE_PUBLIC_THREADS',
  'EMBED_LINKS', 'ATTACH_FILES', 'ADD_REACTIONS', 'READ_MESSAGE_HISTORY',
  'USE_EXTERNAL_EMOJIS', 'USE_EXTERNAL_STICKERS', 'USE_APPLICATION_COMMANDS', 'USE_EXTERNAL_APPS',
  'SEND_VOICE_MESSAGES', 'SEND_POLLS', 'CHANGE_NICKNAME',
  'CONNECT', 'SPEAK', 'STREAM', 'USE_VAD', 'USE_EMBEDDED_ACTIVITIES', 'USE_SOUNDBOARD',
  'USE_EXTERNAL_SOUNDS', 'REQUEST_TO_SPEAK',
]

// server.everyone / roles.*.permissions 에 쓸 수 있는 이름표
export const PRESETS = {
  everyone: {
    safe: MEMBER_BASE, // 닫힌 서버: 멤버는 초대 링크를 못 만든다
    open: [...MEMBER_BASE, 'CREATE_INSTANT_INVITE'], // 열린 커뮤니티: 멤버가 친구를 부를 수 있다
  },
  role: {
    none: [],
    moderator: [
      'KICK_MEMBERS', 'BAN_MEMBERS', 'MODERATE_MEMBERS', 'MANAGE_NICKNAMES', 'VIEW_AUDIT_LOG',
      'MANAGE_MESSAGES', 'MANAGE_THREADS', 'PIN_MESSAGES', 'BYPASS_SLOWMODE', 'MENTION_EVERYONE',
      'CREATE_INSTANT_INVITE', 'CREATE_PRIVATE_THREADS', 'MANAGE_EVENTS', 'CREATE_EVENTS',
      'PRIORITY_SPEAKER', 'MUTE_MEMBERS', 'MOVE_MEMBERS', 'DEAFEN_MEMBERS',
    ],
    admin: ['ADMINISTRATOR'],
  },
}

export const isPermName = (n) => n in PERM_BITS || /^bits:\d+$/.test(n)

export function perms(...names) {
  let v = 0n
  for (const n of names.flat()) {
    if (n in PERM_BITS) v |= 1n << BigInt(PERM_BITS[n])
    else if (/^bits:\d+$/.test(n)) v |= BigInt(n.slice(5))
    else throw new Error(`모르는 권한 이름: ${n}`)
  }
  return v
}

// 비트 → 이름 목록 (adopt 가 쓴다). 모르는 비트는 bits:<값> 하나로 묶어 보존
export function permNames(value) {
  let rest = BigInt(value)
  const out = []
  for (const [name, bit] of Object.entries(PERM_BITS)) {
    const b = 1n << BigInt(bit)
    if (rest & b) {
      out.push(name)
      rest &= ~b
    }
  }
  if (rest) out.push(`bits:${rest}`)
  return out
}

export const ADMIN = 1n << 3n
