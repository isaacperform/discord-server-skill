# server.json — 서버 설계도 레퍼런스

`ds setup` 은 이 파일대로 서버를 맞춘다. **없는 것만 만들고 아무것도 지우지 않는다.** 이미 있는 채널은 접근 규칙·주제·슬로모드·포럼 태그(더하기만)를 맞춘다.
채널은 이름이 아니라 **key** 로 `state.json` 에 묶이므로, 디스코드에서 이름을 바꿔도 중복 생성되지 않는다.
고친 뒤에는 늘 `ds validate` → `ds setup --dry` → `ds setup`.

```jsonc
{
  "version": 1,
  "server": { … },        // 서버 전체 설정
  "bot": { "description": "봇 프로필 소개 (선택)" },
  "vars": { "app": "https://내앱.com" },   // 글 안의 {{app}} 를 이 값으로
  "roles": { … },          // 역할
  "categories": [ … ],     // 카테고리 → 채널
  "messages": [ … ],       // 봇이 관리하는 고정 글
  "welcomeScreen": { … },  // 새 멤버 환영 화면 (커뮤니티 서버)
  "invite": { … },         // invite 명령 기본값
  "feedback": ["bugs"]     // feedback 명령이 읽을 포럼 key
}
```

## server

| 필드 | 뜻 | 기본 |
|---|---|---|
| `name` | **필수.** 봇이 들어간 서버 중 이 이름의 서버를 고른다 (setup 이 이름을 바꾸지는 않는다 — 바꾸려면 `ds rename`) | |
| `community` | 커뮤니티 기능 켜기. 공지·스테이지 채널, 환영 화면에 필요. 켜면 인증 수준 ≥ 낮음, 콘텐츠 필터 '모든 멤버' 로 맞춘다 | `false` |
| `rulesChannel` · `updatesChannel` | 커뮤니티 필수. 규칙 채널 · 디스코드가 보내는 커뮤니티 안내를 받을 채널 (둘 다 **텍스트** 채널 key) | |
| `safetyChannel` | 레이드·스팸 경보 채널 (커뮤니티) | |
| `systemChannel` | "OO님이 들어왔어요" 입장 메시지 채널 | |
| `systemChannelFlags` | 시스템 메시지 끄기 비트. `52` = 서버 설정 팁·역할 구독 알림 끔 (입장·부스트 알림은 남김) | 손대지 않음 |
| `everyone` | @everyone 기본 권한. `"safe"` 멤버는 초대 링크 못 만듦 · `"open"` 멤버도 초대 가능 · `"keep"` 손대지 않음 · 권한 이름 배열 | `"keep"` |
| `notifications` | 기본 알림: `"mentions"`(@멘션만, 커뮤니티 권장) · `"all"` | 손대지 않음 |
| `description` · `locale` | 서버 소개 · 언어 (`ko`, `en-US` …) — 커뮤니티 서버에서만 | |

## roles

```json
"roles": {
  "staff":  { "name": "🛠️ 운영진", "color": "#F2A65A", "hoist": true, "staff": true, "giveOwner": true, "permissions": "moderator" },
  "tester": { "name": "🧪 베타테스터", "color": "#7E82DF", "hoist": true }
}
```

| 필드 | 뜻 |
|---|---|
| key (`staff`) | 명령·규칙에서 부르는 이름. 글자·숫자·`-`·`_` |
| `name` · `color`(`#RRGGBB`) · `hoist`(멤버 목록에 따로 표시) · `mentionable` | 디스코드 역할 설정 |
| `permissions` | `"none"`(기본) · `"moderator"`(메시지·스레드·멤버 관리, 초대·이벤트) · `"admin"`(관리자 — 권장 안 함) · 권한 이름 배열 |
| `staff: true` | 운영진 — 가린 카테고리를 늘 보고, 읽기 전용 채널에 쓴다 |
| `giveOwner: true` | setup 이 서버 소유자에게 붙인다 |

역할은 **만들기만** 한다 (이미 있으면 색·권한을 바꾸지 않는다). 봇이 만든 역할은 봇 역할 아래에 생겨서 봇이 부여할 수 있다.

## categories · channels

```json
{ "key": "beta", "name": "🧪 베타", "visibleTo": ["tester"], "channels": [
  { "key": "updates", "name": "🚀업데이트-로그", "type": "announcement", "readonly": true, "topic": "…" },
  { "key": "bugs", "name": "🐛버그-제보", "type": "forum", "reaction": "👍", "topic": "글쓰기 안내",
    "tags": [ { "name": "화면" }, { "name": "해결됨", "emoji": "✅", "staffOnly": true } ] },
  { "key": "lounge", "name": "💬잡담", "type": "text", "slowmode": 10 },
  { "key": "office", "name": "🎧오피스아워", "type": "voice" }
] }
```

| 필드 | 뜻 |
|---|---|
| `key` | 카테고리·채널 **전체에서** 겹치면 안 된다 |
| `name` | 카테고리 `name: null` = 카테고리 없이 맨 위에 두는 채널 묶음. 텍스트류 채널 이름의 대문자·공백은 디스코드가 소문자·`-` 로 바꾼다 |
| `type` | `text` · `announcement`(공지, 커뮤니티) · `forum` · `voice` · `stage`(커뮤니티) |
| `topic` | 채널 주제 (텍스트 1024자 · 포럼은 글쓰기 안내 4096자) |
| `visibleTo` | `"everyone"`(기본) 또는 역할 key 배열 — 목록 밖은 못 본다. **staff 역할은 늘 본다.** 채널에 쓰면 카테고리 값을 덮는다 |
| `readonly` | `true` = 운영진만 쓴다 · `"comments"` = 새 글·스레드는 운영진만, 스레드 안 댓글은 모두 (포럼 자료실) |
| `slowmode` | 같은 사람이 다시 쓰기까지 초 (0~21600) |
| `reaction` · `tags` · `sort` · `layout` | 포럼만. 기본 반응 이모지 · 태그(최대 20, 이름 20자, `staffOnly` = 운영진만 붙임) · `"activity"`(기본)/`"created"` · `"list"`(기본)/`"gallery"` |
| `permissions` | 세부 규칙: `{ "대상": { "allow": [...], "deny": [...] } }` — 대상은 `"@everyone"` 또는 역할 key. 위 규칙 뒤에 덧붙는다 |
| `inherit: false` | 카테고리 규칙을 물려받지 않는다 (`adopt` 가 동기화 안 된 채널에 쓴다) |

권한 이름은 디스코드 API 이름 그대로다 (`VIEW_CHANNEL`, `SEND_MESSAGES`, `SEND_MESSAGES_IN_THREADS`, `CREATE_PUBLIC_THREADS`, `ATTACH_FILES`, `ADD_REACTIONS`, `MANAGE_MESSAGES`, `PIN_MESSAGES` …) — 전체 목록은 `scripts/lib/perms.mjs`. 표에 없는 비트는 `"bits:<10진수>"` 로 쓴다.

## messages (고정 글)

```json
{ "key": "welcome", "channel": "welcome", "file": "content/welcome.md", "pin": false, "embeds": false }
```

- 파일 안 치환: `{{이름}}` = `vars.이름` · `{{#채널key}}` = 채널 링크 · `{{@&역할key}}` = 역할 멘션
- 파일을 고치고 setup 하면 **같은 메시지를 제자리에서** 고친다. 지워졌거나 2000자를 넘어 조각 수가 바뀌면 다시 올린다
- `embeds: false`(기본) = 링크 미리보기를 끈다 · `pin: true` = 고정

## welcomeScreen (커뮤니티)

```json
{ "description": "140자 이내", "channels": [ { "channel": "welcome", "emoji": "👋", "description": "시작하는 법" } ] }
```

채널은 5개까지. 디스코드가 역할로 가린 채널을 거절하면 모두가 보는 채널만으로 다시 건다 (setup 은 멈추지 않는다).

## invite

```json
{ "channel": "welcome", "roles": ["tester"], "maxUses": 1, "days": 7 }
```

`ds invite` 의 기본값. `roles` = 링크로 들어오면 바로 붙는 역할 (클로즈 게이팅). `maxUses` 0 = 무제한 · `days` 0~7 (0 = 만료 없음, 디스코드 한도 7일).
