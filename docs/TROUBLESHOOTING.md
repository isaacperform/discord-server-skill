# 막혔을 때

**먼저 `ds doctor`.** 무엇이 빠졌는지와 다음에 할 일을 순서대로 알려 주고, 고칠 수 있는 건(특권 인텐트) 바로 고친다.
오류 메시지 끝의 `👉` 줄이 그 오류의 해결책이다. 아래는 그 목록과 사람이 손대야 하는 경우.

> `ds` = `node <스킬 폴더>/scripts/discord.mjs`

## 시작 단계

| 증상 | 원인 | 해결 |
|---|---|---|
| `node: command not found` · Node 18 미만 | Node.js 없음 | https://nodejs.org LTS 설치 · macOS `brew install node` · Windows `winget install OpenJS.NodeJS.LTS` · Ubuntu `sudo apt install nodejs` (버전이 낮으면 nvm) |
| "봇이 서버를 만들 수 없어요"를 보고 놀람 | 디스코드가 2025-07-15 봇의 서버 생성(`POST /guilds`)을 없앴다 | 서버는 디스코드 앱에서 직접: 왼쪽 **+** → **직접 만들기**. 나머지는 전부 봇이 한다 |
| `클립보드에 봇 토큰이 없어요` | 다른 걸 복사했거나, Copy 전에 Reset 만 눌렀다 | 개발자 포털 → Bot → **Reset Token** → **Copy** 직후 바로 `ds token` |
| `클립보드를 읽지 못했어요` (Linux) | 클립보드 도구 없음 | `sudo apt install wl-clipboard` (Wayland) 또는 `xclip` · 아니면 터미널에서 `ds token --prompt` · 또는 파일로 저장 후 `ds token --file <파일>` |
| SSH·원격 서버라 클립보드가 없음 | 원격에는 내 클립보드가 없다 | 원격 터미널에서 `ds token --prompt` (숨김 입력) |
| Reset Token 이 2단계 인증 코드를 물음 | 디스코드 계정 보호 | 인증 앱 코드를 넣으면 된다. 2단계 인증이 없으면 비밀번호를 묻는다 |
| 토큰을 채팅·저장소에 올려 버림 | — | **즉시 Reset Token** 으로 새로 발급하고 `ds token` 다시. 예전 토큰은 그 순간 죽는다 |
| `디스코드가 이 토큰을 거절했어요 (401)` | 토큰을 다시 발급해 예전 것이 죽었거나 일부만 복사 | Reset Token → Copy → `ds token` |
| 봇 초대 화면에 내 서버가 안 보임 | 그 서버에서 '서버 관리' 권한이 없다 | 서버 소유자 계정으로 열거나, 소유자에게 권한을 받는다 |
| `봇이 아직 서버에 없어요` | 초대 링크를 안 열었거나 다른 서버를 골랐다 | `ds bot-invite` 링크를 열어 맞는 서버를 고르고 **승인** |
| `봇이 서버 N곳에 있어요` | 한 봇을 여러 서버에 넣었다 | `--guild <서버ID>` 로 한 번 고르면 기억한다. 서버마다 프로필을 따로 두는 게 깔끔하다 (`--profile`) |
| `봇에 관리자 권한이 없어요` | 초대할 때 Administrator 를 뺐다 | `ds bot-invite` 링크로 다시 승인 (Administrator 가 들어 있다) |

## 세팅 단계

| 증상 | 원인 | 해결 |
|---|---|---|
| `server.json 에 고칠 곳이 N개` | 디스코드가 거절할 설계도 | 메시지대로 고치고 `ds validate` — 형식은 [SPEC.md](SPEC.md) |
| `50013 Missing Permissions` | 봇 권한 부족 또는 **역할 순서**: 봇은 자기보다 아래 역할만 부여한다 | 서버 설정 → 역할에서 봇 역할을 맨 위로 끌어 올린다 · `ds doctor` 가 확인해 준다 |
| `50001 Missing Access` | 봇이 그 채널을 못 본다 · 특권 인텐트 꺼짐 | 관리자 권한으로 다시 초대 · `ds whoami` (인텐트를 켠다) |
| 특권 인텐트를 API 로 못 켰다 | 봇이 100개 넘는 서버에 있거나 디스코드가 거절 | 개발자 포털 → Bot → Privileged Gateway Intents → **SERVER MEMBERS INTENT** · **MESSAGE CONTENT INTENT** 켜고 Save |
| `50024` 공지 채널을 못 만듦 | 커뮤니티 서버가 아니다 | `server.community: true` + `rulesChannel`·`updatesChannel` 지정 → setup 이 커뮤니티를 켠다 |
| `60003 Two factor is required` | 서버가 관리 작업에 2단계 인증을 요구 | 봇을 만든 디스코드 계정에 2단계 인증을 켜거나, 서버 설정 → 안전 설정에서 요구를 끈다 |
| 환영 화면이 일부 채널만 나옴 · `WELCOME_CHANNEL_PERMISSIONS_REQUIRED` | 디스코드 규칙: 환영 화면 채널은 모두가 읽을 수 있어야 한다 | 정상 동작 — 가린 채널은 빼고 걸었다. 넣으려면 그 채널을 `visibleTo: "everyone"` 으로 |
| `doctor`: 봇 역할이 ○○ 보다 아래 | 사람이 디스코드에서 먼저 만든 역할이 봇 역할보다 위 (봇은 자기보다 아래 역할만 부여) | 서버 설정 → 역할에서 봇 역할을 그 위로 끌어 올린다. setup 이 만든 역할은 해당 없음 — 같은 순번이면 먼저 들어온 봇이 위다 |
| 채널이 두 번 생김 | `state.json` 을 지웠거나 다른 프로필로 돌렸다 | 중복된 것을 디스코드에서 지우고 `ds adopt --force` 로 다시 묶거나 state.json 복구 |
| setup 이 손으로 바꾼 권한을 되돌림 | 설계도가 원천이다 | 원하는 규칙을 server.json 에 쓰고 setup. 손으로만 바꾸지 않는다 |
| 서버 기본 채널(일반)이 남아 있음 | setup 은 지우지 않는다 | `ds prune` 으로 목록 확인 → `ds prune --yes` (서버와 같이 생긴 기본 채널 + 사람 메시지 0 만 지운다) |

## 운영 단계

| 증상 | 원인 | 해결 |
|---|---|---|
| 봇이 계속 "오프라인" | Gateway 를 안 쓰는 설계 (상주 서버 0) | 정상. 기능에는 영향이 없다 |
| 새 멤버에게 환영 DM 이 안 감 | 입장 이벤트는 Gateway 로만 온다 | 환영 화면·환영 채널 고정 글·시스템 입장 메시지로 대신한다 |
| 초대로 들어왔는데 역할이 없음 | 디스코드 앱에서 직접 만든 링크(역할 없음)로 들어왔다 | `ds grant <멤버>` · 초대는 `ds invite` 로 만든다 (`ds invites` 에 "역할 자동 부여 없음" 표시) |
| 피드백 내용이 빈칸으로 나옴 | MESSAGE CONTENT 인텐트 꺼짐 (REST 읽기에도 적용) | `ds whoami` 가 켠다 · 안 되면 포털에서 켠다 |
| `members` 가 403 | SERVER MEMBERS 인텐트 꺼짐 | 위와 같다 |
| 초대를 7일 넘게 못 만듦 | 디스코드 한도 | `--days 0` = 만료 없음 |
| 보관된 포럼 글 태그가 안 바뀜 | 보관 스레드는 꺼내야 고칠 수 있다 | `ds tag` 가 알아서 꺼낸다 · 잠긴 글은 `--open` |
| 웹훅 이름 거절 | 이름에 `discord`·`clyde` 금지 | 다른 이름으로 |
| 고정(pin) 실패 | 2026-02-23 부터 `PIN_MESSAGES` 권한이 따로 분리 | 봇이 관리자면 해당 없음. 운영진 역할에는 `moderator` 프리셋에 들어 있다 |

## 네트워크

| 증상 | 해결 |
|---|---|
| `디스코드에 연결하지 못했어요` | 인터넷·방화벽 확인. 회사망 프록시는 `HTTPS_PROXY=http://프록시:포트` 와 `NODE_USE_ENV_PROXY=1` (Node 24+) |
| `Cloudflare 가 요청을 막았어요` (HTML 응답, 1015) | 짧은 시간에 요청이 몰렸거나 IP 가 막힘. 몇 분 뒤 다시 · VPN 끄기·바꾸기 |
| 5xx | 디스코드 장애 — https://discordstatus.com · 읽기 요청은 알아서 다시 시도한다 (글쓰기는 두 번 올라가지 않게 다시 보내지 않는다) |

## 그래도 안 되면

`ds api GET /users/@me` 처럼 원시 요청으로 범위를 좁히고, 오류 전문과 `ds doctor` 결과를 이슈로 남겨 주세요 (토큰·웹훅 주소는 지우고): https://github.com/isaacperform/discord-server-skill/issues
