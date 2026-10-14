import { app } from "./firebase.js";
import {
  POSITIONS, DEFAULT_LEFT, DEFAULT_RIGHT, esc, $, moveLabel, confirmDialog, toast,
} from "./common.js";
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
          <a class="btn btn-primary" href="#room/${r.id}" style="text-decoration:none">열기</a>
          <button class="btn" data-del="${r.id}">삭제</button>
        </div>
      </li>`).join("") : `<li class="muted" style="padding:12px 0">아직 만든 방이 없습니다.</li>`;
  }, (ex) => {
    console.error(ex);
    $("#rooms").innerHTML = `<li class="error">방 목록을 불러오지 못했습니다.</li>`;
  }));

  $("#rooms").addEventListener("click", async (e) => {
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
  const [ps, ns] = await Promise.all([
    getDocs(collection(db, "rooms", r.id, "participants")),
    getDocs(collection(db, "rooms", r.id, "names")),
  ]);
  await Promise.all([...ps.docs, ...ns.docs].map((d) => deleteDoc(d.ref)));
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
    hideNames: false,
    showFirst: false,        // 2차 때 1차 화살표 함께 보기
    manage: false,           // 참여자 정리(삭제) 모드
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

  root.onclick = (e) => onRoomClick(e, s);
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

  const chip = t.closest(".chip");
  if (chip) {
    const uid = chip.dataset.uid;
    if (s.manage) return removePerson(s, uid);
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
    s.hideNames = !s.hideNames;
  } else if (act === "first") {
    s.showFirst = !s.showFirst;
  } else if (act === "manage") {
    s.manage = !s.manage;
  } else if (act === "qr") {
    return showQR(s.room);
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
    await deleteDoc(doc(db, "rooms", s.roomId, "participants", uid));
    await deleteDoc(doc(db, "rooms", s.roomId, "names", p.name));
  } catch (ex) {
    console.error(ex);
    toast("삭제하지 못했습니다.");
  }
}

function label(s, p) {
  return s.hideNames ? `${s.people.indexOf(p) + 1}번` : p.name;
}

function draw(s) {
  const { room, people } = s;
  if (!room) return;
  const round = room.round;
  const doneCount = people.filter((p) => p[`r${round}`]).length;

  const chips = people.map((p) => {
    const done = !!p[`r${round}`];
    const mv = round === 2 ? moveLabel(p) : "";
    const cls = ["chip", done && "done", isShown(s, p.uid) && "shown", s.expanded.has(p.uid) && "expanded"].filter(Boolean).join(" ");
    return `<button class="${cls}" data-uid="${p.uid}" title="${done ? "제출함" : "아직 안 냄"}">
      <span class="chk">${done ? "✓" : "…"}</span>
      <span>${esc(label(s, p))}</span>
      ${mv ? `<span class="move">${mv}</span>` : ""}
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
          <span class="badge ${round === 2 ? "r2" : ""}">${round === 2 ? "다시 생각 (2차)" : "1차"}</span>
          <h1>${esc(room.topic)}</h1>
        </div>
        <button class="code-chip" data-act="qr"><small>접속 코드 · QR</small><b>${esc(room.code)}</b></button>
      </header>

      <div class="t-tools">
        <button class="btn ${s.allMode ? "on" : ""}" data-act="all">모두 보기</button>
        <button class="btn ${s.hideNames ? "on" : ""}" data-act="hide">이름 숨기기</button>
        ${round === 1
          ? `<button class="btn btn-primary" data-act="again">다시 생각</button>`
          : `<button class="btn ${s.showFirst ? "on" : ""}" data-act="first">1차 보기</button>`}
        <span class="spacer"></span>
        <span class="count">${round}차 제출 ${doneCount} / ${people.length}</span>
        <button class="btn ${s.manage ? "on" : ""}" data-act="manage">${s.manage ? "정리 끝" : "참여자 정리"}</button>
      </div>

      <div class="chips ${s.manage ? "manage" : ""}">
        ${chips || `<span class="empty">학생이 입장하면 여기에 이름이 나타납니다.</span>`}
      </div>

      <div class="board">
        ${showUp ? lane(s, 2, "up") : ""}
        <div class="grid13 axis">
          <div class="end left">${esc(room.leftLabel)}</div>
          ${POSITIONS.map((p, i) => `<div class="t ${p === 0 ? "zero" : ""} ${i === 0 ? "first" : ""} ${i === 10 ? "last" : ""}"></div>`).join("")}
          <div class="end right">${esc(room.rightLabel)}</div>
        </div>
        ${showDown ? lane(s, 1, "down") : ""}
      </div>
    </div>`;

  markClamped();
}

// 한 라운드의 화살표 줄. 같은 칸은 수직선에서 멀어지는 쪽으로 쌓는다.
function lane(s, r, dir) {
  const cols = POSITIONS.map((pos) => {
    const items = s.people
      .filter((p) => p[`r${r}`]?.pos === pos && isShown(s, p.uid))
      .map((p) => {
        const open = s.expanded.has(p.uid);
        const key = `${p.uid}:${r}`;
        return `<div class="item ${open ? "expanded" : ""}">
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
  const url = new URL(`index.html?code=${room.code}`, location.href).href;
  const qr = window.qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const ov = document.createElement("div");
  ov.className = "qr-overlay";
  ov.innerHTML = `
    <div class="qr-card">
      <div class="qr">${qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true })}</div>
      <div class="big-code">${esc(room.code)}</div>
      <p class="url">${esc(url)}</p>
      <button class="btn">닫기</button>
    </div>`;
  ov.addEventListener("click", () => ov.remove());
  document.body.appendChild(ov);
}
