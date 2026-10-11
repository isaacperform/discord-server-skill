// 봇 토큰 받기 — 채팅에 붙이지 않게 클립보드에서 바로 읽고, 다 쓰면 비운다.
// macOS · Windows · WSL · Linux(Wayland·X11) 를 지원하고, 안 되면 숨김 입력(--prompt)·--stdin·--file 로 받는다.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// 봇 토큰 = base64(봇 user id).시각.서명 — 첫 조각이 숫자 id 로 풀리는지까지 본다.
// 모양(a.b.c)만 보면 JWT(다른 서비스 키)도 통과해서 남의 비밀을 디스코드로 보내게 된다
export function looksLikeBotToken(s) {
  const m = String(s ?? '').trim().match(/^([\w-]{20,})\.([\w-]{4,})\.([\w-]{20,})$/)
  if (!m) return false
  return /^\d{17,20}$/.test(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
}

const isWsl = () => {
  if (process.platform !== 'linux') return false
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'))
  } catch {
    return false
  }
}

// [명령, 인자] 후보 — 앞에서부터 되는 것을 쓴다
function readers() {
  if (process.platform === 'darwin') return [['pbpaste', []]]
  if (process.platform === 'win32' || isWsl()) {
    return [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw']]]
  }
  return [
    ['wl-paste', ['--no-newline']],
    ['xclip', ['-selection', 'clipboard', '-o']],
    ['xsel', ['--clipboard', '--output']],
  ]
}
function clearers() {
  if (process.platform === 'darwin') return [['pbcopy', [], '']]
  if (process.platform === 'win32' || isWsl()) return [['cmd.exe', ['/c', 'echo off | clip'], undefined]]
  return [
    ['wl-copy', ['--clear'], undefined],
    ['xclip', ['-selection', 'clipboard'], ''],
    ['xsel', ['--clipboard', '--clear'], undefined],
  ]
}

export function readClipboard() {
  const tried = []
  for (const [cmd, args] of readers()) {
    try {
      const text = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 })
      return { ok: true, text, tool: cmd }
    } catch {
      tried.push(cmd)
    }
  }
  const linuxTip = process.platform === 'linux' && !isWsl()
    ? ' (Linux: sudo apt install wl-clipboard 또는 xclip)'
    : ''
  return {
    ok: false,
    message: `클립보드를 읽지 못했어요 (${tried.join(', ')} 시도)${linuxTip}\n   👉 다른 방법: token --prompt (터미널에서 숨김 입력) · token --file <파일> · 또는 DISCORD_BOT_TOKEN 환경변수`,
  }
}

export function clearClipboard() {
  for (const [cmd, args, input] of clearers()) {
    try {
      execFileSync(cmd, args, { input, stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'ignore'], timeout: 8000 })
      return true
    } catch {}
  }
  return false
}

// 터미널에서 직접 칠 때: 화면에 안 보이게 입력받는다 (Claude Code 의 Bash 처럼 TTY 가 없으면 못 쓴다)
export function promptHidden(question) {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('터미널(TTY)이 아니라 입력을 받을 수 없어요 — 클립보드(token) 나 --file 을 쓰세요'))
  }
  process.stdout.write(question)
  return new Promise((resolve) => {
    let buf = ''
    const stdin = process.stdin
    const finish = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stdout.write('\n')
      resolve(buf.trim())
    }
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') return finish()
        if (c === '\u0003') {
          stdin.setRawMode(false)
          process.exit(130)
        }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1)
        else buf += c
      }
    }
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    stdin.on('data', onData)
  })
}
