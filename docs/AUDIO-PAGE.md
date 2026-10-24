# 책 오디오 페이지 (durukorean.com/audio)

책에 인쇄된 주소는 `https://www.durukorean.com/audio`, 트랙별로는 `https://www.durukorean.com/audio#B1-04-03` 입니다.
페이지는 `audio.html` + `js/audio.js`, 목록은 `assets/audio/book1.json`, mp3 는 `assets/audio/book1/B1-LL-TT.mp3` 입니다 (사이트 자체에서 재생, 유료 서비스 불필요).

- 목록(`book1.json`)에는 과(START, Lesson 1…, Checkpoint 1…)와 트랙(`id`, `title` = 책의 AUDIO 라벨 지시문, `groups` = 라벨 2째 줄, `file`, `dur`)이 책 순서대로 들어 있습니다.
- 새 mp3 를 넣을 때: 파일을 `assets/audio/book1/` 에 두고 `node scripts/audio-index.mjs` 를 실행하면 길이(`dur`)가 갱신되고, 이미 쓴 `title`·`groups`·`label` 은 그대로 남습니다. 새 트랙은 `title`·`groups` 를 직접 채웁니다.
- 2권 이후: `assets/audio/book2.json`, 폴더 `assets/audio/book2/` 로 같은 방식을 쓰고 `js/audio.js` 의 `DATA_URL` 에 권 탭을 더합니다 (지금은 1권만).
- 유튜브 영상 구간으로도 재생할 수 있습니다 (과에 `video`, 트랙에 `start`/`end`) — 파일이 아주 많아질 때를 위한 예비 방식입니다.
