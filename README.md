# Discord 서버 스킬 — 말로 만들고, 봇으로 운영

> Claude Code 에 **"클로즈베타용 디스코드 서버 만들어줘"** 라고 말하면 채널·역할·포럼·권한을 한 번에 세팅하고,
> 그 뒤로는 공지·초대·피드백 정리를 대화로 시키는 스킬입니다. 의존성 0 · 서버비 0 · 토큰은 내 컴퓨터에만.

<p>
  <a href="https://github.com/isaacperform/discord-server-skill/actions/workflows/test.yml"><img alt="test" src="https://github.com/isaacperform/discord-server-skill/actions/workflows/test.yml/badge.svg"></a>
  <img alt="Claude Code skill" src="https://img.shields.io/badge/Claude%20Code-skill-D97757">
  <img alt="Agent Skills 표준" src="https://img.shields.io/badge/SKILL.md-agent%20skills-blue">
  <img alt="Node 18+" src="https://img.shields.io/badge/node-%E2%89%A518-339933">
  <img alt="언어" src="https://img.shields.io/badge/lang-%ED%95%9C%EA%B5%AD%EC%96%B4%20%7C%20English-lightgrey">
</p>

---

## 무엇을 하나요

| 할 수 있는 것 | 이렇게 말하면 돼요 |
|---|---|
| 서버 구조를 한 번에 (카테고리·채널·포럼·태그·권한·환영 화면·고정 글) | "클로즈베타용 디스코드 서버 만들어줘. 이름은 마이베타" |
| 들어오면 역할이 바로 붙는 초대 링크 | "베타테스터 초대 링크 5개 만들어줘" |
| 공지·업데이트 로그 | "오늘 배포한 거 업데이트 로그에 올려줘" |
| 포럼 피드백 모아 읽기 | "이번 주 버그 제보 정리해줘" |
| 답글·상태 태그 | "그 버그 해결됨으로 바꾸고 고쳤다고 답 달아줘" |
| 내 앱 → 디스코드 알림 | "가입 알림 웹훅 만들어줘" |
| 이미 있는 서버 가져오기 | "지금 내 서버 구조 가져와서 관리해줘" |
| 그 밖의 모든 디스코드 작업 | 원시 REST(`api`)로 뭐든 |

### 템플릿 3종 (한국어 · English)

| 템플릿 | 이런 서버 | 구조 |
|---|---|---|
| `closed-beta` | 출시 전 베타테스터 모임 | 시작(환영·공지) · 🧪 베타 전용(업데이트·버그 제보·기능 제안·질문·후기·잡담·오피스아워) · 운영 |
| `community` | 누구나 들어오는 열린 커뮤니티 | 시작 · 커뮤니티(자기소개·잡담·질문·자랑·건의) · 자료실(운영진만 글쓰기, 댓글은 모두) · 음성 · 운영 |
| `course` | 유료 강의·멤버십 | 시작 · 📚 수강생 전용(커리큘럼·강의 자료·과제 제출·질문) · 커뮤니티 · 라이브 · 운영 |

템플릿은 출발점이에요. "채널 하나 더", "이건 수강생만 보이게" 처럼 말하면 Claude 가 설계도를 고쳐서 반영합니다.

---

## 설치 (1분)

필요한 것: **Claude Code** · **Node.js 18 이상** (`node -v` 로 확인 — 없으면 https://nodejs.org) · git

### 방법 A. Claude Code 에게 맡기기 (권장)

Claude Code 에 이 문장을 그대로 붙여넣으세요.

```
https://github.com/isaacperform/discord-server-skill 저장소를 ~/.claude/skills/discord-server 에 git clone 해서 스킬로 설치해줘
```

**새 세션**을 열어 `/` 를 쳤을 때 `discord-server` 가 보이면 성공입니다.

### 방법 B. 플러그인으로

Claude Code 안에서:

```
/plugin marketplace add isaacperform/discord-server-skill
/plugin install discord-server@discord-server-skill
```

### 방법 C. 터미널에서 직접

```bash
# macOS · Linux
git clone https://github.com/isaacperform/discord-server-skill ~/.claude/skills/discord-server
```

```powershell
# Windows (PowerShell)
git clone https://github.com/isaacperform/discord-server-skill "$env:USERPROFILE\.claude\skills\discord-server"
```

업데이트는 `git -C ~/.claude/skills/discord-server pull` (플러그인은 `/plugin` 에서 업데이트).

> 폴더가 `discord-server/discord-server-skill/SKILL.md` 처럼 두 겹이 되면 인식되지 않아요. `SKILL.md` 가 `~/.claude/skills/discord-server/` 바로 아래에 있어야 합니다.

---

## 사용법

새 세션에서 이렇게 말하세요.

```
디스코드 서버 만들어줘. 클로즈베타용이고 이름은 마이베타, 앱 주소는 https://내앱.com
```

Claude 가 템플릿으로 설계도를 만들고, 원하는 대로 고친 뒤, 아래 **사람만 할 수 있는 일**을 순서대로 안내합니다.

### 사람이 해야 하는 일 (딱 한 번, 5분)

디스코드 정책상 **봇은 서버를 만들 수 없고**(2025-07-15 부터), 봇 토큰은 본인 로그인으로만 받을 수 있어요. 그래서 이것만 직접 합니다.

1. **서버 만들기** — 디스코드 앱 왼쪽 **+**(서버 추가하기) → **직접 만들기** → 이름 정하고 만들기
2. **앱 만들기** — https://discord.com/developers/applications → **New Application** → 이름 → **Create**
3. **토큰 복사** — 왼쪽 **Bot** → **Reset Token** → **Yes, do it!** → **Copy**
4. Claude 에게 **"복사했어"** 라고만 말하기 — 토큰은 채팅에 붙이지 마세요. Claude 가 클립보드에서 읽어 내 컴퓨터에 저장하고 클립보드를 비웁니다
5. Claude 가 주는 **초대 링크**를 열어 1)의 서버를 고르고 **승인**

나머지(커뮤니티 기능 켜기, 특권 인텐트 켜기, 채널·역할·포럼·권한, 환영 화면, 기본 채널 정리)는 전부 봇이 합니다.

### 그다음부터

```
베타테스터 초대 링크 3개 만들어줘. 김OO, 이OO, 박OO 용으로
이번 주 피드백 정리해줘
업데이트 로그 올려줘: 로그인 버그 고침, 다크모드 추가
❓질문-답변에 올라온 거 중에 답 안 달린 거 보여줘
```

---

## 명령 (터미널에서 직접 써도 돼요)

```bash
node ~/.claude/skills/discord-server/scripts/discord.mjs help
```

| 명령 | 하는 일 |
|---|---|
| `doctor` | **막힌 곳 점검** + 다음에 할 일 (먼저 이것) |
| `init --template closed-beta --lang ko --name 이름` | 템플릿으로 설계도 만들기 |
| `token` | 클립보드의 봇 토큰 저장 (`--prompt` 숨김 입력 · `--file` 파일) |
| `setup [--dry]` | 설계도대로 서버 맞추기 (몇 번 돌려도 안전) |
| `prune [--yes]` | 디스코드가 만든 기본 채널 정리 |
| `adopt` | 이미 있는 서버를 설계도로 가져오기 |
| `post` · `edit` · `forum` · `reply` | 글·포럼 글·답글 |
| `invite` · `invites` · `uninvite` | 역할 붙는 초대 링크와 현황 |
| `members` · `grant` · `revoke` | 멤버와 역할 |
| `feedback` · `read` · `tag` | 포럼 피드백 읽기 · 상태 태그 |
| `webhook` · `webhooks` · `unwebhook` | 내 앱 → 디스코드 알림 주소 (주소는 가려서 보여 주고 클립보드로 · `--raw` 파이프용 · `--reveal`) |
| `rename` · `icon` · `avatar` | 서버 이름 · 아이콘 · 봇 사진 |
| `api <METHOD> <경로>` | 그 밖의 모든 디스코드 API |

서버를 여러 개 운영하면 `--profile <이름>` 으로 나눕니다. 설계도 형식은 [docs/SPEC.md](docs/SPEC.md).

---

## 어떻게 동작하나요

- **서버 하나 = 프로필 하나.** `~/.config/discord-server/<프로필>/` 에 `server.json`(설계도) · `content/`(고정 글) · `NOTES.md`(이 서버 운영 메모 — Claude 가 작업 전에 읽음) · `state.json` · `.env`(토큰)가 있어요.
- **설계도가 원천.** `setup` 은 없는 것만 만들고 아무것도 지우지 않아요. 같은 걸 두 번 돌리면 두 번째는 아무것도 안 바뀌는 게 정상입니다. 누가 손으로 권한을 바꿔도 다음 setup 이 설계도대로 되돌려요.
- **클로즈 게이팅 = 역할 부여 초대 링크.** 링크로 들어온 순간 역할이 붙어서 그 역할만 보는 채널이 열려요. 1회용·7일 기본.
- **REST 만 써요 (Gateway 없음).** 상주 서버가 없어서 서버비가 0 이고, 그래서 봇은 늘 "오프라인"으로 보여요(정상). 입장 환영 DM 은 못 보내는 대신 환영 화면·고정 글·입장 메시지를 씁니다.

## 보안

- **토큰**: 클립보드에서 읽어 `.env`(권한 600)에만 저장하고 클립보드를 비웁니다. 출력·로그에 남기지 않아요. 클립보드의 내용이 디스코드 봇 토큰 모양(첫 조각이 봇 ID)이 아니면 디스코드로 보내지도 않아요 — 다른 서비스 키(JWT)를 실수로 복사해도 새지 않게.
- **봇 권한은 관리자(Administrator).** 커뮤니티 기능을 켜는 데 디스코드가 관리자 권한을 요구하고, "말하면 다 되는" 운영을 위해서예요. 대신 토큰을 비밀번호처럼 다루세요. 새면 개발자 포털에서 **Reset Token** 한 번으로 예전 토큰이 죽습니다.
- **웹훅 주소는 비밀.** 주소를 아는 누구나 그 채널에 글을 쓸 수 있어요. 앱 환경변수에만 넣으세요.
- **데이터는 내 컴퓨터와 디스코드 사이에서만** 오갑니다. 다른 서버로 보내지 않아요.

## 막히면

`doctor` 가 빠진 것과 다음에 할 일을 순서대로 알려 주고, 모든 오류에는 `👉` 해결책이 붙어 나와요. 전체 목록: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## 자주 묻는 것

- **봇이 오프라인이에요.** 정상이에요 (Gateway 를 안 쓰는 설계). 기능엔 영향이 없어요.
- **결제하면 자동으로 역할이 붙게 할 수 있나요?** 이 스킬은 상주 서버가 없어서 결제 웹훅을 직접 받지 않아요. 결제를 확인하고 `invite` 로 1회용 링크를 보내는 게 가장 간단하고, 자동화가 필요하면 결제사 웹훅 → (Cloudflare Worker 등) → 디스코드 역할 부여 API 를 따로 붙이면 됩니다.
- **다른 에이전트(Codex·Cursor 등)에서도 되나요?** `SKILL.md` 는 Agent Skills 표준이라 로드는 돼요. CLI 는 그냥 Node 스크립트라 셸을 실행할 수 있는 에이전트면 다 쓸 수 있어요. 단 `${CLAUDE_SKILL_DIR}` 치환은 Claude Code 기능이라, 다른 에이전트에선 스킬 폴더 경로를 직접 써 주세요.
- **이미 운영 중인 서버도 되나요?** 네. 토큰 저장 → 봇 초대 → `adopt` 로 지금 구조를 설계도로 가져오면, 그 뒤로는 바뀐 것만 반영돼요.

---

## English

Tell Claude Code **"set up a Discord server for my closed beta"** and it builds the whole structure (categories, channels, forums with tags, permissions, welcome screen, pinned guides), then runs the server for you: role-granting invite links, announcements, feedback triage, replies, status tags, webhooks, and any other Discord REST call. Zero dependencies, no hosting, the token stays on your machine.

```bash
git clone https://github.com/isaacperform/discord-server-skill ~/.claude/skills/discord-server
```

Then, in a new Claude Code session: *"Create a Discord server for my community, in English."* Templates: `closed-beta`, `community`, `course` (`--lang en`). The only manual steps Discord requires: create the server in the Discord app, create an application at https://discord.com/developers/applications, and copy the bot token (Bot → Reset Token → Copy). Claude reads it from your clipboard, so never paste it into the chat. Stuck? Run `doctor`; every error ends with a 👉 fix. CLI messages are in Korean; Claude translates them for you.

---

## 개발

```bash
node --test test/discord.test.mjs
```

네트워크 없이 가짜 디스코드(`test/fake-discord.mjs`)를 상대로 처음부터 끝까지 돌립니다. 가짜는 진짜 디스코드가 거절하는 규칙(커뮤니티 전 공지 채널, 특권 인텐트, 역할 위계, 보관된 스레드, 2000자, 초대 7일 …)을 똑같이 거절해요.

```
.
├── SKILL.md                 Claude 가 읽는 운영 절차
├── scripts/discord.mjs      CLI (명령 31개)
├── scripts/lib/             REST 클라이언트 · 설계도 검사 · 권한 · 클립보드
├── templates/<종류>/<언어>/  server.json · content/*.md · NOTES.md
├── docs/                    SPEC.md (설계도 형식) · TROUBLESHOOTING.md
├── test/                    가짜 디스코드 + 테스트
└── .claude-plugin/          플러그인·마켓플레이스 등록 정보
```

## 주의

- 이 스킬은 **사용자 본인의 봇 토큰**으로 동작합니다. 서버에 반영되는 모든 변경의 책임은 실행하는 사용자에게 있어요. 처음엔 `setup --dry` 로 미리 보세요.
- Discord · Anthropic 의 공식 스킬이 아닌 개인 제작 스킬입니다.

## 라이선스

[LICENSE](./LICENSE) 참고. 개인·업무용 사용과 수정은 자유롭고, 이 스킬 자체를 재판매하거나 재배포하는 것은 제한됩니다.

## 만든 사람

**이삭 (Isaac Kim)** - 퍼포먼스 마케팅 / CRO / 그로스
문의·개선 제안은 [Issues](../../issues) 로 남겨주세요.
