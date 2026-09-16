/**
 * Firestore ストア（代表の実運用）
 * ------------------------------------------------------------------
 * 代表がログインしている時だけ生成される。tasks コレクションを
 * リアルタイム購読し、承認・差し戻しを本番DBへ書き込む。
 *
 * 読み書きできるかどうかの判断は firestore.rules に一本化されている。
 * このファイルで UID を見て分岐してはいけない（CLAUDE.md ルール6）。
 */

import { ensureFirebase } from '../app-firebase.js';

export function createFirebaseStore() {
  let detach = null;

  return {
    kind: 'firebase',
    /**
     * 本番DBへの一括取り込みは既存データを壊すため、ボタン1つでは行わない。
     * 書き出し（バックアップ）のみ許可する。
     */
    canImport: false,

    async start(onChange) {
      const { db, storeMod } = await ensureFirebase();
      await new Promise((resolve, reject) => {
        let settled = false;
        detach = storeMod.onSnapshot(
          storeMod.collection(db, 'tasks'),
          (snap) => {
            onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
            if (!settled) { settled = true; resolve(); }
          },
          (err) => {
            console.error('[vcv] tasks subscribe error', err);
            if (!settled) { settled = true; reject(err); }
          }
        );
      });
    },

    async dispose() {
      if (detach) detach();
      detach = null;
    },

    async approveTask(taskId, approverName) {
      const { db, storeMod } = await ensureFirebase();
      await storeMod.updateDoc(storeMod.doc(db, 'tasks', taskId), {
        status: 'done',
        approved_at: new Date().toISOString(),
        approved_by: approverName,
        reject_reason: ''
      });
    },

    async rejectTask(taskId, reason) {
      const { db, storeMod } = await ensureFirebase();
      await storeMod.updateDoc(storeMod.doc(db, 'tasks', taskId), {
        status: 'review',
        approved_at: null,
        approved_by: null,
        reject_reason: reason || ''
      });
    },

    async exportAll() {
      const { db, storeMod } = await ensureFirebase();
      const snap = await storeMod.getDocs(storeMod.collection(db, 'tasks'));
      return {
        format: 'vcv-export',
        version: 1,
        exported_at: new Date().toISOString(),
        tasks: snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      };
    },

    async importAll() {
      throw new Error('本番DBへの一括取り込みは行いません。書き出しのみ利用できます。');
    }
  };
}
