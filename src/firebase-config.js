/**
 * Firebase Config & デモ/本番ハイブリッド判定
 */
export const firebaseConfig = {
  projectId: "yuda-store-ai-1788800335",
  authDomain: "yuda-store-ai-1788800335.firebaseapp.com",
};

// 湯田代表がログインしているかどうかの判定
export function isLiveMode(user) {
  return user && user.email === "yudakyouhei@gmail.com";
}
