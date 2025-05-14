/**
 * Automatorから呼び出されるエントリポイント。
 * 前面のSafari/ChromeタブURLを取得し、yt-dlpでダウンロードを行う。
 * 処理結果に応じて通知を表示し、予期せぬエラーの場合はダイアログを表示する。
 *
 * @returns {string[]} Automator連携用。返値は使用しないため空配列を返す。
 */

/**
 * 実行ファイルのフルパスを検索する。
 * 最初に `command -v` を使用して環境変数PATHから検索し、
 * 見つからない場合は一般的なインストールディレクトリのリストをフォールバックとして確認する。
 *
 * @param {string} executableName - 検索対象の実行ファイル名。
 * @returns {string|null} 見つかった場合は実行ファイルのフルパス、見つからない場合はnullを返す。
 */
function findFullPathForExecutable(executableName) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;

  // 1. `command -v` を試行 (環境変数PATHを確認)
  try {
    const pathFromCommandV = app.doShellScript(`command -v "${executableName}"`).trim();
    if (pathFromCommandV.startsWith("/")) {
      return pathFromCommandV;
    }
  } catch (e) {
    // console.log(`デバッグ: '${executableName}' は 'command -v' で見つからなかった。エラー: ${e.message}`);
  }

  // 2. 事前定義された一般的なインストールパスを確認
  const commonPaths = [
    "/opt/homebrew/bin", // Apple Silicon搭載MacのHomebrew用
    "/usr/local/bin", // Intel搭載MacのHomebrewやその他のユーザーインストールツール用
  ];

  for (const path of commonPaths) {
    const fullPath = `${path}/${executableName}`;
    try {
      app.doShellScript(`test -x "${fullPath}"`);
      return fullPath; // 発見され、実行可能である。
    } catch (e) {
      // console.log(`デバッグ: '${fullPath}' は実行不可能か、見つからなかった。エラー: ${e.message}`);
    }
  }
  return null; // 実行ファイルは見つからなかった。
}

/**
 * 通知を表示する。
 * @param {string} title - 通知のタイトル。
 * @param {string} message - 通知の本文。
 * @param {string} [subtitle] - 通知のサブタイトル (オプション)。
 */
function showNotification(title, message, subtitle) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  try {
    const options = { withTitle: title };
    if (subtitle) {
      options.subtitle = subtitle;
    }
    app.displayNotification(message, options);
  } catch (e) {
    // 通知表示自体でエラーが発生した場合のフォールバック
    console.log(`通知表示エラー: ${e.message}`);
    app.displayAlert("通知表示エラー", {
      message: `タイトル: ${title}\nメッセージ: ${message}\n\nエラー詳細: ${e.message}`,
      buttons: ["OK"],
      as: "warning",
    });
  }
}

/**
 * エラーダイアログを表示する。
 * @param {string} title - ダイアログのタイトル。
 * @param {string} message - ダイアログの本文。
 * @param {string} [asType="critical"] - ダイアログの深刻度 ("critical", "warning", "informational")。
 */
function showErrorDialog(title, message, asType = "critical") {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  app.displayAlert(title, {
    message: message,
    buttons: ["OK"],
    as: asType,
  });
}

/**
 * メイン処理を実行する関数。
 * Automatorワークフローから呼び出される。
 */
function run() {
  "use strict";
  const app = Application.currentApplication(); // この行は showNotification/showErrorDialog 内にもあるが、他で使う可能性も考慮し残す
  app.includeStandardAdditions = true;

  // 1. 前面アプリケーション名を取得
  const se = Application("System Events");
  const frontProcess = se.processes.whose({ frontmost: true })[0];
  const frontAppName = frontProcess?.name();

  if (!frontAppName) {
    console.log("前面アプリケーション名の取得に失敗。");
    showErrorDialog("エラー", "前面アプリケーション名を取得できなかった。", "warning");
    return [];
  }

  // 2. SafariまたはChromeからアクティブタブのURLを取得するロジック
  const urlHandlers = {
    Safari: () => Application("Safari").windows[0]?.currentTab()?.url(),
    "Google Chrome": () => Application("Google Chrome").windows[0]?.activeTab()?.url(),
  };

  const getUrlFunction = urlHandlers[frontAppName];
  const targetUrl = typeof getUrlFunction === "function" ? getUrlFunction() : null;

  if (!targetUrl) {
    console.log("対応ブラウザでURLの取得に失敗。");
    showErrorDialog("エラー", `対応ブラウザ (${frontAppName}) でURLを取得できなかった。`, "warning");
    return []; // 対応ブラウザ以外の場合は処理を中断
  }

  // yt-dlp のフルパスを検索
  const ytDlpPath = findFullPathForExecutable("yt-dlp");

  if (!ytDlpPath) {
    showErrorDialog(
      "yt-dlp 実行エラー",
      "yt-dlp が見つからなかった。\n\nHomebrew等で yt-dlp が正しくインストールされているか確認すること。\n(検索パス: PATH, /opt/homebrew/bin, /usr/local/bin)"
    );
    return [];
  }

  // ffmpeg のフルパスを検索
  const ffmpegPath = findFullPathForExecutable("ffmpeg");

  // 3. yt-dlp コマンドライン引数の組み立て
  const cmdArgs = [`"${ytDlpPath}"`];

  if (ffmpegPath) {
    cmdArgs.push(`--ffmpeg-location "${ffmpegPath}"`);
  }

  cmdArgs.push(
    "-S codec:avc:aac,res:1080,fps:60,hdr:sdr",
    "-f bv+ba/b",
    `-o "${"$"}HOME/Downloads/%(title)s_%(height)s_%(fps)s_%(vcodec.:4)s_(%(id)s).%(ext)s"`,
    `--ppa "Merger+ffmpeg_o1:-map_metadata -1"`,
    `"${targetUrl}"`
  );

  const commandToExecute = cmdArgs.join(" ");

  // 4. コマンド実行と出力のキャプチャ
  let commandOutput = "";
  let exitCode = 0;
  try {
    commandOutput = app.doShellScript(commandToExecute + " 2>&1");
  } catch (e) {
    commandOutput = e.message;
    exitCode = e.number || 1;
  }

  // 5. 成功時の処理: 通知でファイル名やプレイリスト名を表示
  if (exitCode === 0) {
    const mergedFileMatches = [...commandOutput.matchAll(/Merging formats into "([^"]+)"/g)];
    let downloadedFiles = mergedFileMatches.map((m) => m[1].split("/").pop()).join("\n");

    if (!downloadedFiles) {
      const destinationMatches = [...commandOutput.matchAll(/\[download\] Destination: (.*?)\n/g)];
      if (destinationMatches.length > 0) {
        downloadedFiles = destinationMatches.map((m) => m[1].split("/").pop()).join("\n");
      } else {
        const infoDownloadingMatches = [...commandOutput.matchAll(/\[info\] Downloading video to: (.*?)\n/g)];
        if (infoDownloadingMatches.length > 0) {
          downloadedFiles = infoDownloadingMatches.map((m) => m[1].split("/").pop()).join("\n");
        }
      }
    }

    const alreadyDownloadedFiles = [...commandOutput.matchAll(/\[download\] (.*?) has already been downloaded/g)]
      .map((m) => m[1].split("/").pop())
      .join("\n");

    const playlistMatch = commandOutput.match(/\[download\] Downloading playlist: (.+)/);
    const playlistName = playlistMatch ? playlistMatch[1] : null;

    let notificationMessage = "";
    if (playlistName) {
      notificationMessage = `プレイリスト「${playlistName}」のDL完了。`;
      if (downloadedFiles) notificationMessage += `\nファイル:\n${downloadedFiles}`;
      if (alreadyDownloadedFiles) notificationMessage += `\n処理済(スキップ):\n${alreadyDownloadedFiles}`;
    } else {
      if (downloadedFiles) {
        notificationMessage = `DL完了:\n${downloadedFiles}`;
      } else if (alreadyDownloadedFiles) {
        notificationMessage = `処理済(スキップ):\n${alreadyDownloadedFiles}`;
      } else {
        const genericSuccessMsg = commandOutput.match(/Download completed successfully/i)
          ? "ダウンロードが正常に完了した。"
          : "処理が完了した。";
        notificationMessage = genericSuccessMsg + "\n(ファイル名は出力から抽出できなかった)";
      }
    }
    showNotification("yt-dlp ダウンロード成功", notificationMessage);
  }
  // 6. エラー時の処理: "Unsupported URL" のみ通知、他は原文をダイアログ表示
  else {
    const videoTitleMatch =
      commandOutput.match(/\[youtube\] (.*?): Downloading webpage/) ||
      commandOutput.match(/\[info\] (.*?): Downloading webpage/);
    const videoTitle = videoTitleMatch ? videoTitleMatch[1] : "指定された動画";

    if (/Unsupported URL/i.test(commandOutput)) {
      showNotification("yt-dlp 情報", `${videoTitle}:\nサポートされていないURLです。`, targetUrl);
    } else {
      showErrorDialog(
        `yt-dlp/シェル エラー (コード: ${exitCode})`,
        `コマンド実行中にエラーが発生した。\nURL: ${targetUrl}\n\nエラー出力:\n${commandOutput}`
      );
    }
  }
  return [];
}
