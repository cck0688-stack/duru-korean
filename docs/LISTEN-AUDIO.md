# 책 오디오 (listen.html) — 올리는 방법

1. 챕터마다 영상 1개를 유튜브에 올립니다. 공개 또는 **일부 공개**(비공개는 안 됩니다). 정지 화면(표지·챕터 이미지) 영상이면 됩니다.
2. 영상 주소 `https://www.youtube.com/watch?v=XXXXXXXXXXX` 의 `XXXXXXXXXXX` 가 영상 아이디입니다.
3. `assets/audio/book1.json` 에 챕터와 트랙을 적습니다 (시각은 영상 안의 초).

```json
{ "book": "book1", "chapters": [
  { "n": 1, "title": { "ko": "한글 모음과 자음", "en": "Hangul: vowels and consonants" },
    "video": "XXXXXXXXXXX",
    "tracks": [
      { "n": 1, "title": { "ko": "모음 읽기", "en": "Reading the vowels" }, "text": "아 야 어 여", "start": 0, "end": 42.5 },
      { "n": 2, "title": { "ko": "자음 읽기" }, "start": 42.5, "end": 95 }
    ] }
] }
```

- `title` 은 언어 코드별 글자 (없는 언어는 en → ko 순으로 보여 줍니다). `text` 는 트랙 아래에 보일 한국어 문장 (선택).
- 책의 QR코드 주소: `https://www.durukorean.com/listen.html?c=챕터번호&t=트랙번호`
- 챕터가 하나도 없으면 페이지에 "오디오를 챕터별로 올리고 있어요" 안내가 나옵니다.
- 책 소개 페이지(`book-resources.html`)에서 이 페이지로 가는 버튼은 첫 챕터가 올라간 뒤에 답니다 (문구 키 `bookAudio.listenCta` 는 10개 언어에 들어 있습니다).
