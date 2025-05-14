/**
 * @file Automatorから呼び出されるJXAスクリプト。
 * SafariまたはGoogle Chromeで現在開いているタブのURLを取得し、
 * yt-dlpを使用して動画をダウンロードする。
 * @version 1.2.0
 */

/**
 * アプリケーションのインスタンス。
 * @type {Application}
 */
const APP = Application.currentApplication();
APP.includeStandardAdditions = true;

/**
 * System Eventsアプリケーションのインスタンス。
 * @type {Application}
 */
const SE = Application("System Events");

/**
 * 実行ファイルのフルパスを検索する。
 * 最初に `command -v` を使用して環境変数PATHから検索し、
 * 見つからない場合は一般的なインストールディレクトリのリストをフォールバックとして確認する。
 *
 * @param {string} executableName - 検索対象の実行ファイル名。
 * @returns {string|null} 見つかった場合は実行ファイルのフルパス、見つからない場合はnullを返す。
 */
function findFullPathForExecutable(executableName) {
  // 1. `command -v` を試行 (環境変数PATHを確認)
  try {
    const pathFromCommandV = APP.doShellScript(`command -v "${executableName}"`).trim();
    if (pathFromCommandV.startsWith("/")) {
      return pathFromCommandV;
    }
  } catch (e) {
    // `command -v` で見つからなかったか、何らかのエラーが発生した。
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
      // ファイルが存在し、かつ実行可能であるかを確認
      APP.doShellScript(`test -x "${fullPath}"`);
      // console.log(`デバッグ: '${executableName}' を '${fullPath}' で発見。`);
      return fullPath; // 発見され、実行可能である。
    } catch (e) {
      // このパスでは見つからないか、実行可能ではない。次のパスを試行する。
      // console.log(`デバッグ: '${fullPath}' は実行不可能か、見つからなかった。エラー: ${e.message}`);
    }
  }
  // console.log(`デバッグ: '${executableName}' は一般的なパスでも見つからなかった。`);
  return null; // 実行ファイルは見つからなかった。
}

/**
 * macOSの通知を表示する。
 * @param {string} title - 通知のタイトル。
 * @param {string} message - 通知の本文。
 * @param {string} [subtitle] - 通知のサブタイトル (オプション)。
 */
function showNotification(title, message, subtitle = "") {
  try {
    const options = { withTitle: title };
    if (subtitle) {
      options.subtitle = subtitle;
    }
    APP.displayNotification(message, options);
  } catch (e) {
    // 通知表示自体でエラーが発生した場合のフォールバック
    console.log(`通知表示エラー: ${e.message}`);
    // フォールバックとしてアラートを表示 (ユーザーに何らかのフィードバックを確実に与えるため)
    APP.displayAlert("通知表示エラー", {
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
 * @param {'critical'|'warning'|'informational'} [asType='critical'] - ダイアログの深刻度。
 */
function showErrorDialog(title, message, asType = "critical") {
  APP.displayAlert(title, {
    message: message,
    buttons: ["OK"],
    as: asType,
  });
}

/**
 * アクティブなブラウザタブのURLを取得する。
 * 対応ブラウザはSafariとGoogle Chrome。
 * @returns {string|null} URL文字列、または取得できなかった場合はnull。
 */
function getActiveBrowserUrl() {
  const frontProcess = SE.processes.whose({ frontmost: true })[0];
  const frontAppName = frontProcess?.name();

  if (!frontAppName) {
    console.log("前面アプリケーション名の取得に失敗。");
    return null;
  }

  const urlHandlers = {
    Safari: () => Application("Safari").documents[0]?.url(), // Safariはwindows[0].currentTab().url()よりdocuments[0].url()が安定する場合がある
    "Google Chrome": () => Application("Google Chrome").windows[0]?.activeTab()?.url(),
  };

  const getUrlFunction = urlHandlers[frontAppName];
  if (typeof getUrlFunction === "function") {
    const url = getUrlFunction();
    if (url) {
      return url;
    }
    console.log(`${frontAppName}でURLが取得できなかった (タブが空、エラー等)。`);
    return null;
  }

  console.log(`非対応ブラウザ: ${frontAppName}。処理を終了する。`);
  return null; // 対応ブラウザでない場合はnullを返す
}

/**
 * yt-dlpコマンドを実行し、出力を取得する。
 * @param {string} commandToExecute - 実行する完全なシェルコマンド文字列。
 * @returns {{output: string, exitCode: number}} コマンドの出力と終了コード。
 */
function executeShellCommand(commandToExecute) {
  let output = "";
  let exitCode = 0;
  try {
    // 標準エラー出力(stderr)もキャプチャに含めるため `2>&1` を追加
    output = APP.doShellScript(commandToExecute + " 2>&1");
  } catch (e) {
    // `doShellScript` がエラーをスローした場合 (通常、コマンドが非ゼロで終了した場合)
    output = e.message; // エラーメッセージには多くの場合stderrの内容が含まれる
    exitCode = e.number || 1; // エラーコードを取得 (存在しない場合は1をデフォルトとする)
  }
  return { output, exitCode };
}

/**
 * yt-dlpの出力からダウンロードされたファイル名（単数または複数）を抽出する。
 * @param {string} commandOutput - yt-dlpのコマンド出力。
 * @returns {string} 抽出されたファイル名（改行区切り）、または空文字列。
 */
function extractDownloadedFileNames(commandOutput) {
  // 1. マージ後のファイル名 (最も一般的なケース)
  let matches = [...commandOutput.matchAll(/Merging formats into "([^"]+)"/g)];
  if (matches.length > 0) {
    return matches.map((m) => m[1].split("/").pop()).join("\n");
  }

  // 2. マージがない場合 (例: 音声のみ、または既に適切な形式でダウンロードされた場合)
  matches = [...commandOutput.matchAll(/\[download\] Destination: (.*?)\n/g)];
  if (matches.length > 0) {
    return matches.map((m) => m[1].split("/").pop()).join("\n");
  }

  // 3. それでもファイル名が見つからない場合、[info] Downloading video to: 行から抽出試行
  matches = [...commandOutput.matchAll(/\[info\] Downloading video to: (.*?)\n/g)];
  if (matches.length > 0) {
    return matches.map((m) => m[1].split("/").pop()).join("\n");
  }
  return ""; // ファイル名が見つからなかった場合
}

/**
 * メイン処理を実行する関数。
 * Automatorワークフローから呼び出される。
 * @returns {string[]} Automator連携用。常に空配列を返す。
 */
function run() {
  "use strict";

  const targetUrl = getActiveBrowserUrl();
  if (!targetUrl) {
    // getActiveBrowserUrl内で既にconsole.log出力済みのため、ここでは何もしない
    return [];
  }

  const ytDlpPath = findFullPathForExecutable("yt-dlp");
  if (!ytDlpPath) {
    showErrorDialog(
      "yt-dlp 実行エラー",
      "yt-dlp が見つからなかった。\n\nHomebrew等で yt-dlp が正しくインストールされているか確認すること。\n(検索パス: PATH, /opt/homebrew/bin, /usr/local/bin)"
    );
    return [];
  }

  const ffmpegPath = findFullPathForExecutable("ffmpeg");

  // yt-dlp コマンドライン引数の定義
  const ytDlpArgs = [
    `"${ytDlpPath}"`, // yt-dlp実行ファイルのパス
    // '--ignore-config', // (オプション) システム全体やユーザーの設定ファイルを無視する場合
    // '--no-warnings',   // (オプション) yt-dlpの警告を抑制する場合
    ffmpegPath ? `--ffmpeg-location "${ffmpegPath}"` : "", // ffmpegのパス (見つかれば)
    "-S codec:avc:aac,res:1080,fps:60,hdr:sdr", // ダウンロードフォーマットの優先順位
    "-f bv+ba/b", // 最高品質のビデオとオーディオ、またはフォールバックとして最高品質
    `-o "${"$"}HOME/Downloads/%(title)s_%(height)s_%(fps)s_%(vcodec.:4)s_(%(id)s).%(ext)s"`, // 出力ファイル名テンプレート
    `--ppa "Merger+ffmpeg_o1:-map_metadata -1"`, // ポストプロセッサ引数 (ffmpegでメタデータ削除)
    `"${targetUrl}"`, // ダウンロード対象のURL
  ];

  const commandToExecute = ytDlpArgs.filter((arg) => arg !== "").join(" "); // 空の引数を除外して結合
  // console.log(`実行コマンド: ${commandToExecute}`);

  const { output: commandOutput, exitCode } = executeShellCommand(commandToExecute);

  if (exitCode === 0) {
    // 成功時の処理
    const downloadedFiles = extractDownloadedFileNames(commandOutput);
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
  } else {
    // エラー時の処理
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
