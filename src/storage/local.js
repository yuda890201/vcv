/**
 * ローカル保存ストア（体験版）
 * ------------------------------------------------------------------
 * データは端末内の localStorage にのみ保存する。
 * Firebase には一切アクセスしない＝他人の利用で代表のFirebaseを消費しない。
 *
 * localStorage は以下の場合に読み書きが失敗する:
 *   - プライベートウィンドウ / サイトデータのブロック
 *   - 容量超過
 * そのため全ての読み書きを try/catch で包み、失敗時はメモリ上だけで
 * 動作を継続する（画面は壊れない。ただしリロードで消える）。
 */

import { SEED_TASKS } from './seed-tasks.js';

const STORAGE_KEY = 'vcv:tasks';

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.warn('[vcv] ローカル保存の読み込みに失敗しました', err);
    return null;
  }
}

function writeStored(tasks) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    return true;
  } catch (err) {
    console.warn('[vcv] ローカル保存の書き込みに失敗しました', err);
    return false;
  }
}

export function createLocalStore() {
  /** 端末に保存済みの状態。無ければ初期タスクを複製して始める */
  let tasks = readStored() || SEED_TASKS.map((t) => ({ ...t }));
  let listener = null;

  function emit() {
    if (listener) listener(tasks.map((t) => ({ ...t })));
  }

  function commit() {
    writeStored(tasks);
    emit();
  }

  function find(taskId) {
    return tasks.find((t) => t.id === taskId) || null;
  }

  return {
    kind: 'local',
    /** 端末内保存なので取り込みを許可してよい */
    canImport: true,

    async start(onChange) {
      listener = onChange;
      emit();
    },

    async dispose() {
      listener = null;
    },

    async approveTask(taskId, approverName) {
      const t = find(taskId);
      if (!t) throw new Error('タスクが見つかりません: ' + taskId);
      t.status = 'done';
      t.approved_by = approverName;
      t.approved_at = new Date().toISOString();
      t.reject_reason = '';
      commit();
    },

    async rejectTask(taskId, reason) {
      const t = find(taskId);
      if (!t) throw new Error('タスクが見つかりません: ' + taskId);
      t.status = 'review';
      t.approved_by = null;
      t.approved_at = null;
      t.reject_reason = reason || '';
      commit();
    },

    async exportAll() {
      return {
        format: 'vcv-export',
        version: 1,
        exported_at: new Date().toISOString(),
        tasks: tasks.map((t) => ({ ...t }))
      };
    },

    async importAll(data) {
      if (!data || data.format !== 'vcv-export' || !Array.isArray(data.tasks)) {
        throw new Error('vcv の書き出しファイルではないようです。');
      }
      tasks = data.tasks.map((t) => ({ ...t }));
      commit();
    }
  };
}
