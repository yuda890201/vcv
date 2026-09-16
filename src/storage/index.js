/**
 * ストレージ層の入口（設計ルール1「保存処理は1か所にまとめる」）
 * ------------------------------------------------------------------
 * 画面側（index.html）は保存処理を直接書かず、ここが返すストアだけを呼ぶ。
 * ストアを差し替えれば 体験版（端末内保存） / 代表用（Firestore）が入れ替わる。
 *
 * 共通インターフェース:
 *   kind        … 'local' | 'firebase'
 *   canImport   … 一括取り込みを許可してよいか
 *   start(onChange)          購読開始。タスク配列が来るたび onChange が呼ばれる
 *   dispose()                購読解除
 *   approveTask(id, 承認者)
 *   rejectTask(id, 理由)
 *   exportAll()              → { format, version, exported_at, tasks }
 *   importAll(data)
 *
 * Firestore 実装は「代表がログインした時」だけ動的 import する。
 * 体験版の来訪者は Firebase SDK を1バイトも読み込まない。
 */

import { createLocalStore } from './local.js';

let current = null;

/**
 * 使用するストアを切り替える。前のストアは必ず購読解除される。
 * @param {'local'|'firebase'} kind
 * @param {(tasks: object[]) => void} onChange
 * @returns {Promise<object>} 有効になったストア
 */
async function use(kind, onChange) {
  if (current) {
    try { await current.dispose(); } catch (err) { console.warn('[vcv] ストアの解放に失敗', err); }
    current = null;
  }

  if (kind === 'firebase') {
    const { createFirebaseStore } = await import('./firebase.js');
    const store = createFirebaseStore();
    await store.start(onChange);   // 失敗したら例外。呼び出し側が local へ退避する
    current = store;
    return store;
  }

  const store = createLocalStore();
  await store.start(onChange);
  current = store;
  return store;
}

window.VCV_STORE = {
  use,
  get current() { return current; }
};
