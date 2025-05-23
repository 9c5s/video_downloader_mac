/**
 * @file Automatorから呼び出されるJXAスクリプト。
 * SafariまたはGoogle Chromeで現在開いているタブのURLを取得し、
 * yt-dlpを使用して動画をダウンロードする。
 * スクリプトへの入力として出力ディレクトリ (-d) とファイル名テンプレート (-f) を渡すことができる。
 * ダウンロード開始前に動画/プレイリストのタイトルを取得して通知する。
 * プレイリストの場合は、プレイリスト名のフォルダを一つ作成し、その中に動画を個別にダウンロードする。
 * @version 1.6.0
 */

"use strict";

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
 * 単一動画用のデフォルトファイル名テンプレート (パス部分は含まない)。
 * @const {string}
 */
const DEFAULT_FILENAME_TEMPLATE_SINGLE = `%(title)s.%(ext)s`;

/**
 * プレイリスト内の動画アイテム用のデフォルトファイル名テンプレート (パス部分は含まない)。
 * @const {string}
 */
const DEFAULT_FILENAME_TEMPLATE_PLAYLIST_ITEM = `%(playlist_index& - |)s%(title)s.%(ext)s`;

/**
 * フォルダ名として使用できない文字を置換する。
 * @param {string} folderName - 元のフォルダ名。
 * @returns {string} サニタイズされたフォルダ名。
 */
function sanitizeFolderName(folderName) {
  if (!folderName || typeof folderName !== "string") {
    return "Untitled_Folder";
  }
  return folderName.replace(/[\/\\:;\*\?"<>\|]/g, "_").trim() || "Untitled_Folder";
}

/**
 * macOSの通知を表示する。
 * @param {string} title - 通知のタイトル。
 * @param {string} message - 通知の本文。
 * @param {string} [subtitle=""] - 通知のサブタイトル (オプション)。
 */
function showNotification(title, message, subtitle = "") {
  try {
    const options = { withTitle: title };
    if (subtitle) options.subtitle = subtitle;
    APP.displayNotification(message, options);
  } catch (e) {
    console.log(`通知表示エラー: ${e.message}`);
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
  APP.displayAlert(title, { message: message, buttons: ["OK"], as: asType });
}

/**
 * アクティブなブラウザタブのURLを取得する。
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
    Safari: () => Application("Safari").documents[0]?.url(),
    "Google Chrome": () => Application("Google Chrome").windows[0]?.activeTab()?.url(),
  };

  const getUrlFunction = urlHandlers[frontAppName];
  if (typeof getUrlFunction === "function") {
    const url = getUrlFunction();
    if (url) return url;
    console.log(`${frontAppName}でURLが取得できなかった (タブが空、エラー等)。`);
    return null;
  }
  console.log(`非対応ブラウザ: ${frontAppName}。処理を終了する。`);
  return null;
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
    output = APP.doShellScript(commandToExecute + " 2>&1");
  } catch (e) {
    output = e.message;
    exitCode = e.number || 1;
  }
  return { output, exitCode };
}

/**
 * @typedef {object} VideoEntry
 * @property {string} url - ダウンロードに使用する動画のURL (通常はYouTubeのwatchページURL)。
 * @property {string} title - 動画のタイトル。
 */

/**
 * @typedef {object} VideoInfo
 * @property {string} title - 動画またはプレイリストのタイトル。
 * @property {boolean} isPlaylist - プレイリストであるかどうかのフラグ。
 * @property {VideoEntry[]} [entries] - プレイリストの場合、個々の動画エントリの配列。
 * @property {string} [webpage_url] - 元のURL (単一動画の場合、これがダウンロードに使われるべきURL)。
 */

/**
 * yt-dlpを使用して動画/プレイリストの情報を取得する。
 * @param {string} ytDlpPath - yt-dlp実行ファイルのパス。
 * @param {string} targetUrl - 情報取得対象のURL。
 * @param {string|null} cookiesFromBrowser - ブラウザからのクッキー (オプション)。
 * @returns {VideoInfo} 動画/プレイリストの情報。
 */
function getVideoOrPlaylistInfo(ytDlpPath, targetUrl, cookiesFromBrowser) {
  let title = "タイトル情報取得中...";
  let isPlaylist = false;
  let entries = [];
  let webpage_url = targetUrl;

  try {
    const ytDlpArgs = [
      `"${ytDlpPath}"`,
      "-J",
      "--flat-playlist",
      "--no-warnings",
      "--no-check-certificate",
      cookiesFromBrowser ? `--cookies-from-browser \"${cookiesFromBrowser}\"` : "",
      `"${targetUrl}"`,
    ];
    const infoCommand = ytDlpArgs.filter((arg) => arg !== "").join(" ");
    const { output: infoJson, exitCode: infoExitCode } = executeShellCommand(infoCommand);

    if (infoExitCode === 0 && infoJson) {
      try {
        const parsedInfo = JSON.parse(infoJson);
        if (parsedInfo._type === "playlist" || parsedInfo.entries) {
          isPlaylist = true;
          title = parsedInfo.title || "無題のプレイリスト";
          webpage_url = parsedInfo.webpage_url || targetUrl;
          entries = (parsedInfo.entries || []).map((entry, index) => {
            return {
              url: entry.url,
              title: entry.title || `無題の動画 ${index + 1}`,
            };
          });
        } else {
          title = parsedInfo.title || "無題の動画";
          isPlaylist = false;
          webpage_url = parsedInfo.webpage_url;
        }
      } catch (parseError) {
        console.log(`JSONパースエラー: ${parseError.message}\nJSON (最初の500文字): ${infoJson.substring(0, 500)}`);
        title = "タイトル情報パース失敗";
      }
    } else {
      console.log(`動画/プレイリスト情報の取得に失敗。コード: ${infoExitCode}\n出力: ${infoJson}`);
      title = "タイトル情報取得失敗";
    }
  } catch (e) {
    console.log(`動画/プレイリスト情報取得コマンドの実行エラー: ${e.message}`);
    title = "タイトル情報取得エラー";
  }
  return { title, isPlaylist, entries, webpage_url };
}

/**
 * 指定された動画エントリをダウンロードし、通知を行う。
 * @param {VideoEntry} videoEntry - ダウンロード対象の動画エントリ。
 * @param {string} ytDlpPath - yt-dlp実行ファイルのパス。
 * @param {string|null} ffmpegPath - ffmpeg実行ファイルのパス (オプション)。
 * @param {string} finalOutputTemplate - yt-dlpの `-o` に渡す完全な出力テンプレート。
 * @param {string|null} downloadArchive - ダウンロードアーカイブファイルのパス (オプション)。
 * @param {string|null} cookiesFromBrowser - ブラウザからのクッキー (オプション)。
 * @returns {boolean} ダウンロードが成功したかどうか。
 */
function downloadVideoEntry(
  videoEntry,
  ytDlpPath,
  ffmpegPath,
  finalOutputTemplate,
  downloadArchive,
  cookiesFromBrowser
) {
  const entryTitle = videoEntry.title || "無題の動画";
  const entryUrl = videoEntry.url;

  if (!entryUrl) {
    showErrorDialog("ダウンロードエラー", `動画「${entryTitle}」のURLが見つかりません。スキップします。`, "warning");
    return false;
  }

  let startNotificationMessage = `対象: ${entryTitle}`;
  if (videoEntry.playlist_title) {
    startNotificationMessage = `プレイリスト「${videoEntry.playlist_title}」より\n${startNotificationMessage}`;
  }

  showNotification("yt-dlp ダウンロード開始", startNotificationMessage, "処理を開始します...");

  const ytDlpArgs = [
    `"${ytDlpPath}"`,
    `--ffmpeg-location "${ffmpegPath}"`,
    "-S codec:avc:aac,res:1080,fps:60,hdr:sdr",
    "-f bv+ba/b",
    `-o "${finalOutputTemplate}"`,
    `--ppa "Merger+ffmpeg_o1:-map_metadata -1"`,
    downloadArchive ? `--download-archive \"${downloadArchive}\"` : "",
    cookiesFromBrowser ? `--cookies-from-browser \"${cookiesFromBrowser}\"` : "",
    `"${entryUrl}"`,
  ];
  const commandToExecute = ytDlpArgs.filter((arg) => arg !== "").join(" ");

  const { output: commandOutput, exitCode } = executeShellCommand(commandToExecute);

  if (exitCode === 0) {
    let successMessage = `「${entryTitle}」の処理完了。`;
    const alreadyDownloadedMatch = commandOutput.match(/\[download\] (.*?) has already been downloaded/);

    if (alreadyDownloadedMatch) {
      const alreadyDownloadedTitle = alreadyDownloadedMatch[1].split("/").pop().trim();
      successMessage = `「${alreadyDownloadedTitle || entryTitle}」は既にダウンロード済みです。`;
    } else {
      successMessage = `「${entryTitle}」のダウンロードが完了しました。`;
    }
    showNotification("yt-dlp ダウンロード成功", successMessage);
    return true;
  } else {
    if (/Unsupported URL/i.test(commandOutput)) {
      showNotification("yt-dlp 情報", `「${entryTitle}」:\nサポートされていないURLです。`, entryUrl);
    } else {
      showErrorDialog(
        `yt-dlp/シェル エラー (コード: ${exitCode}) - ${entryTitle}`,
        `動画「${entryTitle}」のダウンロード中にエラーが発生した。\nURL: ${entryUrl}\n\nエラー出力:\n${commandOutput}`
      );
    }
    return false;
  }
}

/**
 * Automatorからの入力を解析し、ダウンロードディレクトリとファイル名テンプレートを取得する。
 * @param {string[]} inputArgs - Automatorからの入力配列。例: ["-d", "/path/to/dir", "-f", "name_template.%(ext)s"]
 * @returns {{downloadDir: string|null, fileNameTemplate: string|null}}
 */
function parseInputArguments(inputArgs) {
  let downloadDir = null;
  let fileNameTemplate = null;
  let downloadArchive = null;
  let cookiesFromBrowser = null;

  if (!Array.isArray(inputArgs)) {
    return { downloadDir, fileNameTemplate, downloadArchive, cookiesFromBrowser };
  }

  for (let i = 0; i < inputArgs.length; i++) {
    if (inputArgs[i] === "-d" && i + 1 < inputArgs.length) {
      downloadDir = inputArgs[i + 1];
      i++;
    } else if (inputArgs[i] === "-f" && i + 1 < inputArgs.length) {
      fileNameTemplate = inputArgs[i + 1];
      i++;
    } else if (inputArgs[i] === "-a" && i + 1 < inputArgs.length) {
      downloadArchive = inputArgs[i + 1];
      i++;
    } else if (inputArgs[i] === "-c" && i + 1 < inputArgs.length) {
      cookiesFromBrowser = inputArgs[i + 1];
      i++;
    }
  }
  return { downloadDir, fileNameTemplate, downloadArchive, cookiesFromBrowser };
}

/**
 * 実行ファイルのフルパスを検索し、見つからなければエラーダイアログを表示して処理を中断する。
 * @param {string} name - 検索対象の実行ファイル名。
 * @returns {string|null} 見つかった場合は実行ファイルのフルパス、見つからない場合はnull（エラーダイアログも表示）
 */
function findExec(name) {
  let path = null;
  try {
    const pathFromCommandV = APP.doShellScript(`command -v "${name}"`).trim();
    if (pathFromCommandV.startsWith("/")) path = pathFromCommandV;
  } catch (e) {}

  if (!path) {
    const commonPaths = ["/opt/homebrew/bin", "/usr/local/bin"];
    for (const p of commonPaths) {
      const fullPath = `${p}/${name}`;
      try {
        APP.doShellScript(`test -x "${fullPath}"`);
        path = fullPath;
        break;
      } catch (e) {}
    }
  }

  if (!path) {
    showErrorDialog(
      `${name} 実行エラー`,
      `${name} が見つかりませんでした。\n\nHomebrew等で ${name} が正しくインストールされているか確認してください。`
    );
    return null;
  }
  return path;
}

/**
 * メイン処理を実行する関数。
 * Automatorワークフローから呼び出される。
 * @param {string[]} [input=[]] - Automatorからの入力。例: ["-d", "/path/to/dir", "-f", "name_template.%(ext)s"]
 * @param {object} [parameters={}] - Automatorからのパラメータ (今回は未使用)。
 * @returns {string[]} Automator連携用。常に空配列を返す。
 */
function run(input = [], parameters = {}) {
  const initialUrl = getActiveBrowserUrl();
  if (!initialUrl) {
    return [];
  }

  // パスの確認
  const ytDlpPath = findExec("yt-dlp");
  if (!ytDlpPath) return [];

  const ffmpegPath = findExec("ffmpeg");
  if (!ffmpegPath) return [];

  // Automatorからの引数を解析
  const {
    downloadDir: userSpecifiedDir,
    fileNameTemplate: userSpecifiedFileTemplate,
    downloadArchive,
    cookiesFromBrowser,
  } = parseInputArguments(input);

  // デフォルトのダウンロードベースディレクトリ
  const defaultBaseDownloadsPath = APP.doShellScript("echo $HOME/Downloads").trim();

  // 単一動画かプレイリストかで最終的な出力先を決定
  const videoInfo = getVideoOrPlaylistInfo(ytDlpPath, initialUrl, cookiesFromBrowser);

  if (videoInfo.title.includes("取得失敗") || videoInfo.title.includes("パース失敗")) {
    showErrorDialog(
      "情報取得エラー",
      `URLから動画/プレイリスト情報の取得に失敗しました。\nタイトル: ${videoInfo.title}\nURL: ${initialUrl}`,
      "warning"
    );
    const fallbackEntry = {
      url: initialUrl,
      title: videoInfo.title.includes("失敗") ? "不明な動画" : videoInfo.title,
    };
    // フォールバック時の出力テンプレート
    const fallbackBaseDir = userSpecifiedDir || defaultBaseDownloadsPath;
    const fallbackFileName = userSpecifiedFileTemplate || DEFAULT_FILENAME_TEMPLATE_SINGLE;
    const fallbackOutputTemplate = `${fallbackBaseDir}/${fallbackFileName}`;
    downloadVideoEntry(
      fallbackEntry,
      ytDlpPath,
      ffmpegPath,
      fallbackOutputTemplate,
      downloadArchive,
      cookiesFromBrowser
    );
    return [];
  }

  if (videoInfo.isPlaylist && videoInfo.entries && videoInfo.entries.length > 0) {
    // プレイリスト処理
    const playlistFolderName = sanitizeFolderName(videoInfo.title);
    // プレイリストフォルダの親ディレクトリ: -d があればそれ、なければデフォルトのDownloads
    const playlistParentDir = userSpecifiedDir || defaultBaseDownloadsPath;
    const playlistFullBaseDir = `${playlistParentDir}/${playlistFolderName}`;

    showNotification(
      "プレイリスト ダウンロード開始",
      `プレイリスト「${videoInfo.title}」(${videoInfo.entries.length}件) の処理を開始します。`,
      `保存先フォルダ: ${playlistFolderName} (in ${playlistParentDir.split("/").pop()})`
    );

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < videoInfo.entries.length; i++) {
      const entry = videoInfo.entries[i];
      // プレイリスト内の各動画のファイル名テンプレート: -f があればそれ、なければデフォルト
      const itemFileNameTemplate = userSpecifiedFileTemplate || DEFAULT_FILENAME_TEMPLATE_PLAYLIST_ITEM;
      const finalItemOutputTemplate = `${playlistFullBaseDir}/${itemFileNameTemplate}`;

      if (
        downloadVideoEntry(entry, ytDlpPath, ffmpegPath, finalItemOutputTemplate, downloadArchive, cookiesFromBrowser)
      ) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    showNotification(
      "プレイリスト ダウンロード完了",
      `プレイリスト「${videoInfo.title}」の処理が完了しました。\n成功: ${successCount}件, 失敗: ${failureCount}件`,
      `合計: ${videoInfo.entries.length}件`
    );
  } else {
    // 単一動画処理
    const singleVideoEntry = {
      url: videoInfo.webpage_url,
      title: videoInfo.title,
    };
    // 単一動画の保存先ディレクトリ: -d があればそれ、なければデフォルトのDownloads
    const singleVideoBaseDir = userSpecifiedDir || defaultBaseDownloadsPath;
    // 単一動画のファイル名テンプレート: -f があればそれ、なければデフォルト
    const singleVideoFileNameTemplate = userSpecifiedFileTemplate || DEFAULT_FILENAME_TEMPLATE_SINGLE;
    const finalSingleOutputTemplate = `${singleVideoBaseDir}/${singleVideoFileNameTemplate}`;

    downloadVideoEntry(
      singleVideoEntry,
      ytDlpPath,
      ffmpegPath,
      finalSingleOutputTemplate,
      downloadArchive,
      cookiesFromBrowser
    );
  }

  return [];
}
