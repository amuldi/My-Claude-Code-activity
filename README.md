# Claude Code activity for your README

내 **Claude Code 사용 기록을 GitHub 잔디처럼** 프로필 README에 넣는 방법을 안내하는 저장소입니다.
누구나 자기 컴퓨터에서 한 번 실행하면, 자기 README에 아래 같은 이미지를 넣을 수 있습니다.

- 🟧 **토큰 잔디** — 연도별(1월~12월)로 하루에 쓴 토큰
- 🟧 **프롬프트 잔디** — 연도별로 하루에 보낸 프롬프트 수
- 📊 **프로젝트 막대** — 가장 많이 작업한 프로젝트

이미지를 만드는 도구는 [ClaudeCode_HitMap](https://github.com/amuldi/ClaudeCode_HitMap)입니다. 실제로 쓴 모습은 [amuldi/Hello-World](https://github.com/amuldi/Hello-World)의 README 맨 아래에서 볼 수 있습니다.

> 이 저장소에는 제 기록을 올리지 않습니다. 각자 **자기 저장소**에 자기 기록을 올립니다.

## 왜 직접 실행해야 하나요?

Claude Code의 사용 기록은 서버가 아니라 **내 컴퓨터(`~/.claude`)에만** 있습니다. 그래서 URL만 넣으면 뜨는 방식은 불가능하고, 내 컴퓨터에서 이미지를 만들어 내 저장소에 올린 뒤 README가 그 이미지를 가리키게 합니다.

## 따라 하기

필요한 것: **Node 18.17 이상**, **git**, Claude Code를 쓴 기록, 이미지를 올릴 GitHub 저장소(프로필 README 저장소 `<내아이디>/<내아이디>`가 가장 간단합니다).

### 1. 설치

```bash
npm install -g github:amuldi/ClaudeCode_HitMap
```

### 2. 내 저장소에서 이미지 만들고 올리기

```bash
git clone https://github.com/<내아이디>/<내아이디>
cd <내아이디>
cc-hitmap --out claude-activity --prompts --years --push
```

`claude-activity/` 폴더에 이런 파일이 생기고, `--push`가 커밋·푸시까지 합니다.

| 파일 | 내용 |
|---|---|
| `claude-hitmap-2026.svg` | 2026년 토큰 잔디 |
| `claude-prompts-2026.svg` | 2026년 프롬프트 잔디 |
| `claude-projects.svg` | 프로젝트별 막대 |
| `claude-hitmap.json` | 날짜별 숫자 장부 (지우지 마세요) |

연도마다 파일이 따로 생깁니다. 새 해가 되면 `claude-hitmap-2027.svg`가 자동으로 추가됩니다.

### 3. README에 넣기

저장소 안에 있는 파일이라 상대 경로로 넣으면 됩니다.

```markdown
## 🤖 Claude Code Activity

![Claude Code tokens in 2026](claude-activity/claude-hitmap-2026.svg)

![Claude Code prompts in 2026](claude-activity/claude-prompts-2026.svg)

![Projects](claude-activity/claude-projects.svg)
```

가운데 정렬이 필요하면 HTML로 감쌉니다.

```html
<div align="center">
<img src="claude-activity/claude-hitmap-2026.svg" alt="Claude Code tokens in 2026" />
</div>
```

이미지는 보는 사람의 라이트/다크 모드를 자동으로 따라갑니다.

### 4. 갱신하기

새 활동을 반영하려면 같은 명령을 다시 실행합니다.

```bash
cd <내아이디>
cc-hitmap --out claude-activity --prompts --years --push
```

세션이 끝날 때마다 자동으로 하려면 `~/.claude/settings.json`에 훅을 추가합니다.

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "cd ~/code/<내아이디> && cc-hitmap --out claude-activity --prompts --years --push >/dev/null 2>&1 &" }
        ]
      }
    ]
  }
}
```

## 자주 쓰는 옵션

| 옵션 | 설명 |
|---|---|
| `--years` | 달력 연도별 잔디를 그립니다 (이 가이드의 기본) |
| `--prompts` | 프롬프트 수 잔디와 프로젝트 막대도 그립니다 |
| `--top 12` | 프로젝트 막대에 12개까지 보여줍니다 (기본 8) |
| `--lang ko` | 한글로 표기합니다 |
| `--metric output` | 출력 토큰만 셉니다 (`total` · `output` · `input`) |
| `--theme dark` | 다크 모드로 고정합니다 (기본은 자동) |
| `--no-mascot` | 마스코트를 뺍니다 |
| `--tz Asia/Seoul` | 하루를 자르는 시간대 |

전체 옵션과 집계 방식은 [ClaudeCode_HitMap 문서](https://github.com/amuldi/ClaudeCode_HitMap)에 있습니다.

## 알아 두세요

- **토큰 기록은 설치한 날부터 쌓입니다.** Claude Code가 대화 기록을 30일 뒤에 지우기 때문에, 설치 전 30일보다 오래된 토큰은 되살릴 수 없습니다. 한 번 세어 둔 날은 장부에 남아 사라지지 않습니다.
- **프롬프트 기록은 더 오래 남아 있어** 과거 몇 달치가 바로 채워집니다.
- **개인정보:** 저장소에는 날짜별 숫자와 프로젝트 **폴더 이름**만 올라갑니다. 프롬프트 내용과 코드는 읽지도 올리지도 않습니다. 프로젝트 이름을 공개하고 싶지 않다면 `--prompts` 없이 실행하세요 (프로젝트 막대와 프롬프트 잔디가 빠집니다).
- 컴퓨터가 여러 대라면 각자 다른 장부를 만듭니다. 합치는 기능은 아직 없습니다.
- 비공식 도구이며 Anthropic과 관련이 없습니다.
