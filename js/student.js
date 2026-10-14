import { app } from "./firebase.js";
import { POSITIONS, esc, $, cleanName, confirmDialog } from "./common.js";
import {
  initializeAuth, inMemoryPersistence, signInAnonymously,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, onSnapshot, runTransaction, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// 메모리에만 로그인 상태를 둔다 → 새로고침하거나 다시 들어오면 새 참여자가 된다(PRD 5-2)
const auth = initializeAuth(app, { persistence: inMemoryPersistence });
const db = getFirestore(app);

const state = {
  roomId: null,
  room: null,
  me: null,          // 내 participants 문서
  viewKey: "",       // 화면을 다시 그릴지 판단하는 값
  pos: null,         // 아직 제출하지 않은 선택
  reason: "",
  sending: false,
};

// ---------- 입장 ----------

const codeInput = $("#code");
const nameInput = $("#name");
const params = new URLSearchParams(location.search);
if (params.get("code")) {
  codeInput.value = params.get("code").replace(/\D/g, "").slice(0, 6);
  nameInput.focus();
}

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
    const finalName = await join(roomId, name);
    state.roomId = roomId;
    enterRoom(finalName);
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
  $("#join-view").hidden = true;
  $("#room-view").hidden = false;
  const uid = auth.currentUser.uid;

  onSnapshot(doc(db, "rooms", state.roomId), (snap) => {
    state.room = snap.exists() ? snap.data() : null;
    if (!state.room) return showEnded("수업 방이 닫혔습니다.");
    render();
  }, () => showEnded("수업 방에 연결할 수 없습니다."));

  onSnapshot(doc(db, "rooms", state.roomId, "participants", uid), (snap) => {
    if (!snap.exists()) {
      if (state.me) showEnded("선생님이 참여 목록을 정리했습니다. 다시 입장해 주세요.");
      return;
    }
    state.me = snap.data();
    render();
  });

  // 실수로 창을 닫거나 새로고침하지 않도록 경고(다시 들어오면 새 참여자가 되므로)
  window.addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = ""; });
}

function showEnded(msg) {
  state.viewKey = "ended";
  $("#room-view").innerHTML = `
    <div class="card">
      <p style="font-size:18px;font-weight:600;margin:0 0 16px">${esc(msg)}</p>
      <a class="btn btn-primary" href="index.html" style="text-decoration:none;display:inline-block">처음으로</a>
    </div>`;
}

// ---------- 화면 ----------

function render() {
  const { room, me } = state;
  if (!room || !me || state.viewKey === "ended") return;
  const round = room.round;
  const mine = me[`r${round}`];
  const key = [round, mine ? "done" : "todo", room.topic, room.leftLabel, room.rightLabel].join("|");
  if (key === state.viewKey) return;   // 입력 중인 내용이 지워지지 않도록 바뀐 게 있을 때만 다시 그린다
  if (state.viewKey && !state.viewKey.startsWith(`${round}|`)) { state.pos = null; state.reason = ""; }
  state.viewKey = key;

  const head = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
        <span class="badge ${round === 2 ? "r2" : ""}">${round === 2 ? "다시 생각 (2차)" : "1차"}</span>
        <span class="muted small">나: <b style="color:var(--ink)">${esc(me.name)}</b></span>
      </div>
      <h1 class="topic">${esc(room.topic)}</h1>
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
    <button type="button" class="tick ${p === 0 ? "zero" : ""} ${p === selPos ? "sel" : ""}"
      data-pos="${p}" ${locked ? "disabled" : ""} aria-label="${positionWords(room, p)}">
      <span class="dot"></span>
      ${ghost === p ? `<span class="ghost">1차</span>` : ""}
    </button>`).join("");
  return `
    <div class="picker">
      <div class="picker-ends"><span>◀ ${esc(room.leftLabel)}</span><span>${esc(room.rightLabel)} ▶</span></div>
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
