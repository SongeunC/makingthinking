// 업데이트 직후에도 항상 최신 파일을 받게 하는 로더.
// GitHub Pages는 파일을 브라우저에 10분간 저장해 두게 하므로, 우리 파일 주소에 매번 다른 꼬리표(?v=시각)를 붙인다.
// 사용: <script src="js/fresh.js" data-css="css/style.css" data-main="js/student.js"></script>
(function () {
  var me = document.currentScript;
  var v = Date.now();
  var base = new URL(".", me.src).href;          // .../js/
  var root = new URL("..", me.src).href;         // 사이트 맨 위

  // 모듈끼리 import 할 때도 꼬리표가 붙도록 import map을 만든다
  var modules = ["firebase.js", "common.js", "student.js", "teacher.js", "wordcloud.js"];
  var map = { imports: {} };
  modules.forEach(function (f) {
    map.imports[base + f] = base + f + "?v=" + v;
  });

  var html = "";
  (me.dataset.css || "").split(/\s+/).filter(Boolean).forEach(function (href) {
    html += '<link rel="stylesheet" href="' + root + href + "?v=" + v + '">';
  });
  // import map은 한 페이지에 하나만 둔다 → 첫 모듈을 불러오는 쪽(data-main)에서만 쓴다
  if (me.dataset.main) {
    html += '<script type="importmap">' + JSON.stringify(map) + "<\/script>";
    html += '<script type="module">import "' + root + me.dataset.main + '";<\/script>';
  }
  document.write(html);
})();
