import { app } from "./firebase.js";
import {
  POSITIONS, DEFAULT_LEFT, DEFAULT_RIGHT, esc, $, moveLabel, confirmDialog, toast, posStyle,
  cardColor, likeCount, PMI, PMI_TYPES, pmiStyle,
} from "./common.js";
import { countWords, countNouns, loadAnalyzer, layoutCloud } from "./wordcloud.js";
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, collection, query, where, onSnapshot, runTransaction, updateDoc,
  deleteDoc, getDocs, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);
const root = $("#app");

let user = null;
let unsubs = [];

function cleanup() {
  unsubs.forEach((u) => u());
  unsubs = [];
  root.onclick = null;
  document.querySelector(".qr-overlay")?.remove();
}

onAuthStateChanged(auth, (u) => {
  user = u && !u.isAnonymous ? u : null;
  route();
});
window.addEventListener("hashchange", route);

function route() {
  cleanup();
  if (!user) return renderLogin();
  const m = location.hash.match(/^#room\/([\w-]+)$/);
  if (m) openRoom(m[1]);
  else renderHome();
}

// ---------- 로그인 ----------

function renderLogin() {
  root.innerHTML = `
    <main class="wrap">
      <section class="card">
        <h1 style="font-size:24px;margin-bottom:8px">교사 로그인</h1>
        <p class="muted" style="margin:0 0 20px">구글 계정으로 로그인하면 토론 방을 만들 수 있습니다.</p>
        <button class="btn btn-primary btn-block" id="login">구글로 로그인</button>
        <p class="error" id="login-error"></p>
      </section>
    </main>`;
  $("#login").addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (ex) {
      console.error(ex);
      $("#login-error").textContent = "로그인하지 못했습니다. 팝업 차단을 확인하세요.";
    }
  });
}

// ---------- 방 목록 ----------

function renderHome() {
  root.innerHTML = `
    <main class="wrap">
      <div class="t-head">
        <h1>토론 수업 도우미</h1>
        <button class="btn" id="logout">로그아웃</button>
      </div>

      <section class="card">
        <h2 style="font-size:19px;margin-bottom:14px">새 방 만들기</h2>
        <form id="create-form" autocomplete="off">
          <label class="field"><span>토론 주제</span>
            <textarea id="topic" required maxlength="500" style="min-height:70px" placeholder="예: 학교에서 휴대전화 사용을 전면 금지해야 한다"></textarea>
          </label>
          <div class="row">
            <label class="field"><span>왼쪽 끝</span><input id="left" maxlength="40" value="${esc(DEFAULT_LEFT)}" required></label>
            <label class="field"><span>오른쪽 끝</span><input id="right" maxlength="40" value="${esc(DEFAULT_RIGHT)}" required></label>
          </div>
          <button class="btn btn-primary btn-block" id="create-btn">방 만들기</button>
          <p class="error" id="create-error"></p>
        </form>
      </section>

      <section class="card">
        <h2 style="font-size:19px;margin-bottom:6px">내가 만든 방</h2>
        <ul class="room-list" id="rooms"><li class="muted" style="padding:12px 0">불러오는 중…</li></ul>
      </section>
    </main>`;

  $("#logout").addEventListener("click", () => signOut(auth));
  $("#create-form").addEventListener("submit", createRoom);

  let rooms = [];
  unsubs.push(onSnapshot(query(collection(db, "rooms"), where("ownerUid", "==", user.uid)), (snap) => {
    rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? Infinity) - (a.createdAt?.toMillis?.() ?? Infinity));
    const ul = $("#rooms");
    if (!ul) return;
    ul.innerHTML = rooms.length ? rooms.map((r) => `
      <li class="room-item">
        <div class="info">
          <b>${esc(r.topic)}</b>
          <span class="muted small">코드 ${esc(r.code)} · ${r.round === 2 ? "2차 진행" : "1차"} · ${fmtDate(r.createdAt)}</span>
        </div>
        <div class="actions">
          <button class="btn" data-copy="${esc(r.code)}">링크 복사</button>
          <a class="btn btn-primary" href="#room/${r.id}" style="text-decoration:none">열기</a>
          <button class="btn" data-del="${r.id}">삭제</button>
        </div>
      </li>`).join("") : `<li class="muted" style="padding:12px 0">아직 만든 방이 없습니다.</li>`;
  }, (ex) => {
    console.error(ex);
    $("#rooms").innerHTML = `<li class="error">방 목록을 불러오지 못했습니다.</li>`;
  }));

  $("#rooms").addEventListener("click", async (e) => {
    const copyCode = e.target.closest("[data-copy]")?.dataset.copy;
    if (copyCode) return copyLink(copyCode);
    const id = e.target.closest("[data-del]")?.dataset.del;
    if (!id) return;
    const r = rooms.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: "방을 삭제할까요?",
      body: `<b>${esc(r.topic)}</b><br>학생 이름, 선택, 이유가 모두 함께 지워지며 되돌릴 수 없습니다.`,
      ok: "삭제", danger: true,
    });
    if (!ok) return;
    try {
      await deleteRoom(r);
      toast("방을 삭제했습니다.");
    } catch (ex) {
      console.error(ex);
      toast("삭제하지 못했습니다.");
    }
  });
}

// 학생 입장 링크. 코드가 미리 채워진다.
function joinUrl(code) {
  return new URL(`./?code=${code}`, location.href).href;
}

async function copyLink(code) {
  const url = joinUrl(code);
  try {
    await navigator.clipboard.writeText(url);
    toast("학생 입장 링크를 복사했습니다.");
  } catch {
    prompt("아래 링크를 복사하세요.", url);
  }
}

function qrSvg(text) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

function fmtDate(ts) {
  const d = ts?.toDate?.();
  if (!d) return "";
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

async function createRoom(e) {
  e.preventDefault();
  const btn = $("#create-btn");
  const err = $("#create-error");
  const topic = $("#topic").value.trim();
  const leftLabel = $("#left").value.trim() || DEFAULT_LEFT;
  const rightLabel = $("#right").value.trim() || DEFAULT_RIGHT;
  if (!topic) { err.textContent = "주제를 입력하세요."; return; }
  btn.disabled = true;
  err.textContent = "";

  const roomRef = doc(collection(db, "rooms"));
  try {
    for (let attempt = 0; ; attempt++) {
      const code = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
      try {
        await runTransaction(db, async (tx) => {
          const c = await tx.get(doc(db, "codes", code));
          if (c.exists()) throw new Error("CODE_TAKEN");
          tx.set(roomRef, {
            ownerUid: user.uid, topic, leftLabel, rightLabel, code, round: 1, createdAt: serverTimestamp(),
          });
          tx.set(doc(db, "codes", code), { roomId: roomRef.id, ownerUid: user.uid });
        });
        break;
      } catch (ex) {
        if (ex.message !== "CODE_TAKEN" || attempt >= 9) throw ex;
      }
    }
    location.hash = `#room/${roomRef.id}`;
  } catch (ex) {
    console.error(ex);
    err.textContent = "방을 만들지 못했습니다.";
    btn.disabled = false;
  }
}

// 방에 딸린 참여자·이름 기록을 모두 지운 뒤 방과 접속 코드를 지운다
async function deleteRoom(r) {
  const [ps, ns, cs, pm] = await Promise.all([
    getDocs(collection(db, "rooms", r.id, "participants")),
    getDocs(collection(db, "rooms", r.id, "names")),
    getDocs(collection(db, "rooms", r.id, "cards")),
    getDocs(collection(db, "rooms", r.id, "pmi")),
  ]);
  await Promise.all([...ps.docs, ...ns.docs, ...cs.docs, ...pm.docs].map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "codes", r.code));
  await deleteDoc(doc(db, "rooms", r.id));
}

// ---------- 방 화면 ----------

function openRoom(roomId) {
  const s = {
    roomId,
    room: null,
    people: [],              // 입장 순서대로
    allMode: false,          // 모두 보기
    shown: new Set(),        // 화살표가 보이는 학생
    expanded: new Set(),     // 이유 상자가 열린 학생
    full: new Set(),         // 접힌 이유를 펼친 화살표 ("uid:1" / "uid:2")
    cards: [],               // 의견 카드, 낸 순서대로
    pmi: [],                 // PMI 쪽지, 붙인 순서대로
    pmiFocus: null,          // 칩으로 고른 학생(그 학생 쪽지만 또렷하게)
    showFirst: false,       // 2차 때 1차 화살표 함께 보기
    manage: false,           // 참여자 정리(삭제) 모드
    view: "main",            // main | cloud(워드클라우드)
    cloudSrc: null,          // cards | reason
    cloudRound: null,        // 1 | 2 | "all"
    cloudPmi: "all",         // all | P | M | I
    excluded: loadExcluded(roomId),
  };

  root.innerHTML = `<p class="wrap muted">불러오는 중…</p>`;

  unsubs.push(onSnapshot(doc(db, "rooms", roomId), (snap) => {
    if (!snap.exists() || snap.data().ownerUid !== user.uid) {
      root.innerHTML = `<main class="wrap"><div class="card"><p>방을 찾을 수 없습니다.</p><a class="btn" href="#" style="text-decoration:none">방 목록으로</a></div></main>`;
      return;
    }
    s.room = snap.data();
    draw(s);
  }, (ex) => {
    console.error(ex);
    root.innerHTML = `<main class="wrap"><div class="card"><p>방을 열 수 없습니다.</p><a class="btn" href="#" style="text-decoration:none">방 목록으로</a></div></main>`;
  }));

  unsubs.push(onSnapshot(collection(db, "rooms", roomId, "participants"), (snap) => {
    s.people = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => (a.joinedAt?.toMillis?.() ?? Infinity) - (b.joinedAt?.toMillis?.() ?? Infinity) || a.uid.localeCompare(b.uid));
    const alive = new Set(s.people.map((p) => p.uid));
    for (const set of [s.shown, s.expanded]) for (const u of set) if (!alive.has(u)) set.delete(u);
    draw(s);
  }, (ex) => console.error(ex)));

  unsubs.push(onSnapshot(collection(db, "rooms", roomId, "cards"), (snap) => {
    s.cards = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => (a.at?.toMillis?.() ?? Infinity) - (b.at?.toMillis?.() ?? Infinity));
    draw(s);
  }, (ex) => console.error(ex)));

  unsubs.push(onSnapshot(collection(db, "rooms", roomId, "pmi"), (snap) => {
    s.pmi = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.at?.toMillis?.() ?? Infinity) - (b.at?.toMillis?.() ?? Infinity) || a.id.localeCompare(b.id));
    draw(s);
  }, (ex) => console.error(ex)));

  root.onclick = (e) => onRoomClick(e, s);

  // 창 크기가 바뀌면 PMI 보드·워드클라우드를 다시 배치한다
  let resizeTimer = 0;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => draw(s), 200); };
  window.addEventListener("resize", onResize);
  unsubs.push(() => window.removeEventListener("resize", onResize));
}

function isShown(s, uid) {
  return s.allMode || s.shown.has(uid);
}

// 칩이나 화살표를 눌렀을 때
function toggleStudent(s, uid) {
  if (s.allMode) {
    // 모두 보기: 화살표는 그대로 두고 이유 상자만 열고 닫는다
    s.expanded.has(uid) ? s.expanded.delete(uid) : s.expanded.add(uid);
  } else if (s.shown.has(uid)) {
    s.shown.delete(uid);
    s.expanded.delete(uid);
  } else {
    s.shown.add(uid);
    s.expanded.add(uid);
  }
}

async function onRoomClick(e, s) {
  const t = e.target;
  if (!s.room) return;

  const word = t.closest(".cloud-word, [data-restore]");
  if (word) {
    if (word.dataset.restore === "*") s.excluded.clear();
    else if (word.dataset.restore) s.excluded.delete(word.dataset.restore);
    else s.excluded.add(word.dataset.word);
    saveExcluded(s.roomId, s.excluded);
    return draw(s);
  }
  const src = t.closest("[data-src]");
  if (src) {
    s.cloudSrc = src.dataset.src;
    return draw(s);
  }
  const rnd = t.closest("[data-rnd]");
  if (rnd) {
    s.cloudRound = rnd.dataset.rnd === "all" ? "all" : Number(rnd.dataset.rnd);
    return draw(s);
  }

  const pmiPick = t.closest("[data-pmi]");
  if (pmiPick) {
    s.cloudPmi = pmiPick.dataset.pmi;
    return draw(s);
  }

  const stageBtn = t.closest("[data-stage]");
  if (stageBtn) return changeStage(s, stageBtn.dataset.stage);

  const pmiNote = t.closest(".pmi-board .pmi-note");
  if (pmiNote) return openNote(s, pmiNote.dataset.id);

  const cardAct = t.closest("[data-card-act]");
  if (cardAct) return onCardAction(s, cardAct.dataset.cardAct, cardAct.dataset.uid);

  const chip = t.closest(".chip");
  if (chip) {
    const uid = chip.dataset.uid;
    if (s.manage) return removePerson(s, uid);
    if (s.room.stage === "cards") {
      // 카드 단계: 그 학생의 카드로 이동
      root.querySelector(`.note[data-uid="${uid}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (s.room.stage === "pmi") {
      // PMI 단계: 그 학생 쪽지만 또렷하게(다시 누르면 해제)
      s.pmiFocus = s.pmiFocus === uid ? null : uid;
      return draw(s);
    }
    toggleStudent(s, uid);
    return draw(s);
  }
  const arrow = t.closest(".arrow");
  if (arrow) {
    toggleStudent(s, arrow.dataset.uid);
    return draw(s);
  }
  const reason = t.closest(".reason, .more");
  if (reason) {
    const k = reason.dataset.key;
    s.full.has(k) ? s.full.delete(k) : s.full.add(k);
    return draw(s);
  }

  const act = t.closest("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "all") {
    s.allMode = !s.allMode;
    s.shown.clear();
    s.expanded.clear();
  } else if (act === "hide") {
    // 방에 저장해서 학생 카드 화면에도 함께 적용되고, 다시 열어도 그대로 남는다
    return roomUpdate(s, { hideNames: !s.room.hideNames });
  } else if (act === "cloud") {
    s.view = "cloud";
    s.cloudSrc ??= { cards: "cards", pmi: "pmi" }[s.room.stage] ?? "reason";
    s.cloudRound ??= s.room.round === 2 ? "all" : 1;
  } else if (act === "main") {
    s.view = "main";
  } else if (act === "puball") {
    // 지금 단계(의견 카드 / PMI)의 공개 전 글을 모두 공개
    const isPmi = s.room.stage === "pmi";
    const targets = isPmi
      ? s.pmi.filter((n) => n.status === "new").map((n) => doc(db, "rooms", s.roomId, "pmi", n.id))
      : s.cards.filter((c) => c.status === "new").map((c) => doc(db, "rooms", s.roomId, "cards", c.uid));
    const unit = isPmi ? "쪽지" : "카드";
    if (!targets.length) return toast(`새로 공개할 ${unit}가 없습니다.`);
    try {
      await Promise.all(targets.map((ref) => updateDoc(ref, { status: "public" })));
      toast(`${unit} ${targets.length}장을 공개했습니다.`);
    } catch (ex) {
      console.error(ex);
      toast(`공개하지 못한 ${unit}가 있습니다.`);
    }
    return;
  } else if (act === "first") {
    s.showFirst = !s.showFirst;
  } else if (act === "manage") {
    s.manage = !s.manage;
  } else if (act === "qr") {
    return showQR(s.room);
  } else if (act === "copy") {
    return copyLink(s.room.code);
  } else if (act === "again") {
    const ok = await confirmDialog({
      title: "다시 생각(2차)을 시작할까요?",
      body: "학생들이 수직선에서 다시 위치를 고르고 이유를 씁니다. 1차로 되돌릴 수 없습니다.",
      ok: "2차 시작",
    });
    if (!ok) return;
    try {
      await updateDoc(doc(db, "rooms", s.roomId), { round: 2 });
      s.showFirst = false;
    } catch (ex) {
      console.error(ex);
      toast("2차를 시작하지 못했습니다.");
    }
    return;
  }
  draw(s);
}

async function removePerson(s, uid) {
  const p = s.people.find((x) => x.uid === uid);
  if (!p) return;
  const ok = await confirmDialog({
    title: `${p.name} 참여자를 삭제할까요?`,
    body: "이 참여자의 선택과 이유가 함께 지워집니다.",
    ok: "삭제", danger: true,
  });
  if (!ok) return;
  try {
    await Promise.all(s.pmi.filter((n) => n.uid === uid).map((n) => deleteDoc(doc(db, "rooms", s.roomId, "pmi", n.id))));
    await deleteDoc(doc(db, "rooms", s.roomId, "cards", uid));
    await deleteDoc(doc(db, "rooms", s.roomId, "participants", uid));
    await deleteDoc(doc(db, "rooms", s.roomId, "names", p.name));
  } catch (ex) {
    console.error(ex);
    toast("삭제하지 못했습니다.");
  }
}

const STAGES = [
  { id: "line", label: "가치수직선" },
  { id: "pmi", label: "PMI" },
  { id: "cards", label: "의견 카드" },
];

async function changeStage(s, stage) {
  const cur = s.room.stage ?? "line";
  if (stage === cur) return;
  const label = STAGES.find((x) => x.id === stage)?.label ?? stage;
  const ok = await confirmDialog({
    title: `${label} 단계로 넘어갈까요?`,
    body: `학생 화면이 ${label}(으)로 바뀝니다. 다른 단계의 기록은 그대로 남고, 언제든 다시 돌아올 수 있습니다.`,
    ok: "넘어가기",
  });
  if (ok) await roomUpdate(s, { stage });
}

function stageBar(s) {
  const cur = s.room.stage ?? "line";
  return `<nav class="stages">${STAGES.map((st, i) => `
    <button class="stage ${st.id === cur ? "on" : ""}" data-stage="${st.id}">
      <span class="stage-no">${i + 1}</span>${st.label}
    </button>`).join(`<span class="stage-arrow">›</span>`)}</nav>`;
}

async function roomUpdate(s, data) {
  try {
    await updateDoc(doc(db, "rooms", s.roomId), data);
  } catch (ex) {
    console.error(ex);
    toast("바꾸지 못했습니다.");
  }
}

async function onCardAction(s, act, uid) {
  const ref = doc(db, "rooms", s.roomId, "cards", uid);
  try {
    if (act === "pub") await updateDoc(ref, { status: "public" });
    else if (act === "hide") await updateDoc(ref, { status: "hidden" });
    else if (act === "del") {
      const c = s.cards.find((x) => x.uid === uid);
      const ok = await confirmDialog({
        title: "이 카드를 삭제할까요?",
        body: `<div class="dlg-quote">${esc(c?.text ?? "")}</div>지운 카드는 되돌릴 수 없습니다.`,
        ok: "삭제", danger: true,
      });
      if (ok) await deleteDoc(ref);
    }
  } catch (ex) {
    console.error(ex);
    toast("처리하지 못했습니다.");
  }
}

function label(s, p) {
  return s.room.hideNames ? `${s.people.indexOf(p) + 1}번` : p.name;
}

function cardLabel(s, c) {
  const p = s.people.find((x) => x.uid === c.uid);
  if (!s.room.hideNames) return c.name;
  return p ? `${s.people.indexOf(p) + 1}번` : "";
}

function draw(s) {
  const { room, people } = s;
  if (!room) return;
  if (s.view === "cloud") return drawCloud(s);
  const round = room.round;
  const stage = room.stage ?? "line";
  const cardStage = stage === "cards";
  const pmiStage = stage === "pmi";
  const lineStage = stage === "line";
  const cardBy = new Map(s.cards.map((c) => [c.uid, c]));
  const pmiCount = new Map();
  for (const n of s.pmi) pmiCount.set(n.uid, (pmiCount.get(n.uid) ?? 0) + 1);
  const isDone = (p) => (cardStage ? cardBy.has(p.uid) : pmiStage ? pmiCount.has(p.uid) : !!p[`r${round}`]);
  const doneCount = people.filter(isDone).length;

  const chips = people.map((p) => {
    const done = isDone(p);
    const mv = round === 2 && lineStage ? moveLabel(p) : "";
    const focus = pmiStage && s.pmiFocus === p.uid;
    const cls = ["chip", done && "done", lineStage && isShown(s, p.uid) && "shown", (lineStage && s.expanded.has(p.uid) || focus) && "expanded"].filter(Boolean).join(" ");
    return `<button class="${cls}" data-uid="${p.uid}" title="${done ? "제출함" : "아직 안 냄"}">
      <span class="chk">${done ? "✓" : "…"}</span>
      <span>${esc(label(s, p))}</span>
      ${mv ? `<span class="move">${mv}</span>` : ""}
      ${pmiStage && pmiCount.has(p.uid) ? `<span class="move">${pmiCount.get(p.uid)}</span>` : ""}
      ${s.manage ? `<span class="x">✕</span>` : ""}
    </button>`;
  }).join("");

  const showUp = round === 2;
  const showDown = round === 1 || s.showFirst;

  root.innerHTML = `
    <div class="t-room">
      <header class="t-top">
        <a class="btn" href="#" style="text-decoration:none">← 목록</a>
        <div class="t-title">
          ${cardStage ? `<span class="badge">의견 카드</span>`
            : pmiStage ? `<span class="badge">PMI</span>`
            : `<span class="badge ${round === 2 ? "r2" : ""}">${round === 2 ? "다시 생각 (2차)" : "1차"}</span>`}
          <h1>${esc(room.topic)}</h1>
        </div>
        <div class="qr-mini">
          <button class="qr-mini-img" data-act="qr" title="크게 보기">${qrSvg(joinUrl(room.code))}</button>
          <button class="btn btn-small" data-act="copy">링크 복사</button>
        </div>
      </header>

      ${stageBar(s)}

      <div class="t-tools">
        ${lineStage ? `
          <button class="btn ${s.allMode ? "on" : ""}" data-act="all">모두 보기</button>
          <button class="btn ${room.hideNames ? "on" : ""}" data-act="hide">이름 숨기기</button>
          ${round === 1
            ? `<button class="btn btn-primary" data-act="again">다시 생각</button>`
            : `<button class="btn ${s.showFirst ? "on" : ""}" data-act="first">1차 보기</button>`}
          <button class="btn" data-act="cloud">워드클라우드</button>
        ` : `
          <button class="btn ${room.hideNames ? "on" : ""}" data-act="hide">이름 숨기기</button>
          <button class="btn btn-primary" data-act="puball">전체 공개</button>
          <button class="btn" data-act="cloud">워드클라우드</button>
        `}
        <span class="spacer"></span>
        <span class="count">${cardStage ? `카드 ${doneCount} / ${people.length}`
          : pmiStage ? `쪽지 ${s.pmi.length}장 · 쓴 학생 ${doneCount} / ${people.length}`
          : `${round}차 제출 ${doneCount} / ${people.length}`}</span>
        <button class="btn ${s.manage ? "on" : ""}" data-act="manage">${s.manage ? "정리 끝" : "참여자 정리"}</button>
      </div>

      <div class="chips ${s.manage ? "manage" : ""}">
        ${chips || `<span class="empty">학생이 입장하면 여기에 이름이 나타납니다.</span>`}
      </div>

      ${cardStage ? cardWall(s) : pmiStage ? `<div class="pmi-board" id="pmi-board"></div>` : `
      <div class="board">
        ${showUp ? lane(s, 2, "up") : ""}
        <div class="grid13 axis">
          <div class="end left" style="${posStyle(-5)}">${esc(room.leftLabel)}</div>
          ${POSITIONS.map((p, i) => `<div class="t ${p === 0 ? "zero" : ""} ${i === 10 ? "last" : ""}" style="${posStyle(p)}"></div>`).join("")}
          <div class="end right" style="${posStyle(5)}">${esc(room.rightLabel)}</div>
        </div>
        ${showDown ? lane(s, 1, "down") : ""}
      </div>`}
    </div>`;

  markClamped();
  if (pmiStage) drawPmiBoard(s);
}

// ---------- PMI 보드 ----------
// 큰 P·M·I 원 세 개를 두고, 쪽지를 자기 원 둘레에 나선을 따라 겹치지 않게 붙인다.

const HUBS = { P: { x: 0.75, y: 0.3 }, M: { x: 0.26, y: 0.38 }, I: { x: 0.52, y: 0.7 } };
const HUB_START = { P: -0.6, M: 3.4, I: 1.6 };   // 원마다 쪽지를 붙이기 시작하는 방향(라디안)

function drawPmiBoard(s) {
  const board = $("#pmi-board");
  if (!board) return;
  const W = board.clientWidth;
  const R = Math.round(Math.max(62, Math.min(118, W * 0.068)));
  const hide = !!s.room.hideNames;
  const byType = (t) => s.pmi.filter((n) => n.type === t).length;
  const who = (n) => {
    if (!hide) return n.name;
    const i = s.people.findIndex((p) => p.uid === n.uid);
    return i >= 0 ? `${i + 1}번` : "";
  };
  const tag = { new: "공개 전", hidden: "숨김" };

  board.innerHTML = PMI_TYPES.map((t) => `
    <div class="pmi-hub" data-type="${t}" style="${pmiStyle(t)};width:${R * 2}px;height:${R * 2}px">
      <b>${t}</b><span>(${PMI[t].label})</span><small>${PMI[t].ask}</small><em>${byType(t)}</em>
    </div>`).join("")
    + s.pmi.map((n) => `
    <button class="pmi-note st-${n.status} ${s.pmiFocus && s.pmiFocus !== n.uid ? "dim" : ""}" data-id="${n.id}" style="${pmiStyle(n.type)}">
      <span class="pmi-note-head">
        <span class="pmi-dot">${n.type}</span>
        <span class="pmi-name">${esc(who(n))}</span>
        ${tag[n.status] ? `<span class="note-tag">${tag[n.status]}</span>` : ""}
      </span>
      <span class="pmi-note-text">${esc(n.text)}</span>
    </button>`).join("")
    + (s.pmi.length ? "" : `<p class="pmi-empty">학생들이 쪽지를 붙이면 P·M·I 원 둘레에 모입니다.</p>`);

  const hubs = [...board.querySelectorAll(".pmi-hub")];
  const notes = [...board.querySelectorAll(".pmi-note")];
  const sizes = notes.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));

  // 자리가 모자라면 보드를 키워서 다시 놓는다
  let H = Math.max(560, Math.round(window.innerHeight * 0.72));
  for (let attempt = 0; attempt < 8; attempt++) {
    const spots = placePmi(s.pmi, sizes, W, H, R);
    if (spots) {
      board.style.height = `${H}px`;
      hubs.forEach((el) => {
        const c = HUBS[el.dataset.type];
        el.style.left = `${c.x * W - R}px`;
        el.style.top = `${c.y * H - R}px`;
      });
      notes.forEach((el, i) => {
        el.style.left = `${spots[i].x}px`;
        el.style.top = `${spots[i].y}px`;
      });
      return;
    }
    H = Math.round(H * 1.25);
  }
}

function placePmi(list, sizes, W, H, R) {
  const GAP = 6;
  const circles = PMI_TYPES.map((t) => ({ x: HUBS[t].x * W, y: HUBS[t].y * H, r: R + GAP }));
  const placed = [];
  const hitsCircle = (x, y, w, h) => circles.some((c) => {
    const dx = c.x - Math.max(x, Math.min(c.x, x + w));
    const dy = c.y - Math.max(y, Math.min(c.y, y + h));
    return dx * dx + dy * dy < c.r * c.r;
  });
  const hitsNote = (x, y, w, h) => placed.some((p) =>
    x < p.x + p.w + GAP && x + w + GAP > p.x && y < p.y + p.h + GAP && y + h + GAP > p.y);

  for (let i = 0; i < list.length; i++) {
    const { w, h } = sizes[i];
    const hub = HUBS[list[i].type];
    const cx = hub.x * W;
    const cy = hub.y * H;
    let spot = null;
    for (let step = 0; step < 2500 && !spot; step++) {
      const a = HUB_START[list[i].type] + step * 0.22;
      const r = R * 0.9 + 3.2 * step * 0.22 * 2.2;
      const x = cx + r * Math.cos(a) * 1.35 - w / 2;   // 가로로 조금 더 넓게 퍼지게
      const y = cy + r * Math.sin(a) - h / 2;
      if (x < 4 || y < 4 || x + w > W - 4 || y + h > H - 4) continue;
      if (hitsCircle(x, y, w, h) || hitsNote(x, y, w, h)) continue;
      spot = { x, y, w, h };
    }
    if (!spot) return null;
    placed.push(spot);
  }
  return placed;
}

// 쪽지를 누르면: 전체 글 보기 + 공개·숨기기·삭제
function openNote(s, id) {
  const n = s.pmi.find((x) => x.id === id);
  if (!n) return;
  const ref = doc(db, "rooms", s.roomId, "pmi", id);
  const dlg = document.createElement("dialog");
  dlg.className = "dlg";
  dlg.innerHTML = `
    <div style="padding:22px">
      <div class="pmi-note-head" style="${pmiStyle(n.type)};margin-bottom:10px">
        <span class="pmi-dot">${n.type}</span>
        <b style="font-weight:400;font-size:20px">${esc(s.room.hideNames ? "" : n.name)}</b>
        <span class="muted small">${PMI[n.type].label} · ${PMI[n.type].ask}</span>
      </div>
      <div class="dlg-quote" style="font-size:18px;max-height:50vh">${esc(n.text)}</div>
      <div class="dlg-actions">
        <button class="btn btn-danger" data-v="del">삭제</button>
        <span style="flex:1"></span>
        ${n.status === "public"
          ? `<button class="btn" data-v="hidden">숨기기</button>`
          : `<button class="btn btn-primary" data-v="public">공개</button>`}
        <button class="btn" data-v="close">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  const close = () => { if (dlg.open) dlg.close(); dlg.remove(); };
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("click", async (e) => {
    if (e.target === dlg) return close();   // 바깥(배경)을 누르면 닫기
    const v = e.target.closest("[data-v]")?.dataset.v;
    if (!v) return;
    close();
    try {
      if (v === "del") await deleteDoc(ref);
      else if (v === "public" || v === "hidden") await updateDoc(ref, { status: v });
    } catch (ex) {
      console.error(ex);
      toast("처리하지 못했습니다.");
    }
  });
  dlg.showModal();
}

// ---------- 워드클라우드 ----------

function cloudTexts(s) {
  if (s.cloudSrc === "cards") return s.cards.filter((c) => c.status !== "hidden").map((c) => c.text);
  if (s.cloudSrc === "pmi") {
    return s.pmi.filter((n) => n.status !== "hidden" && (s.cloudPmi === "all" || n.type === s.cloudPmi)).map((n) => n.text);
  }
  const rounds = s.cloudRound === "all" ? [1, 2] : [s.cloudRound];
  return s.people.flatMap((p) => rounds.map((r) => p[`r${r}`]?.reason).filter(Boolean));
}

// 글 목록이 같으면 다시 분석하지 않는다(학생 제출 때마다 화면이 다시 그려지므로)
let cloudMemo = { key: null, all: null, simple: false };
let cloudSeq = 0;

async function analyzeTexts(texts, onStatus) {
  const key = JSON.stringify(texts);
  if (cloudMemo.key === key) return cloudMemo;
  let all;
  let simple = false;
  try {
    const kiwi = await loadAnalyzer((done, total, first) => onStatus(
      first
        ? `단어 분석기를 준비하고 있습니다… ${done}/${total}<br><small>처음 한 번만 약 47MB를 내려받습니다. 다음부터는 바로 열립니다.</small>`
        : "단어 분석기를 준비하고 있습니다…"));
    all = await countNouns(kiwi, texts);
  } catch (ex) {
    console.error(ex);
    all = countWords(texts);
    simple = true;
  }
  cloudMemo = { key, all, simple };
  return cloudMemo;
}

function drawCloud(s) {
  const texts = cloudTexts(s);
  const memoHit = cloudMemo.key === JSON.stringify(texts);
  const pick = (attr, val, cur, text) =>
    `<button class="btn ${String(cur) === String(val) ? "on" : ""}" ${attr}="${val}">${text}</button>`;

  root.innerHTML = `
    <div class="t-room">
      <header class="t-top">
        <button class="btn" data-act="main">← 돌아가기</button>
        <div class="t-title">
          <span class="badge">워드클라우드</span>
          <h1>${esc(s.room.topic)}</h1>
        </div>
      </header>

      <div class="t-tools">
        ${pick("data-src", "cards", s.cloudSrc, "의견 카드")}
        ${pick("data-src", "reason", s.cloudSrc, "수직선 이유")}
        ${pick("data-src", "pmi", s.cloudSrc, "PMI")}
        ${s.cloudSrc === "pmi" ? `
          <span class="tool-sep"></span>
          ${pick("data-pmi", "all", s.cloudPmi, "P+M+I")}
          ${PMI_TYPES.map((t) => pick("data-pmi", t, s.cloudPmi, t)).join("")}` : ""}
        ${s.cloudSrc === "reason" ? `
          <span class="tool-sep"></span>
          ${pick("data-rnd", 1, s.cloudRound, "1차")}
          ${pick("data-rnd", 2, s.cloudRound, "2차")}
          ${pick("data-rnd", "all", s.cloudRound, "1차+2차")}` : ""}
        <span class="spacer"></span>
        <span class="count" id="cloud-count">글 ${texts.length}개</span>
      </div>

      <div class="cloud" id="cloud">
        ${memoHit ? "" : `<p class="cloud-status" id="cloud-status">단어를 분석하고 있습니다…</p>`}
      </div>
      <p class="cloud-help" id="cloud-help">단어를 누르면 워드클라우드에서 뺍니다.</p>

      ${s.excluded.size ? `
        <div class="excluded">
          <span>뺀 단어</span>
          ${[...s.excluded].map((w) => `<button class="ex-word" data-restore="${esc(w)}" title="되돌리기">${esc(w)} ↺</button>`).join("")}
          <button class="ex-word all" data-restore="*">모두 되돌리기</button>
        </div>` : ""}
    </div>`;

  const seq = ++cloudSeq;
  const status = (html) => { const el = $("#cloud-status"); if (el && seq === cloudSeq) el.innerHTML = html; };
  const show = ({ all, simple }) => {
    if (seq !== cloudSeq || !$("#cloud")) return;   // 그사이 화면이 바뀌었으면 그리지 않는다
    const entries = all.filter(([w]) => !s.excluded.has(w)).slice(0, 70);
    $("#cloud-count").textContent = `글 ${texts.length}개 · 단어 ${all.length}개`;
    $("#cloud-help").textContent = simple
      ? "단어 분석기를 불러오지 못해 간단 방식(띄어쓰기·조사 자르기)으로 보여 줍니다. 단어를 누르면 뺍니다."
      : "명사만 모았습니다. 단어를 누르면 워드클라우드에서 뺍니다.";
    if (entries.length) layoutCloud($("#cloud"), entries);
    else $("#cloud").innerHTML = `<p class="cloud-status">아직 모인 글이 없습니다.</p>`;
  };
  if (memoHit) show(cloudMemo);
  else analyzeTexts(texts, status).then(show);
}

function loadExcluded(roomId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`cloud-excluded:${roomId}`) || "[]"));
  } catch {
    return new Set();
  }
}

function saveExcluded(roomId, set) {
  try {
    localStorage.setItem(`cloud-excluded:${roomId}`, JSON.stringify([...set]));
  } catch { /* 저장이 안 되는 환경이면 이번 화면에서만 유지 */ }
}

// 의견 카드 벽(교사용). 모든 카드가 보이고, 공개 전·숨김 카드는 흐리게 표시한다.
function cardWall(s) {
  if (!s.cards.length) return `<p class="wall-empty">학생들이 카드를 내면 여기에 모입니다.</p>`;
  const tag = { new: "공개 전", public: "공개됨", hidden: "숨김" };
  return `<div class="wall t-wall">${s.cards.map((c) => `
    <div class="note st-${c.status}" data-uid="${c.uid}" style="--note:${cardColor(c.uid)}">
      <div class="note-head">
        <span class="note-name">${esc(cardLabel(s, c))}</span>
        <span class="note-tag">${tag[c.status] ?? ""}</span>
      </div>
      <div class="note-text">${esc(c.text)}</div>
      <div class="note-foot">
        <span class="like-count">♥ ${likeCount(c)}</span>
        <span class="spacer"></span>
        ${c.status === "public"
          ? `<button class="mini" data-card-act="hide" data-uid="${c.uid}">숨기기</button>`
          : `<button class="mini pub" data-card-act="pub" data-uid="${c.uid}">공개</button>`}
        <button class="mini del" data-card-act="del" data-uid="${c.uid}">삭제</button>
      </div>
    </div>`).join("")}</div>`;
}

// 한 라운드의 화살표 줄. 같은 칸은 수직선에서 멀어지는 쪽으로 쌓는다.
function lane(s, r, dir) {
  const cols = POSITIONS.map((pos) => {
    const items = s.people
      .filter((p) => p[`r${r}`]?.pos === pos && isShown(s, p.uid))
      .map((p) => {
        const open = s.expanded.has(p.uid);
        const key = `${p.uid}:${r}`;
        return `<div class="item ${open ? "expanded" : ""}" style="${posStyle(pos)}">
          <button class="arrow" data-uid="${p.uid}" title="${esc(label(s, p))}">${esc(label(s, p))}</button>
          ${open ? `<div class="reason ${s.full.has(key) ? "full" : ""}" data-key="${key}">${esc(p[`r${r}`].reason)}</div>` : ""}
        </div>`;
      }).join("");
    return `<div class="col">${items}</div>`;
  }).join("");
  return `<div class="grid13 lane ${dir}">
    <span class="lane-tag">${r}차</span>${cols}<span></span>
  </div>`;
}

// 접혀서 잘린 이유 상자에 "더보기"를 붙인다
function markClamped() {
  root.querySelectorAll(".reason").forEach((el) => {
    const full = el.classList.contains("full");
    if (!full && el.scrollHeight <= el.clientHeight + 1) return;
    const more = document.createElement("button");
    more.className = "more";
    more.dataset.key = el.dataset.key;
    more.textContent = full ? "▲ 접기" : "▼ 더보기";
    el.insertAdjacentElement(el.closest(".lane.up") ? "beforebegin" : "afterend", more);
  });
}

// ---------- QR ----------

function showQR(room) {
  const url = joinUrl(room.code);
  const ov = document.createElement("div");
  ov.className = "qr-overlay";
  ov.innerHTML = `
    <div class="qr-card">
      <div class="qr">${qrSvg(url)}</div>
      <p class="url"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>
      <p class="code-line">접속 코드 <b>${esc(room.code)}</b></p>
      <div class="qr-actions">
        <button class="btn btn-primary" data-copy>링크 복사</button>
        <button class="btn" data-close>닫기</button>
      </div>
    </div>`;
  ov.addEventListener("click", (e) => {
    if (e.target.closest("[data-copy]")) return copyLink(room.code);
    if (e.target === ov || e.target.closest("[data-close]")) ov.remove();
  });
  document.body.appendChild(ov);
}
