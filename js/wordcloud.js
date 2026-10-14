// 워드클라우드: 띄어쓰기로 단어를 나누고 흔한 조사를 뒤에서 잘라 센다(형태소 분석 아님, PRD 8).

// 긴 것부터 확인해야 "에서는"이 "는"만 잘리지 않는다
const PARTICLES = [
  "에서는", "에게서", "으로는", "이라고", "이라는", "에서도", "까지도",
  "에서", "에게", "한테", "으로", "처럼", "보다", "까지", "부터", "라고", "라는", "이나", "이랑", "하고", "과는", "와는", "에는", "에도",
  "은", "는", "이", "가", "을", "를", "에", "의", "도", "와", "과", "로", "만", "랑", "께",
];

// 뜻이 거의 없는 말은 처음부터 뺀다. 나머지는 교사가 눌러서 제외한다.
const STOPWORDS = new Set([
  "것", "수", "등", "더", "그", "저", "좀", "잘", "및", "또", "또는", "그리고", "하지만", "그래서", "그런데", "그러나",
  "왜냐하면", "때문", "때문에", "너무", "정말", "진짜", "아주", "매우", "있다", "없다", "한다", "했다", "하는", "해서",
  "이다", "같다", "같은", "있는", "없는", "된다", "되는", "나", "내", "제가", "저는", "거", "게", "왜", "안", "못",
]);

// 끝 글자가 조사처럼 보이지만 원래 단어의 일부인 자주 쓰는 말
const KEEP = new Set([
  "스스로", "서로", "새로", "바로", "별로", "같이", "함께", "많이", "깊이", "높이", "길이", "놀이", "사이",
  "아이", "나이", "종이", "누구나", "언제나", "정도", "온도", "제도", "태도", "의도",
]);

export function stripParticle(word) {
  if (KEEP.has(word)) return word;
  for (const p of PARTICLES) {
    if (word.length > p.length && word.endsWith(p)) return word.slice(0, -p.length);
  }
  return word;
}

// 글 목록 → [[단어, 횟수], ...] (많은 순)
export function countWords(texts) {
  const counts = new Map();
  for (const text of texts) {
    for (const raw of String(text ?? "").split(/\s+/)) {
      const cleaned = raw.replace(/[^\p{L}\p{N}]/gu, "");
      if (!cleaned) continue;
      const w = stripParticle(cleaned);
      if (!w || STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
}

const COLORS = ["#fdfaf0", "#f4d465", "#f2b3c0", "#abd2e4", "#cfe3c8", "#f3cfb4", "#86bce0", "#eb93a8"];

// 많이 나온 단어부터 가운데에서 나선을 따라 겹치지 않게 놓는다
export function layoutCloud(box, entries) {
  box.innerHTML = "";
  if (!entries.length) return;
  const W = box.clientWidth;
  const H = box.clientHeight;
  const max = entries[0][1];
  const min = entries[entries.length - 1][1];
  const big = Math.min(96, Math.max(40, W / 12));
  const small = Math.max(16, big / 4.5);
  const placed = [];

  entries.forEach(([word, n], i) => {
    const t = max === min ? 1 : (n - min) / (max - min);
    const size = Math.round(small + (big - small) * Math.sqrt(t));
    const el = document.createElement("button");
    el.className = "cloud-word";
    el.dataset.word = word;
    el.title = `${word} (${n}번) · 누르면 제외`;
    el.textContent = word;
    el.style.fontSize = `${size}px`;
    el.style.color = COLORS[i % COLORS.length];
    box.appendChild(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    for (let step = 0; step < 4000; step++) {
      const a = step * 0.18;
      const r = 2.2 * a;
      const x = W / 2 + r * Math.cos(a) * 1.6 - w / 2;   // 가로로 넓게 퍼지게
      const y = H / 2 + r * Math.sin(a) - h / 2;
      if (x < 0 || y < 0 || x + w > W || y + h > H) continue;
      const hit = placed.some((p) => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y);
      if (hit) continue;
      placed.push({ x, y, w, h });
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      return;
    }
    el.remove();   // 자리가 없으면 뺀다
  });
}
