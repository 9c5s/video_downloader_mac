/**
 * Automator から呼び出されるエントリポイント。
 * 前面の Safari/Chrome タブ URL を取得し、
 * yt-dlp でダウンロード → 成功は通知、想定外エラーはダイアログ表示。
 *
 * @returns {Array} Automator 連携用（返値は使わないので空配列）
 */
function run() {
  "use strict";
  // 標準コマンドを使うための設定
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;

  // 1. 前面アプリ名を取得
  const se = Application("System Events");
  const front = se.processes.whose({ frontmost: true })[0];
  const name = front?.name();

  if (!name) return [];

  // 2. Safari/Chrome それぞれの URL 取得ロジック
  const handlers = {
    Safari: () => Application("Safari").windows[0]?.currentTab()?.url(),
    "Google Chrome": () => Application("Google Chrome").windows[0]?.activeTab()?.url(),
  };

  const getUrl = handlers[name];
  const url = typeof getUrl === "function" ? getUrl() : null;
  if (!url) return []; // 対応ブラウザ以外は何もしない

  app.displayNotification("test", { withTitle: "yt-dlp" });

  // 3. yt-dlp コマンド組み立て
  const cmd = [
    "/opt/homebrew/bin/yt-dlp", // yt-dlp へのパス。環境に合わせて調整が必要な場合があります。
    "-S codec:avc:aac,res:1080,fps:60,hdr:sdr",
    "-f bv+ba",
    `-o "${"$"}HOME/Downloads/%(title)s_%(height)s_%(fps)s_%(vcodec.:4)s_(%(id)s).%(ext)s"`,
    `--ppa 'Merger+ffmpeg_o1:-map_metadata -1'`,
    `"${url}"`,
  ].join(" ");
  app.displayAlert(`yt-dlp コマンド:\n${cmd}`, { buttons: ["OK"] });

  // 4. コマンド実行＆出力キャプチャ
  let output = "";
  let code = 0;
  try {
    // stderr を含めて取得
    output = app.doShellScript(cmd + " 2>&1");
  } catch (e) {
    output = e.message;
    code = e.number || 1;
  }

  // 5. 成功時：通知でファイル名／プレイリスト名を表示
  if (code === 0) {
    // ダウンロードされたファイル名を抽出
    const files = [...output.matchAll(/Merging formats into "([^"]+)"/g)].map((m) => m[1]).join(", ");
    // プレイリスト名を抽出（あれば）
    const pl = (output.match(/Downloading playlist: (.+)/) || [])[1];
    const message = pl
      ? `プレイリスト「${pl}」のダウンロードが完了しました。\n${files}`
      : `ダウンロードが完了しました：\n${files}`;
    // macOS 通知
    app.displayNotification(message, { withTitle: "yt-dlp" });
  }
  // 6. エラー時：未対応サイト系以外はダイアログ表示
  else {
    if (!/Unsupported URL|no suitable extractor|no video formats found/.test(output)) {
      const err = output.split("\n", 1)[0];
      app.displayAlert(`yt-dlp エラー: ${err}`, { buttons: ["OK"] });
    }
  }

  return [];
}
