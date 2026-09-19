/**
 * 端末間の受け渡し用 QR 表示モジュール
 * ------------------------------------------------------------------
 * 方式: A案（URLのみ）
 *   QR に載せるのは公開済み GitHub Pages の URL だけ。
 *   トークン・認証情報・店舗情報の類は一切載せない。
 *   スマホ側は従来どおり自前でログインするため、QR を盗み見られても
 *   それだけでは何も開けない（＝QR 自体は秘密情報ではない）。
 *
 * 注意:
 *   - CLAUDE.md ルール5 により、QR に埋める URL へ実店舗名・実店舗IDを
 *     含むクエリを付けないこと。現状は URL のみなので該当しない。
 *   - ライブラリ(src/vendor/qrcode.mjs)は「QRを表示する瞬間」に
 *     動的 import する。デモ来訪者の初回読み込み量は 0 バイトのまま。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 静粛領域（QR規格上は4モジュール以上必要） */
const QUIET_ZONE = 4;

let qrcodeFactory = null;

/** ライブラリを必要になった時だけ読み込む */
async function ensureLib() {
  if (!qrcodeFactory) {
    const mod = await import('./vendor/qrcode.mjs');
    qrcodeFactory = mod.default;
  }
  return qrcodeFactory;
}

/**
 * QR を SVG として描画し、container の中身を差し替える。
 * innerHTML を使わず DOM API で組み立てる。
 *
 * @param {HTMLElement} container 描画先
 * @param {string} text           エンコードする文字列（URL）
 */
async function render(container, text) {
  const factory = await ensureLib();

  // 第1引数 0 = 収まる最小バージョンを自動選択 / 'M' = 誤り訂正レベル中
  const qr = factory(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QRコード');

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#ffffff');
  svg.appendChild(bg);

  // 横方向に連続する黒モジュールを1つの矩形にまとめて d を短くする
  let d = '';
  for (let r = 0; r < count; r += 1) {
    let c = 0;
    while (c < count) {
      if (!qr.isDark(r, c)) { c += 1; continue; }
      let run = 1;
      while (c + run < count && qr.isDark(r, c + run)) run += 1;
      d += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h${run}v1h-${run}z`;
      c += run;
    }
  }

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#0f172a');
  svg.appendChild(path);

  container.replaceChildren(svg);
}

window.VCV_QR = { render };
