# 토론 수업 도우미 (가치수직선)

교실 토론용 웹앱. 기획은 [docs/PRD.md](docs/PRD.md) 참고.

- 학생 화면: `index.html` (접속 코드 + 이름으로 입장)
- 교사 화면: `teacher.html` (구글 로그인)
- 빌드 도구 없음. HTML + JS 모듈, Firebase는 CDN에서 불러온다.
- 학생 응답은 Firebase Firestore에만 저장된다. 이 저장소에는 코드만 있다.

## 구성

| 파일 | 내용 |
| --- | --- |
| `js/firebase.js` | Firebase 설정값 (공개되어도 되는 값) |
| `js/common.js` | 공용 도구 (눈금, 이동 표시, 대화상자) |
| `js/student.js` | 학생 입장, 1차·2차 제출 |
| `js/teacher.js` | 교사 로그인, 방 목록, 방 화면(칩, 화살표, QR, 의견 카드, 워드클라우드) |
| `js/wordcloud.js` | 단어 세기(조사 자르기)와 워드클라우드 배치 |
| `firestore.rules` | Firestore 보안 규칙. **바꾸면 Firebase 콘솔에도 붙여 넣어야 적용된다** |

## 다른 컴퓨터에서 이어서 작업하기

```bash
git clone https://github.com/SongeunC/makingthinking.git
```

받은 폴더를 Claude Code로 열고 작업한 뒤, 끝나면 커밋·푸시한다. 다음 컴퓨터에서는 `git pull`로 최신 코드를 받는다.

## 로컬에서 띄워 보기

```bash
npx --yes http-server -p 5500 -c-1
```

브라우저에서 `http://localhost:5500/teacher.html`을 연다. (파일을 직접 더블클릭해서 열면 동작하지 않는다.)

## Firebase 설정 체크리스트

- Authentication → 로그인 방법: **Google**, **익명** 사용 설정
- Authentication → 설정 → 승인된 도메인: `songeunc.github.io` 추가
- Firestore Database → 규칙: `firestore.rules` 내용을 붙여 넣고 게시
