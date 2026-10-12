# DiscordBirthday

서버 관리자가 `/send-dm` 명령을 실행하면 제외 대상을 뺀 서버 멤버 모두에게 롤링 페이퍼 작성 안내 DM을 보내고, 멤버가 DM으로 보낸 답장을 사용자별로 JSON 파일에 기록하는 TypeScript Discord 봇입니다.

## 주요 동작

- 서버 관리자(Administrator 권한)가 `/send-dm`을 실행하면 멤버 전원에게 `DM_MESSAGE` 내용을 DM으로 보냅니다.
- 봇 계정은 항상 제외됩니다. 그 밖에 `EXCLUDE_USER_IDS`, `EXCLUDE_NAMES`에 해당하는 멤버도 제외됩니다.
- DM을 받은 멤버가 보낸 답장은 메시지마다 별도 항목으로 `RESPONSES_PATH` JSON 파일에 기록됩니다.
- 멤버가 답장을 수정하면 같은 메시지의 항목이 수정 내용으로 갱신됩니다.

## 사전 준비

- Node.js 22 이상
- npm
- 봇을 초대할 수 있는 Discord 서버와 관리자 권한

## 1. Discord 애플리케이션과 봇 만들기

1. Discord Developer Portal(https://discord.com/developers/applications)에 접속해 로그인합니다.
2. 오른쪽 위의 `New Application`을 눌러 이름을 정하고 애플리케이션을 만듭니다.
3. 왼쪽 메뉴의 `Bot` 탭으로 이동합니다. 봇 사용자가 보이지 않으면 추가합니다.
4. `Bot` 탭에서 `Reset Token`을 눌러 토큰을 발급받고 복사합니다. 이 값이 `DISCORD_TOKEN`입니다. 토큰은 다시 볼 수 없으므로 안전한 곳에 보관하고, 다른 사람과 공유하거나 저장소에 올리지 마세요. 노출되었다면 즉시 다시 발급받으세요.
5. 같은 `Bot` 탭의 `Privileged Gateway Intents`에서 `Server Members Intent`를 켜고 저장합니다. 이 인텐트가 꺼져 있으면 서버 멤버 목록을 가져올 수 없어 봇이 로그인에 실패하거나 DM 대상을 찾지 못합니다.
6. DM 답장의 내용을 읽기 위해 `Message Content Intent`를 따로 켤 필요는 없습니다. 봇에게 온 DM의 내용은 해당 인텐트 없이도 받을 수 있습니다.

## 2. 서버에 봇 초대하기

1. Developer Portal의 `General Information` 탭에서 `Application ID`를 복사합니다.
2. 아래 형식의 초대 URL에서 `<APPLICATION_ID>` 자리에 복사한 값을 넣어 브라우저로 엽니다.
   - `https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=0`
3. 초대할 서버를 선택하고 승인합니다.

초대 URL에는 두 가지 scope가 반드시 들어가야 합니다.

- `bot`: 봇을 서버에 추가합니다.
- `applications.commands`: 서버에 `/send-dm` 슬래시 명령을 등록합니다.

필요한 봇 권한은 다음과 같습니다.

- 멤버에게 DM을 보내는 데 서버 채널 권한은 필요하지 않습니다. 그래서 위 URL은 `permissions=0`(추가 권한 없음)으로 구성했습니다.
- `/send-dm`을 실행하는 사람은 서버에서 Administrator 권한을 가지고 있어야 합니다. 이는 봇이 아니라 명령을 실행하는 사용자에게 필요한 권한입니다.

## 3. 환경 변수 설정

저장소의 `.env.example`을 복사해 `.env` 파일을 만들고 값을 채웁니다. 예를 들어 터미널에서 `cp .env.example .env`를 실행합니다.

| 변수 | 설명 | 기본값 |
| --- | --- | --- |
| `DISCORD_TOKEN` | 봇 토큰입니다. 필수입니다. | 없음 |
| `GUILD_ID` | 봇을 사용할 서버(길드)의 ID입니다. 필수입니다. Discord에서 개발자 모드를 켠 뒤 서버 아이콘을 우클릭해 `서버 ID 복사`로 얻습니다. | 없음 |
| `DM_MESSAGE` | 멤버에게 보낼 DM 내용입니다. 필수입니다. | `롤링 페이퍼를 작성해주세요` |
| `EXCLUDE_USER_IDS` | DM에서 제외할 사용자 ID 목록입니다. 쉼표로 구분합니다. | 비어 있음 |
| `EXCLUDE_NAMES` | DM에서 제외할 이름 목록입니다. 쉼표로 구분합니다. | 비어 있음 |
| `SEND_DELAY_MS` | DM 한 건을 보낸 뒤 다음 DM까지 기다리는 시간(밀리초)입니다. Discord 요청 제한을 피하기 위한 간격입니다. | `1500` |
| `RESPONSES_PATH` | 답장을 기록할 JSON 파일 경로입니다. | `data/responses.json` |
| `DRY_RUN` | `true`이면 실제로 DM을 보내지 않고 대상만 로그로 확인합니다. | `false` |

### 제외 규칙

- 목록 값은 쉼표로 구분하며, 앞뒤 공백은 무시하고 빈 항목은 버립니다.
- `EXCLUDE_USER_IDS`는 사용자 ID가 정확히 일치할 때 제외합니다.
- `EXCLUDE_NAMES`는 멤버의 사용자명(username), 전역 표시 이름(global display name), 서버 별명(nickname) 중 하나와 일치하면 제외합니다. 이름 비교는 대소문자를 구분하지 않습니다. 사용자 ID로 제외하려면 `EXCLUDE_USER_IDS`에 넣어야 하며, `EXCLUDE_NAMES`에 넣은 ID는 일치로 처리되지 않습니다.
- 봇 계정은 설정과 관계없이 항상 제외됩니다.

## 4. 설치, 빌드, 실행, 테스트

- 의존성 설치: `npm install`
- 빌드: `npm run build`
- 봇 시작: `npm start` (빌드된 `dist/index.js`를 실행하므로 먼저 `npm run build`를 해야 합니다)
- 테스트: `npm test`
- 타입 검사: `npm run typecheck`

봇이 시작되어 준비되면 `GUILD_ID` 서버에 `/send-dm` 명령이 등록됩니다.

## 5. `/send-dm` 사용법

서버에서 `/send-dm`을 실행하면 봇이 대상 멤버에게 `DM_MESSAGE`를 차례로 보냅니다.

- 관리자만 사용할 수 있습니다. 서버 밖에서 실행하거나 Administrator 권한이 없는 사용자가 실행하면 거절 안내만 받고 DM은 전혀 발송되지 않습니다.
- 실행 결과는 명령을 실행한 사람에게만 보이는 ephemeral 메시지로 알려 줍니다. 요약에는 발송(sent), 건너뜀(skipped), 실패(failed) 건수가 들어갑니다. `DRY_RUN`일 때는 발송 예정 건수도 함께 표시됩니다.
- 이미 DM을 보낸 멤버는 기록되어 있으므로 다시 실행해도 건너뜁니다. 따라서 중간에 실패한 멤버가 있어도 `/send-dm`을 다시 실행하면 아직 보내지 않은 멤버만 처리됩니다.
- 멤버가 서버 멤버로부터 오는 DM을 막아 둔 경우처럼 DM을 보낼 수 없으면 해당 멤버는 실패로 기록되고, 나머지 멤버에게는 계속 발송합니다.
- 이미 실행 중인 상태에서 `/send-dm`을 다시 실행하면 진행 중이라는 안내만 받고 새로 시작되지 않습니다.
- 발송 사이에는 `SEND_DELAY_MS`만큼 간격을 둡니다.

### 답장 기록

- DM을 받은 멤버가 봇에게 DM으로 보낸 메시지만 기록합니다. 봇이나 서버 채널의 메시지, DM을 받은 적 없는 사용자의 메시지는 무시합니다.
- 같은 사용자가 여러 번 답장하면 도착한 순서대로 메시지마다 별도 항목이 추가되며, 이전 항목을 덮어쓰지 않습니다.
- 답장을 수정하면 같은 메시지 ID를 가진 항목의 내용과 수정 시각만 갱신됩니다.

## 6. DRY_RUN

`.env`에서 `DRY_RUN=true`로 설정하면 실제 발송 전에 대상을 점검할 수 있습니다.

- 누구에게 DM을 보낼지 로그로만 출력하고 실제로는 DM을 보내지 않습니다.
- 발송한 것으로 기록하지 않으므로, 이후 `DRY_RUN=false`로 바꿔 다시 실행하면 정상적으로 발송됩니다.
- 요약 메시지에는 발송 예정 건수가 따로 표시됩니다.

처음 사용할 때는 `DRY_RUN=true`로 제외 설정이 의도대로 동작하는지 확인한 뒤 `false`로 바꾸기를 권장합니다.

## 7. 데이터 파일 형식

답장과 발송 상태는 `RESPONSES_PATH`(기본 `data/responses.json`)의 JSON 파일 하나에 저장됩니다. 파일이 없으면 빈 상태로 시작하며, 저장할 때는 임시 파일에 쓴 뒤 이름을 바꾸는 방식으로 파일이 깨지지 않게 하고 상위 폴더가 없으면 만듭니다.

최상위에는 두 개의 객체가 있습니다.

- `responses`: 사용자 ID를 키로 하는 답장 기록입니다.
- `sendState`: 사용자 ID를 키로 하는 DM 발송 상태입니다.

`responses`의 각 사용자 항목은 다음 필드를 가집니다.

- `userId`: 사용자 ID
- `username`: 사용자명
- `displayName`: 표시 이름
- `firstRepliedAt`: 첫 답장 시각(ISO-8601 문자열)
- `lastUpdatedAt`: 마지막으로 갱신된 시각(ISO-8601 문자열)
- `messages`: 메시지 항목의 배열

`messages`의 각 항목은 다음 필드를 가집니다.

- `messageId`: Discord 메시지 ID
- `content`: 메시지 내용(수정되었다면 수정된 내용)
- `sentAt`: 메시지를 보낸 시각(ISO-8601 문자열)
- `editedAt`: 수정한 시각(ISO-8601 문자열). 수정된 적이 없으면 `null`입니다.

`sendState`의 각 항목은 다음 필드를 가집니다.

- `status`: `sent`(발송 성공) 또는 `failed`(발송 실패)
- `at`: 기록 시각(ISO-8601 문자열)
- `reason`: 실패 사유. 실패한 경우에만 기록됩니다. DM이 막혀 있어 실패한 경우도 여기에 남습니다.

수정 처리 규칙은 다음과 같습니다.

- 수정된 메시지의 `messageId`가 이미 기록된 항목과 일치하면 그 항목의 `content`와 `editedAt`, 그리고 사용자의 `lastUpdatedAt`을 갱신합니다.
- 일치하는 항목이 없는 메시지가 수정되었다면(예: 봇이 꺼져 있어 원본 메시지를 놓친 경우) 답장이 사라지지 않도록 새 항목으로 추가합니다. 이때 `sentAt`은 원본 메시지의 시각이고 `editedAt`이 채워지며, 항목은 `sentAt` 순서를 유지합니다.

## 8. Git에 올리지 않는 파일

`.gitignore`에 다음 항목이 포함되어 있어 저장소에 올라가지 않습니다.

- `.env`: 토큰 등 비밀 값이 들어 있습니다.
- `data/`: 수집된 답장 데이터가 들어 있습니다.
- `node_modules/`, `dist/`: 설치물과 빌드 결과물입니다.

`.env`와 `data/` 안의 파일에는 토큰과 멤버의 개인 메시지가 담겨 있으므로 저장소에 커밋하거나 외부에 공유하지 마세요.
