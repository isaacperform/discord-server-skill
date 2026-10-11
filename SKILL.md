---
name: discord-server
description: 말로 디스코드 서버를 만들고 봇으로 운영한다 — 채널·역할·포럼·권한을 설계도(server.json)대로 한 번에 세팅(템플릿 클로즈베타·커뮤니티·강의), 봇 토큰 연동, 들어오면 역할이 붙는 초대 링크, 공지·업데이트 게시, 포럼 피드백 수집·답변·상태 태그, 웹훅으로 앱 알림, 이미 있는 서버 가져오기, 그 밖의 모든 Discord REST. Use when the user wants to create, set up, or run a Discord server, community, or bot — 디스코드 서버 만들어줘, 디스코드 채널 만들어, 디스코드 봇 연동, 디스코드에 공지 올려줘, 초대 링크 만들어, 디스코드 피드백 정리, 디스코드 역할 줘, 디스코드 웹훅, discord server setup, create discord channels, discord bot, post to discord, discord invite link, discord webhook.
license: See LICENSE — free to use and modify, no resale or redistribution without permission
compatibility: Requires Node.js 18+ and internet access to discord.com
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/discord.mjs *) Bash(node "${CLAUDE_SKILL_DIR}/scripts/discord.mjs" *)
---

# discord-server — Claude Code 에서 디스코드 서버 만들고 운영하기

모든 작업은 CLI 하나로 한다 (아래 `ds` 는 이 줄의 줄임):

```bash
node "${CLAUDE_SKILL_DIR}/scripts/discord.mjs" <명령> [--profile 이름]
```

- 서버 하나 = 프로필 하나 → `~/.config/discord-server/<프로필>/` 에 `server.json`(설계도) · `content/`(고정 글) · `NOTES.md`(운영 메모) · `state.json` · `.env`(토큰).
- **작업 전에 그 프로필의 `NOTES.md` 를 읽는다.** 말투·알림 규칙·글 형식은 서버마다 다르다.
- **막히면 먼저 `ds doctor`.** 빠진 것과 다음에 할 일을 순서대로 알려 준다. 오류의 `👉` 줄이 해결책이다. 그래도 막히면 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
- 봇은 Gateway 없이 REST 로만 움직인다 → 상주 서버 0, 봇은 늘 "오프라인" 표시(정상). 입장 환영 DM 은 못 보낸다 — 대신 환영 화면·고정 글·역할 부여 초대를 쓴다.

## 1. 새 서버 세팅

1. `ds doctor`
2. 사용자에게 **한 번에** 묻는다: 서버 용도(클로즈베타 · 커뮤니티 · 강의/멤버십 · 기타) · 서버 이름 · 언어(ko/en) · 안내에 넣을 주소(앱·사이트)
3. `ds init --template closed-beta|community|course --lang ko|en --name "서버 이름" --profile <짧은-영문>`
4. 요구에 맞게 `server.json`·`content/*.md` 를 고치고 `ds validate` — 형식은 [docs/SPEC.md](docs/SPEC.md). `vars` 의 `example.com` 은 꼭 바꾼다.
5. **사람만 할 수 있는 일**(디스코드 정책: 봇은 서버를 못 만들고, 토큰은 본인 로그인으로만 나온다)을 이대로 안내한다:
   > 1) 디스코드 앱 왼쪽 **+**(서버 추가하기) → **직접 만들기** → 이름 정하고 만들기
   > 2) https://discord.com/developers/applications → **New Application** → 이름 → **Create**
   > 3) 왼쪽 **Bot** → **Reset Token** → **Yes, do it!** → **Copy** (2단계 인증 코드를 물을 수 있어요)
   > 4) 토큰은 채팅에 붙이지 말고 "복사했어"라고만 말해 주세요
6. "복사했어" → `ds token --profile <p>` — 클립보드에서 읽어 `.env`(600)에 저장하고 클립보드를 비운다. 출력의 **초대 링크**를 주며: "이 링크를 열어 1)의 서버를 고르고 승인해 주세요"
7. "승인했어" → `ds setup --dry` 결과를 요약해 보여 주고 → `ds setup`
8. `ds prune` 목록(디스코드가 만든 기본 채널)을 보여 주고 확인받은 뒤 `ds prune --yes`
9. `ds doctor` 가 "🎉 막힌 곳 없음" 이면 끝 — setup 이 마지막에 찍은 서버 링크를 준다

클립보드를 못 읽는 환경(원격 Linux·SSH 등)이면: 사용자가 **자기 터미널에서** `node <스킬폴더>/scripts/discord.mjs token --prompt --profile <p>` 를 치거나, 토큰을 파일로 저장한 뒤 `ds token --file <파일>` (그 파일은 바로 지우게 한다).

## 2. 이미 있는 서버

`ds token` → 봇 초대 승인 → `ds adopt` (지금 구조를 server.json 으로 가져온다 — 이후 setup 은 쓰기 0번이 정상) → server.json 을 고치고 `ds setup --dry` → `ds setup`.

## 3. 명령 고르기

| 하려는 것 | 명령 |
|---|---|
| 상태·막힘 점검 | `ds doctor` · `ds whoami` · `ds ids` (역할·채널·태그 ID) |
| 구조 바꾸기 | server.json 수정 → `ds validate` → `ds setup --dry` → `ds setup` |
| 고정 글(환영·목차) 수정 | `content/*.md` 수정 → `ds setup` (같은 메시지를 제자리 수정) |
| 공지 · 업데이트 | `ds post <채널> @/tmp/글.md [--ping] [--pin]` · 고치기 `ds edit <채널> <메시지ID> @파일` |
| 포럼 글 · 답글 | `ds forum <포럼> "제목" @파일 --tags a,b` · `ds reply <스레드ID> @파일 [--to 메시지ID]` |
| 초대 링크 | `ds invite --note "이름"` (기본값은 server.json 의 invite) · `--count N` · 취소 `ds uninvite <코드>` |
| 초대 현황 · 멤버 | `ds invites` · `ds members` · `ds grant <멤버> <역할key>` · `ds revoke …` |
| 피드백 모아 읽기 | `ds feedback --days 7` (`--all` 보관 글까지 · `--forum <key>`) · `ds read <채널|스레드ID>` |
| 상태 태그 | `ds tag <스레드ID> +해결됨 --close` (운영진 전용 태그는 하나만 남는다) |
| 앱 → 디스코드 알림 | `ds webhook <채널> --name 가입알림` → 나온 URL 을 앱 환경변수에 |
| 이름 · 아이콘 | `ds rename <이름>` · `ds icon <이미지>` · `ds avatar <이미지>` |
| 그 밖의 모든 것 | `ds api <METHOD> <경로> [JSON|@파일]` — `{guild}`·`{app}` 치환 ([Discord API](https://docs.discord.com/developers/reference)) |

- 채널 지정: server.json 의 key · 이름 일부 · ID. 프로필이 여럿이면 `--profile` 필수.
- 긴 글·줄바꿈은 파일로 써서 `@/tmp/파일.md` 로 넘긴다 (셸 인용 사고 방지). 2000자 넘으면 알아서 나눠 올린다.
- 사람·채널 멘션: `<@유저ID>` · `<#채널ID>` (`ds members` · `ds ids` 로 ID 확인).

## 4. 자주 하는 일

**업데이트 로그** — 무엇이 바뀌었는지(사용자에게 보이는 변화만) 정리 → NOTES.md 의 형식으로 `/tmp/update.md` 작성 → 문안을 보여 주고 확인 → `ds post updates @/tmp/update.md`.

**피드백 정리** — `ds feedback --days 7` → 버그는 재현 여부·원인·수정안, 제안은 👍 수와 비슷한 요청끼리 묶어 표로 보고. 답글(`ds reply`)·태그(`ds tag`)는 문안을 확인받은 뒤.

**초대** — `ds invite --note "이름 (어디서)"` → 링크 전달은 사용자가 직접(대신 보내지 않는다). 며칠 뒤 `ds invites` 로 '대기' 인 사람을 알려 준다.

**채널 추가** — server.json 의 알맞은 카테고리에 채널을 더하고 `ds validate` → `ds setup --dry` 로 무엇이 생기는지 보여 주고 → `ds setup`. 디스코드에서 손으로만 바꾸면 다음 setup 이 접근 규칙을 설계도대로 되돌린다.

## 5. 절대 규칙

- ❌ 토큰 값을 출력하거나 `.env` 를 cat 하지 않는다. 사용자가 채팅에 토큰을 붙였다면 즉시 "개발자 포털에서 Reset Token 으로 새로 발급하세요"라고 알린다 (채팅 기록에 남은 토큰은 죽은 셈 친다).
- ❌ **내가 쓴 문안**을 멤버가 보는 곳(공지·업데이트·답글·태그)에 올리기 전에 확인 없이 게시하지 않는다. 사용자가 문안까지 줬거나 "바로 올려"라고 했으면 바로.
- ❌ `--ping`(@everyone)은 사용자가 말할 때만.
- ❌ 지우기·역할 회수·`api DELETE`·`prune --yes` 는 대상을 먼저 보여 주고 확인받는다.
- ❌ 멤버의 개인 정보·대화를 서버 밖(다른 글·보고서·공개 저장소)으로 옮기지 않는다.
- ✅ 실패하면 오류의 `👉` 해결책을 따르고, 모르겠으면 `ds doctor`. 같은 명령을 고치지 않고 반복하지 않는다.
