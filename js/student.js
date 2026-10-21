import { app } from "./firebase.js";
import {
  POSITIONS, esc, $, cleanName, confirmDialog, posStyle, cardColor, likeCount, toast,
  PMI, PMI_TYPES, pmiStyle,
} from "./common.js";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInAnonymously, signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, onSnapshot, runTransaction, updateDoc, serverTimestamp,
  collection, query, where, deleteField,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// 기기에 로그인 상태를 저장한다 → 새로고침하거나 튕겨도 같은 링크로 다시 열면 원래 참여자로 이어진다
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const db = getFirestore(app);

const state = {
  roomId: null,
  code: null,
  room: null,
  me: null,          // 내 participants 문서
  viewKey: "",       // 화면을 다시 그릴지 판단하는 값
  pos: null,         // 아직 제출하지 않은 선택
  reason: "",
  sending: false,
  myCard: null,      // 내 의견 카드
  wall: [],          // 공개된 카드들
  cardText: "",
  myNotes: [],       // 내가 붙인 PMI 쪽지
  pmiWall: [],       // 공개된 PMI 쪽지
  pmiType: "P",      // 쓰고 있는 칸
  pmiText: "",
};

// ---------- 입장 ----------

const codeInput = $("#code");
const nameInput = $("#name");
const params = new URLSearchParams(location.search);
const urlCode = (params.get("code") ?? "").replace(/\D/g, "").slice(0, 6);
if (urlCode) codeInput.value = urlCode;

// 마지막으로 들어간 방. { code, roomId, uid }
const SESSION_KEY = "vl-session";
function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function saveSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* 저장 불가 환경 */ }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* 저장 불가 환경 */ }
}

function participantRef(roomId) {
  return doc(db, "rooms", roomId, "participants", auth.currentUser.uid);
}

// 처음 열 때: 이 기기로 이미 들어가 있던 방이면 바로 이어서 들어간다
(async () => {
  try {
    await auth.authStateReady();
    const saved = readSession();
    if (auth.currentUser && saved?.uid === auth.currentUser.uid && (!urlCode || urlCode === saved.code)) {
      const snap = await getDoc(participantRef(saved.roomId));
      if (snap.exists()) {
        state.roomId = saved.roomId;
        state.code = saved.code;
        return enterRoom();
      }
    }
  } catch (ex) {
    console.error(ex);
  }
  $("#join-loading").hidden = true;
  $("#join-view").hidden = false;
  if (urlCode) nameInput.focus();
})();

$("#join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#join-error");
  const btn = $("#join-btn");
  err.textContent = "";
  const code = codeInput.value.replace(/\D/g, "");
  const name = cleanName(nameInput.value);
  if (code.length !== 6) { err.textContent = "접속 코드 6자리를 입력하세요."; return; }
  if (!name) { err.textContent = "이름을 입력하세요."; return; }

  btn.disabled = true;
  btn.textContent = "들어가는 중…";
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
    const codeSnap = await getDoc(doc(db, "codes", code));
    if (!codeSnap.exists()) throw new Error("접속 코드를 다시 확인하세요.");
    const roomId = codeSnap.data().roomId;
    // 이 기기로 이미 이 방에 들어와 있으면 새로 만들지 않고 이어서 들어간다
    const mine = await getDoc(participantRef(roomId));
    if (!mine.exists()) await join(roomId, name);
    state.roomId = roomId;
    state.code = code;
    saveSession({ code, roomId, uid: auth.currentUser.uid });
    enterRoom();
  } catch (ex) {
    console.error(ex);
    err.textContent = ex.message?.startsWith("접속") ? ex.message : "입장하지 못했습니다. 잠시 후 다시 시도하세요.";
    btn.disabled = false;
    btn.textContent = "입장하기";
  }
});

// 같은 이름이 있으면 김민준2, 김민준3 … 처럼 번호를 붙여 등록한다
async function join(roomId, base) {
  const uid = auth.currentUser.uid;
  return runTransaction(db, async (tx) => {
    let finalName = null;
    for (let i = 1; i <= 99 && !finalName; i++) {
      const cand = i === 1 ? base : `${base}${i}`;
      const snap = await tx.get(doc(db, "rooms", roomId, "names", cand));
      if (!snap.exists()) finalName = cand;
    }
    if (!finalName) throw new Error("이름을 등록하지 못했습니다.");
    tx.set(doc(db, "rooms", roomId, "participants", uid), { name: finalName, joinedAt: serverTimestamp() });
    tx.set(doc(db, "rooms", roomId, "names", finalName), { uid });
    return finalName;
  }, { maxAttempts: 10 });
}

function enterRoom() {
  $("#join-loading").hidden = true;
  $("#join-view").hidden = true;
  $("#room-view").hidden = false;
  const uid = auth.currentUser.uid;

  onSnapshot(doc(db, "rooms", state.roomId), (snap) => {
    state.room = snap.exists() ? snap.data() : null;
    if (!state.room) return showEnded("수업 방이 닫혔습니다.");
    render();
  }, () => showEnded("수업 방에 연결할 수 없습니다. 잠시 후 다시 열어 주세요.", { forget: false }));

  onSnapshot(doc(db, "rooms", state.roomId, "participants", uid), (snap) => {
    if (!snap.exists()) {
      if (state.me) showEnded("선생님이 참여 목록을 정리했습니다. 다시 입장해 주세요.");
      return;
    }
    state.me = snap.data();
    render();
  });

  onSnapshot(doc(db, "rooms", state.roomId, "cards", uid), (snap) => {
    state.myCard = snap.exists() ? snap.data() : null;
    render();
  }, (ex) => console.error(ex));

  onSnapshot(query(collection(db, "rooms", state.roomId, "cards"), where("status", "==", "public")), (snap) => {
    state.wall = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => (a.at?.toMillis?.() ?? 0) - (b.at?.toMillis?.() ?? 0));
    render();
  }, (ex) => console.error(ex));

  const pmiCol = collection(db, "rooms", state.roomId, "pmi");
  const byTime = (a, b) => (a.at?.toMillis?.() ?? Infinity) - (b.at?.toMillis?.() ?? Infinity);
  onSnapshot(query(pmiCol, where("uid", "==", uid)), (snap) => {
    state.myNotes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byTime);
    render();
  }, (ex) => console.error(ex));
  onSnapshot(query(pmiCol, where("status", "==", "public")), (snap) => {
    state.pmiWall = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byTime);
    render();
  }, (ex) => console.error(ex));

  // 머리글의 "다른 이름으로 새로 들어가기" (한 기기를 여러 학생이 번갈아 쓸 때)
  $("#room-view").addEventListener("click", async (e) => {
    if (!e.target.closest("[data-switch]")) return;
    const ok = await confirmDialog({
      title: "다른 이름으로 새로 들어갈까요?",
      body: `지금 <b>${esc(state.me?.name ?? "")}</b>(으)로 낸 기록은 그대로 남습니다.<br>이 기기에서는 새 이름으로 다시 입장합니다.`,
      ok: "새로 들어가기",
    });
    if (ok) restart();
  });
}

async function restart() {
  clearSession();
  try { await signOut(auth); } catch { /* 이미 로그아웃 */ }
  location.href = `./?code=${state.code ?? ""}`;
}

function showEnded(msg, { forget = true } = {}) {
  state.viewKey = "ended";
  if (forget) clearSession();
  $("#room-view").innerHTML = `
    <div class="card">
      <p style="font-size:18px;font-weight:600;margin:0 0 16px">${esc(msg)}</p>
      <a class="btn btn-primary" href="./?code=${esc(state.code ?? "")}" style="text-decoration:none;display:inline-block">처음으로</a>
    </div>`;
}

// ---------- 화면 ----------

function render() {
  const { room, me } = state;
  if (!room || !me || state.viewKey === "ended") return;
  if (room.stage === "cards") return renderCards();
  if (room.stage === "pmi") return renderPmi();
  const round = room.round;
  const mine = me[`r${round}`];
  const key = [round, mine ? "done" : "todo", room.topic, room.leftLabel, room.rightLabel].join("|");
  if (key === state.viewKey) return;   // 입력 중인 내용이 지워지지 않도록 바뀐 게 있을 때만 다시 그린다
  if (state.viewKey && !state.viewKey.startsWith(`${round}|`)) { state.pos = null; state.reason = ""; }
  state.viewKey = key;

  const head = `
    <div class="board-head">
      <span class="badge ${round === 2 ? "r2" : ""}">${round === 2 ? "다시 생각 (2차)" : "1차"}</span>
      <h1 class="topic" style="margin-top:10px">${esc(room.topic)}</h1>
      <div class="me">나: ${esc(me.name)} <button class="switch" data-switch>다른 이름으로 새로 들어가기</button></div>
    </div>`;

  if (mine) {
    $("#room-view").innerHTML = head + `
      <div class="card">
        ${picker(room, mine.pos, { locked: true })}
        <h3 style="margin:18px 0 8px;font-size:16px">나의 이유</h3>
        <div class="my-reason">${esc(mine.reason)}</div>
        <div class="done-box" style="margin-top:16px">제출했습니다. 선생님의 안내를 기다려 주세요.</div>
      </div>`;
    return;
  }

  const prev = round === 2 ? me.r1 : null;
  $("#room-view").innerHTML = head + `
    <div class="card">
      <p style="margin:0 0 6px;font-weight:600">수직선에서 내 생각과 가장 가까운 칸을 누르세요.</p>
      ${picker(room, state.pos, { ghost: prev?.pos })}
      ${prev ? `<div class="ref-box"><b>1차 때 나의 이유 (참고)</b>${esc(prev.reason)}</div>` : ""}
      <label class="field" style="margin-top:16px">
        <span>이유</span>
        <textarea id="reason" placeholder="왜 이 위치를 골랐는지 적어 주세요.">${esc(state.reason)}</textarea>
      </label>
      <button class="btn btn-primary btn-block" id="submit-btn">제출하기</button>
      <p class="error" id="submit-error"></p>
    </div>`;

  $("#room-view").querySelectorAll(".ticks .tick").forEach((b) => {
    b.addEventListener("click", () => {
      state.pos = Number(b.dataset.pos);
      $("#room-view").querySelectorAll(".ticks .tick").forEach((x) => x.classList.toggle("sel", x === b));
      updateSubmit();
    });
  });
  $("#reason").addEventListener("input", (e) => { state.reason = e.target.value; updateSubmit(); });
  $("#submit-btn").addEventListener("click", submit);
  updateSubmit();
}

function picker(room, selPos, { locked = false, ghost = null } = {}) {
  const ticks = POSITIONS.map((p) => `
    <button type="button" class="tick ${p === 0 ? "zero" : ""} ${p === selPos ? "sel" : ""}" style="${posStyle(p)}"
      data-pos="${p}" ${locked ? "disabled" : ""} aria-label="${positionWords(room, p)}">
      <span class="dot"></span>
      ${ghost === p ? `<span class="ghost">1차</span>` : ""}
    </button>`).join("");
  return `
    <div class="picker">
      <div class="picker-ends"><span style="${posStyle(-5)}">${esc(room.leftLabel)}</span><span style="${posStyle(5)}">${esc(room.rightLabel)}</span></div>
      <div class="ticks ${locked ? "locked" : ""}">${ticks}</div>
    </div>`;
}

// 화면에는 숫자를 보이지 않지만, 화면 읽기 프로그램용 설명은 붙여 둔다
function positionWords(room, p) {
  if (p === 0) return "가운데";
  return `${p < 0 ? room.leftLabel : room.rightLabel} 쪽 ${Math.abs(p)}칸`;
}

function updateSubmit() {
  const btn = $("#submit-btn");
  if (!btn) return;
  btn.disabled = state.sending || state.pos === null || state.reason.trim() === "";
  const err = $("#submit-error");
  if (state.pos === null) err.textContent = "";
}

async function submit() {
  const err = $("#submit-error");
  if (state.pos === null) { err.textContent = "칸을 먼저 고르세요."; return; }
  if (!state.reason.trim()) { err.textContent = "이유를 적어야 제출할 수 있습니다."; return; }

  const ok = await confirmDialog({
    title: "이 위치로 제출할까요?",
    body: `${picker(state.room, state.pos, { locked: true })}
      <p style="margin:12px 0 0">제출하면 바꿀 수 없습니다.</p>`,
    ok: "제출",
  });
  if (!ok) return;

  const round = state.room.round;
  state.sending = true;
  updateSubmit();
  try {
    await updateDoc(doc(db, "rooms", state.roomId, "participants", auth.currentUser.uid), {
      [`r${round}`]: { pos: state.pos, reason: state.reason.trim(), at: serverTimestamp() },
    });
  } catch (ex) {
    console.error(ex);
    err.textContent = "제출하지 못했습니다. 다시 시도해 주세요.";
  } finally {
    state.sending = false;
    updateSubmit();
  }
}

// ---------- 의견 카드 ----------

function renderCards() {
  const { room, me, myCard } = state;
  const key = ["cards", myCard ? `${myCard.status}:${likeCount(myCard)}` : "todo", room.topic].join("|");
  if (key !== state.viewKey) {
    state.viewKey = key;
    $("#room-view").innerHTML = `
      <div class="board-head">
        <span class="badge">의견 카드</span>
        <h1 class="topic" style="margin-top:10px">${esc(room.topic)}</h1>
        <div class="me">나: ${esc(me.name)} <button class="switch" data-switch>다른 이름으로 새로 들어가기</button></div>
      </div>
      <div id="my-card"></div>
      <h2 class="wall-title">친구들의 생각</h2>
      <div class="wall" id="wall"></div>`;
    drawMyCard();
  }
  drawWall();
}

function drawMyCard() {
  const box = $("#my-card");
  const c = state.myCard;
  if (c) {
    const msg = {
      new: "카드를 냈습니다. 선생님이 공개하면 아래에 나타납니다.",
      public: "내 카드가 공개되었습니다.",
      hidden: "선생님이 이 카드를 숨겼습니다.",
    }[c.status] ?? "";
    box.innerHTML = `
      <div class="card">
        <h3 style="font-size:18px;margin-bottom:10px">내 카드</h3>
        <div class="note" style="--note:${cardColor(auth.currentUser.uid)}">
          <div class="note-text">${esc(c.text)}</div>
          ${c.status === "public" ? `<div class="note-foot"><span class="like-count">♥ ${likeCount(c)}</span></div>` : ""}
        </div>
        <p class="muted small" style="margin:12px 0 0">${msg}</p>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="card">
      <label class="field">
        <span>토론을 마치며 내 생각을 써 주세요.</span>
        <textarea id="card-text" placeholder="오늘 토론에서 새롭게 알게 된 점, 바뀐 생각, 하고 싶은 말">${esc(state.cardText)}</textarea>
      </label>
      <button class="btn btn-primary btn-block" id="card-btn">카드 내기</button>
      <p class="error" id="card-error"></p>
    </div>`;
  const ta = $("#card-text");
  const btn = $("#card-btn");
  const sync = () => { btn.disabled = state.sending || !state.cardText.trim(); };
  ta.addEventListener("input", () => { state.cardText = ta.value; sync(); });
  btn.addEventListener("click", async () => {
    const text = state.cardText.trim();
    if (!text) return;
    const ok = await confirmDialog({
      title: "이 내용으로 카드를 낼까요?",
      body: "낸 뒤에는 고칠 수 없습니다.",
      ok: "카드 내기",
    });
    if (!ok) return;
    state.sending = true;
    sync();
    try {
      await setDoc(doc(db, "rooms", state.roomId, "cards", auth.currentUser.uid), {
        name: state.me.name, text, at: serverTimestamp(), status: "new", likes: {},
      });
    } catch (ex) {
      console.error(ex);
      $("#card-error").textContent = "카드를 내지 못했습니다. 다시 시도해 주세요.";
    } finally {
      state.sending = false;
      if ($("#card-btn")) sync();
    }
  });
  sync();
}

function drawWall() {
  const wall = $("#wall");
  if (!wall) return;
  const uid = auth.currentUser.uid;
  const hide = !!state.room.hideNames;
  if (!state.wall.length) {
    wall.innerHTML = `<p class="wall-empty">아직 공개된 카드가 없습니다.</p>`;
    return;
  }
  wall.innerHTML = state.wall.map((c) => {
    const mine = c.uid === uid;
    const liked = !!c.likes?.[uid];
    return `
      <div class="note ${mine ? "mine" : ""}" style="--note:${cardColor(c.uid)}">
        ${hide ? "" : `<div class="note-name">${esc(c.name)}${mine ? " (나)" : ""}</div>`}
        <div class="note-text">${esc(c.text)}</div>
        <div class="note-foot">
          ${mine
            ? `<span class="like-count">♥ ${likeCount(c)}</span>`
            : `<button class="like ${liked ? "on" : ""}" data-like="${c.uid}">${liked ? "♥" : "♡"} ${likeCount(c)}</button>`}
        </div>
      </div>`;
  }).join("");
  wall.querySelectorAll("[data-like]").forEach((b) => b.addEventListener("click", () => toggleLike(b.dataset.like)));
}

async function toggleLike(cardUid) {
  const uid = auth.currentUser.uid;
  const card = state.wall.find((c) => c.uid === cardUid);
  if (!card) return;
  try {
    await updateDoc(doc(db, "rooms", state.roomId, "cards", cardUid), {
      [`likes.${uid}`]: card.likes?.[uid] ? deleteField() : true,
    });
  } catch (ex) {
    console.error(ex);
    toast("좋아요를 누르지 못했습니다.");
  }
}

// ---------- PMI ----------

function renderPmi() {
  const { room, me } = state;
  const key = ["pmi", room.topic].join("|");
  if (key !== state.viewKey) {
    state.viewKey = key;
    $("#room-view").innerHTML = `
      <div class="board-head">
        <span class="badge">PMI</span>
        <h1 class="topic" style="margin-top:10px">${esc(room.topic)}</h1>
        <div class="me">나: ${esc(me.name)} <button class="switch" data-switch>다른 이름으로 새로 들어가기</button></div>
      </div>
      <div class="card">
        <p style="margin:0 0 10px;font-size:17px">어느 칸에 붙일까요?</p>
        <div class="pmi-pick">
          ${PMI_TYPES.map((t) => `
            <button type="button" class="pmi-type" data-type="${t}" style="${pmiStyle(t)}">
              <b>${t}</b><span>${PMI[t].ask}</span>
            </button>`).join("")}
        </div>
        <label class="field" style="margin-top:14px">
          <span id="pmi-label"></span>
          <textarea id="pmi-text" style="min-height:90px"></textarea>
        </label>
        <button class="btn btn-primary btn-block" id="pmi-btn">쪽지 붙이기</button>
        <p class="error" id="pmi-error"></p>
        <p class="muted small" style="margin:6px 0 0">여러 장 붙일 수 있습니다. 붙인 쪽지는 고칠 수 없고, 선생님이 공개하면 친구들에게 보입니다.</p>
      </div>
      <h2 class="wall-title">내가 붙인 쪽지</h2>
      <div class="pmi-mine" id="pmi-mine"></div>
      <h2 class="wall-title">친구들의 PMI</h2>
      <div id="pmi-wall"></div>`;

    const ta = $("#pmi-text");
    ta.value = state.pmiText;
    ta.addEventListener("input", () => { state.pmiText = ta.value; syncPmiForm(); });
    $("#room-view").querySelectorAll(".pmi-type").forEach((b) => b.addEventListener("click", () => {
      state.pmiType = b.dataset.type;
      syncPmiForm();
      ta.focus();
    }));
    $("#pmi-btn").addEventListener("click", submitNote);
    syncPmiForm();
  }
  drawPmiLists();
}

function syncPmiForm() {
  const t = state.pmiType;
  $("#room-view").querySelectorAll(".pmi-type").forEach((b) => b.classList.toggle("on", b.dataset.type === t));
  $("#pmi-label").innerHTML = `<b style="color:${PMI[t].strong}">${t}</b> ${PMI[t].label} · ${PMI[t].ask}`;
  $("#pmi-text").placeholder = { P: "이 주제의 좋은 점, 긍정적인 면", M: "이 주제의 나쁜 점, 부정적인 면", I: "좋고 나쁨을 떠나 흥미롭거나 궁금한 점" }[t];
  $("#pmi-btn").disabled = state.sending || !state.pmiText.trim();
}

async function submitNote() {
  const text = state.pmiText.trim();
  if (!text) return;
  state.sending = true;
  syncPmiForm();
  try {
    await addDoc(collection(db, "rooms", state.roomId, "pmi"), {
      uid: auth.currentUser.uid, name: state.me.name, type: state.pmiType, text,
      at: serverTimestamp(), status: "new",
    });
    state.pmiText = "";
    $("#pmi-text").value = "";
    $("#pmi-error").textContent = "";
    toast(`${state.pmiType} 칸에 쪽지를 붙였습니다.`);
  } catch (ex) {
    console.error(ex);
    $("#pmi-error").textContent = "쪽지를 붙이지 못했습니다. 다시 시도해 주세요.";
  } finally {
    state.sending = false;
    if ($("#pmi-btn")) syncPmiForm();
  }
}

function noteHtml(n, { showName = true, tag = "" } = {}) {
  return `
    <div class="pmi-note" style="${pmiStyle(n.type)}">
      <div class="pmi-note-head">
        <span class="pmi-dot">${n.type}</span>
        ${showName ? `<span class="pmi-name">${esc(n.name)}</span>` : ""}
        ${tag ? `<span class="note-tag">${tag}</span>` : ""}
      </div>
      <div class="pmi-note-text">${esc(n.text)}</div>
    </div>`;
}

function drawPmiLists() {
  const mine = $("#pmi-mine");
  const wall = $("#pmi-wall");
  if (!mine || !wall) return;
  const tag = { new: "공개 전", public: "공개됨", hidden: "숨김" };
  mine.innerHTML = state.myNotes.length
    ? state.myNotes.map((n) => noteHtml(n, { showName: false, tag: tag[n.status] })).join("")
    : `<p class="wall-empty">아직 붙인 쪽지가 없습니다.</p>`;

  const hide = !!state.room.hideNames;
  if (!state.pmiWall.length) {
    wall.innerHTML = `<p class="wall-empty">아직 공개된 쪽지가 없습니다.</p>`;
    return;
  }
  wall.innerHTML = PMI_TYPES.map((t) => {
    const notes = state.pmiWall.filter((n) => n.type === t);
    return `
      <section class="pmi-group" style="${pmiStyle(t)}">
        <h3><span class="pmi-dot">${t}</span> ${PMI[t].label} <small>${PMI[t].ask}</small></h3>
        ${notes.length ? notes.map((n) => noteHtml(n, { showName: !hide })).join("") : `<p class="wall-empty">아직 없습니다.</p>`}
      </section>`;
  }).join("");
}
