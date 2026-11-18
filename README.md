# kodubber

유튜브의 일반 자막과 자동 생성 자막을 한국어로 번역하고, Chrome 음성으로 영상에 맞춰 읽어주는 확장 프로그램입니다.

## 1. 다운로드

편한 방법 하나를 선택하세요.

- **Git으로 받기** — 터미널에서 아래 명령을 실행하면 현재 위치에 `kodubber` 폴더가 생깁니다.

  ```sh
  git clone https://github.com/junwon323/kodubber.git
  cd kodubber
  ```

- **ZIP으로 받기** — [GitHub 저장소](https://github.com/junwon323/kodubber)에서 초록색 **Code → Download ZIP**을 누릅니다. ZIP 전체를 압축 해제하고 `kodubber-main` 폴더를 엽니다. 이 폴더 안에 `extension`과 `bin` 폴더가 함께 있어야 합니다.

## 2. AI 번역 연결

Chrome 내장 번역만 쓸 경우 바로 **3. Chrome에 확장 등록**으로 넘어가세요.

AI 번역을 사용하려면 아래 도구 중 원하는 것 **하나만** 설치하고, 터미널에서 해당 명령을 실행해 로그인합니다. 여러 도구가 설치되어 있으면 확장에서 선택할 수 있습니다.

| 번역 엔진 | 설치 안내 | 설치 후 실행 |
| --- | --- | --- |
| Codex | [Codex CLI 공식 설치 안내](https://learn.chatgpt.com/docs/codex/cli) | `codex` |
| Claude Code | [Claude Code 공식 설치 안내](https://code.claude.com/docs/en/setup#install-claude-code) | `claude` |
| Antigravity CLI | [Antigravity CLI 공식 설치 안내](https://antigravity.google/docs/getting-started?tab=cli) | `agy` |

Windows에서는 Windows용 Chrome에서 실행할 수 있도록 각 CLI의 **Windows용 설치 방법**을 따르세요.

로그인했다면 내려받은 폴더에서 운영체제에 맞는 **로컬 연결 파일을 한 번** 실행하세요. 이 파일은 Chrome에서 내 PC의 CLI를 찾을 수 있도록 연결 도구를 등록합니다.

| 운영체제 | 로컬 연결 파일 실행 |
| --- | --- |
| Windows | 탐색기에서 `install-windows.cmd` 더블클릭 |
| macOS | Finder에서 `install.command` 더블클릭 |
| Linux | 터미널로 내려받은 폴더를 열고 `sh ./install.command --no-gui` 실행 |

## 3. Chrome에 확장 등록

1. 데스크톱 Chrome의 주소창에 `chrome://extensions/`를 입력하고 Enter를 누릅니다.
2. 확장 프로그램 관리 화면 **오른쪽 위**의 **개발자 모드** 스위치를 켭니다.
3. 화면 위에 나타나는 **압축해제된 확장 프로그램을 로드** 버튼을 누릅니다.
4. 폴더 선택 창에서 내려받은 `kodubber` 또는 `kodubber-main`을 연 다음, 그 안의 **`extension` 폴더**를 선택합니다.
5. 목록에 **kodubber**가 나타나면 등록 완료입니다. Chrome 오른쪽 위의 퍼즐 아이콘 **확장 프로그램**을 열어 kodubber를 고정해 두면 편합니다.

## 4. 사용하기

1. 일반 자막 또는 자동 생성 자막이 있는 유튜브 영상을 엽니다.
2. Chrome 도구 모음에서 **kodubber**를 열고 **번역 엔진**을 확인합니다. 연결 도구가 발견한 CLI만 표시되고, 선택한 엔진은 다음에도 기억합니다.
3. **더빙 켜기**를 누릅니다. 자막을 가져오고 앞부분을 번역한 뒤 한국어 음성으로 재생합니다. 종료하려면 **더빙 끄기**를 누르세요.
4. 한국어 음성이 여러 개 있으면 목소리를 고를 수 있습니다. 더빙이 너무 빨라 사이가 비거나 너무 느려 영상이 멈추면 **음성 속도**를 조절하세요.

CLI가 없거나 로컬 연결 파일을 아직 실행하지 않았다면 **Chrome 번역**이 표시됩니다. 지원되는 최신 데스크톱 Chrome에서 사용할 수 있습니다. 첫 사용 때 영상 위에 **Chrome 번역 준비** 버튼이 나타나면 눌러 번역 모델 다운로드를 시작하세요. [Chrome 내장 번역 안내](https://developer.chrome.com/docs/ai/translator-api?hl=ko)

Codex는 최신 **Terra**, Claude Code는 최신 **Sonnet**, Antigravity CLI는 최신 **Hydrogen**을 사용합니다. 세 CLI 모두 추론 수준은 `medium`이고 고등학교 선생님 톤으로 번역합니다. Chrome 내장 번역은 말투 설정을 지원하지 않습니다.

## 업데이트와 문제 해결

- **Git으로 받았다면** 기존 `kodubber` 폴더에서 `git pull`을 실행합니다. **ZIP으로 받았다면** 새 ZIP을 내려받아 같은 폴더에 전체 파일을 덮어씁니다. 그런 다음 `chrome://extensions/`에서 **kodubber 카드의 새로고침 아이콘**을 누릅니다.
- **설치한 CLI가 목록에 없으면** 터미널에서 해당 CLI 명령이 실행되는지 확인하고, 로컬 연결 파일을 다시 실행한 뒤 확장을 다시 엽니다. 다운로드 폴더를 옮겼다면 연결 파일을 새 위치에서 실행하고, Chrome에도 새 위치의 `extension` 폴더를 등록하세요.
- **번역에 실패하면** 선택한 CLI를 터미널에서 직접 열어 로그인과 모델 이용 가능 여부를 확인하세요. **Chrome 번역**에서 처음 모델을 준비할 때는 인터넷 연결이 필요합니다.
- **자막을 찾지 못하면** 영상의 **CC** 메뉴에서 일반 자막이나 자동 생성 자막이 제공되는지 확인하세요.
