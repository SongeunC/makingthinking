// 학생 화면과 교사 화면이 함께 쓰는 도구들

export const SDK = "https://www.gstatic.com/firebasejs/11.10.0";

// 눈금: 가운데 0, 좌우 5칸씩
export const POSITIONS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];

export const DEFAULT_LEFT = "매우 찬성";
export const DEFAULT_RIGHT = "매우 반대";

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

// 1차→2차 이동 표시. 오른쪽(+)은 ▶, 왼쪽(-)은 ◀
export function moveLabel(p) {
  if (!p.r1 || !p.r2) return "";
  const d = p.r2.pos - p.r1.pos;
  if (d === 0) return "유지";
  return d > 0 ? `▶${d}` : `◀${-d}`;
}

// 이름: 앞뒤 공백 제거, 문서 ID에 쓸 수 없는 '/' 제거, 20자 제한
export function cleanName(raw) {
  return String(raw ?? "").replace(/\//g, "").replace(/\s+/g, " ").trim().slice(0, 20);
}

// 확인 대화상자. <dialog>를 쓰고 true/false를 돌려준다.
export function confirmDialog({ title, body = "", ok = "확인", cancel = "취소", danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "dlg";
    dlg.innerHTML = `
      <form method="dialog">
        <h2>${esc(title)}</h2>
        <div class="dlg-body">${body}</div>
        <div class="dlg-actions">
          <button value="cancel" class="btn">${esc(cancel)}</button>
          <button value="ok" class="btn ${danger ? "btn-danger" : "btn-primary"}">${esc(ok)}</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue === "ok");
      dlg.remove();
    });
    dlg.showModal();
  });
}

export function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
