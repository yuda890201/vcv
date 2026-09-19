/**
 * 株式会社ゆだや - データ構造定義 (Firestore / Supabase 共通スキーマ)
 *
 * ⚠️ このファイルに実店舗名・地名を書かないこと (CLAUDE.md 厳守ルール5)。
 *    店舗の識別子は store1 / store2 の中立なキーを使い、
 *    実際の店舗名は Firestore の config/stores (代表のみ読取可) に置く。
 */
export const YUDAYA_DATA_SCHEMA = {
  // 1. 店舗マスタ
  stores: {
    store_id: 'store1' | 'store2',
    store_name: 'string', // 実名は config/stores から取得。ここには書かない。
    status: 'open' | 'night_shift' | 'maintenance',
    active_agents: ['manager', 'kitchen', 'register', 'jiikun']
  },

  // 2. カンバンタスク
  tasks: {
    id: 'T-101',
    store_id: 'store1',
    title: '翌週シフト希望集計と最適コマ割り策定',
    assignee: 'manager', // manager | kitchen | register | jiikun
    station: 'office',  // office | kitchen | counter | breakroom
    app_id: 'shift',    // shift | ff | safe | stamps | builder
    status: 'todo' | 'progress' | 'review' | 'approval' | 'done',
    requires_approval: true, // Human-in-the-Loopフラグ
    summary: 'タスク詳細サマリー',
    diff_preview: '+2名補強 (金曜夜間), 総人件費: ¥248,500/週',
    db_target: 'ゆだやシフト管理DB',
    created_at: '2026-09-12T16:50:00Z',
    approved_at: null,
    approved_by: null // '湯田 恭平'
  },

  // 3. 金庫・レジ引継ぎレコード
  safe_records: {
    record_id: 'SAFE-20260912-1400',
    store_id: 'store1',
    pos1_change_fund: 150000,
    pos2_change_fund: 150000,
    safe_total_amount: 482000,
    discrepancy: 0, // 違算金
    checked_by: 'register',
    status: 'verified' | 'discrepancy_alert'
  },

  // 4. FF調理・廃棄ログ
  ff_records: {
    log_id: 'FF-20260912-1200',
    store_id: 'store1',
    item_name: 'ゆだや名物チキン（骨なし）',
    cooked_count: 24,
    remaining_count: 8,
    waste_count: 0,
    oil_temperature: 175,
    weather: '晴れ 24℃'
  }
};
