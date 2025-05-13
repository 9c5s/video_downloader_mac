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
    // `command -v` が実行ファイルを見つけた場合、そのパスを標準出力に返す。
    // 見つからない場合、通常は標準エラーに出力し非ゼロステータスで終了するため、
    // `doShellScript` がエラーをスローする。
    const pathFromCommandV = app.doShellScript(`command -v "${executableName}"`).trim();
    // パスが "/" で始まるかどうかの基本的な検証
    if (pathFromCommandV.startsWith("/")) {
      // オプション: ファイルが実行可能か検証する。`test -x` はそうでなければエラーをスローする。
      // app.doShellScript(`test -x "${pathFromCommandV}"`);
      return pathFromCommandV;
    }
  } catch (e) {
    // `command -v` で見つからなかったか、何らかのエラーが発生した。
    // 一般的なハードコードされたパスの確認処理へ進む。
    // console.log(`デバッグ: '${executableName}' は 'command -v' で見つからなかった。エラー: ${e.message}`);
  }

  // 2. 事前定義された一般的なインストールパスを確認
  const commonPaths = [
    "/opt/homebrew/bin", // Apple Silicon搭載MacのHomebrew用
    "/usr/local/bin", // Intel搭載MacのHomebrewやその他のユーザーインストールツール用
    // 必要であれば他のパスも追加可能だが、/usr/bin や /bin は
    // システムのPATH設定が最小限の場合でも、通常 `command -v` でカバーされる。
  ];

  for (const path of commonPaths) {
    const fullPath = `${path}/${executableName}`;
    try {
      // `test -x` はファイルが存在し、かつ実行可能であるかを確認する。
      // このテストが失敗した場合 (例: ファイルが存在しない、実行権限がない)、エラーがスローされる。
      app.doShellScript(`test -x "${fullPath}"`);
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
 * メイン処理を実行する関数。
 * Automatorワークフローから呼び出される。
 */
function run() {
  "use strict";
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;

  // 1. 前面アプリケーション名を取得
  const se = Application("System Events");
  const frontProcess = se.processes.whose({ frontmost: true })[0];
  const frontAppName = frontProcess?.name();

  if (!frontAppName) {
    console.log("前面アプリケーション名の取得に失敗。");
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
    return []; // 対応ブラウザ以外の場合は処理を中断
  }

  // yt-dlp のフルパスを検索
  const ytDlpPath = findFullPathForExecutable("yt-dlp");

  if (!ytDlpPath) {
    app.displayAlert("yt-dlp 実行エラー", {
      message:
        "yt-dlp が見つからなかった。\n\nHomebrew等で yt-dlp が正しくインストールされているか確認すること。\n(検索パス: PATH, /opt/homebrew/bin, /usr/local/bin)",
      buttons: ["OK"],
      as: "critical",
    });
    return [];
  }
  // console.log(`デバッグ: 使用するyt-dlpのパス: ${ytDlpPath}`);

  // ffmpeg のフルパスを検索
  const ffmpegPath = findFullPathForExecutable("ffmpeg");
  // if (!ffmpegPath) {
  //   console.log("デバッグ: ffmpeg が検索パスで見つからなかった。yt-dlpによる自動検出を試みる。");
  // } else {
  //   console.log(`デバッグ: 使用するffmpegのパス: ${ffmpegPath}`);
  // }

  // 3. yt-dlp コマンドライン引数の組み立て
  const cmdArgs = [
    `"${ytDlpPath}"`, // 検索で見つけたフルパスを使用。スペースが含まれる可能性を考慮し引用符で囲む。
  ];

  // ffmpeg のパスが見つかった場合、--ffmpeg-location オプションを追加
  if (ffmpegPath) {
    cmdArgs.push(`--ffmpeg-location "${ffmpegPath}"`);
  }

  cmdArgs.push(
    "-S codec:avc:aac,res:1080,fps:60,hdr:sdr",
    "-f bv+ba/b", // 最高品質ビデオ + 最高品質オーディオ / 最高品質 (フォールバック)
    `-o "${"$"}HOME/Downloads/%(title)s_%(height)s_%(fps)s_%(vcodec.:4)s_(%(id)s).%(ext)s"`,
    `--ppa "Merger+ffmpeg_o1:-map_metadata -1"`,
    `"${targetUrl}"` // URLを引用符で囲む
  );

  const commandToExecute = cmdArgs.join(" ");
  // デバッグ用に実行コマンドを表示
  // app.displayDialog(`実行する yt-dlp コマンド:\n${commandToExecute}`, { buttons: ["OK"] });

  // 4. コマンド実行と出力のキャプチャ
  let commandOutput = "";
  let exitCode = 0;
  try {
    // 標準エラー出力(stderr)もキャプチャに含めるため `2>&1` を追加
    commandOutput = app.doShellScript(commandToExecute + " 2>&1");
  } catch (e) {
    // `doShellScript` がエラーをスローした場合 (通常、コマンドが非ゼロで終了した場合)
    commandOutput = e.message; // エラーメッセージには多くの場合stderrの内容が含まれる
    exitCode = e.number || 1; // エラーコードを取得 (存在しない場合は1をデフォルトとする)
  }

  // 5. 成功時の処理: 通知でファイル名やプレイリスト名を表示
  if (exitCode === 0) {
    // ダウンロードされたファイル名を抽出 (yt-dlp の出力形式に依存)
    const mergedFileMatches = [...commandOutput.matchAll(/Merging formats into "([^"]+)"/g)];
    let downloadedFiles = mergedFileMatches.map((m) => m[1].split("/").pop()).join("\n");

    // マージ処理がない場合 (例: 音声のみ、または既に適切な形式でダウンロード済みの場合)
    if (!downloadedFiles) {
      const destinationMatches = [...commandOutput.matchAll(/\[download\] Destination: (.*?)\n/g)];
      if (destinationMatches.length > 0) {
        downloadedFiles = destinationMatches.map((m) => m[1].split("/").pop()).join("\n");
      } else {
        // それでもファイル名が見つからない場合、[info] Downloading video to: 行から抽出試行
        const infoDownloadingMatches = [...commandOutput.matchAll(/\[info\] Downloading video to: (.*?)\n/g)];
        if (infoDownloadingMatches.length > 0) {
          downloadedFiles = infoDownloadingMatches.map((m) => m[1].split("/").pop()).join("\n");
        }
      }
    }

    const alreadyDownloadedFiles = [...commandOutput.matchAll(/\[download\] (.*?) has already been downloaded/g)]
      .map((m) => m[1].split("/").pop())
      .join("\n");

    // プレイリスト名を抽出 (存在する場合)
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
        // 成功したがファイル名が取得できなかった場合 (yt-dlpの出力が予期しない形式だった場合など)
        const genericSuccessMsg = commandOutput.match(/Download completed successfully/i)
          ? "ダウンロードが正常に完了した。"
          : "処理が完了した。";
        notificationMessage = genericSuccessMsg + "\n(ファイル名は出力から抽出できなかった)";
      }
    }
    app.displayNotification(notificationMessage, { withTitle: "yt-dlp ダウンロード成功" });
  }
  // 6. エラー時の処理: "Unsupported URL" のみ通知、他は原文をダイアログ表示
  else {
    const videoTitleMatch =
      commandOutput.match(/\[youtube\] (.*?): Downloading webpage/) ||
      commandOutput.match(/\[info\] (.*?): Downloading webpage/);
    const videoTitle = videoTitleMatch ? videoTitleMatch[1] : "指定された動画";

    // "Unsupported URL" を含むかどうかの判定 (大文字・小文字を区別しない)
    if (/Unsupported URL/i.test(commandOutput)) {
      // "Unsupported URL" の場合は通知を表示
      app.displayNotification(`${videoTitle}:\nサポートされていないURLです。`, {
        withTitle: "yt-dlp 情報", // タイトルを「エラー」から「情報」へ変更
        subtitle: targetUrl,
      });
    } else {
      // それ以外のエラーは、原文をダイアログで表示
      app.displayAlert(`yt-dlp/シェル エラー (コード: ${exitCode})`, {
        message: `コマンド実行中にエラーが発生しました。\nURL: ${targetUrl}\n\nエラー出力:\n${commandOutput}`, // エラー出力全体を表示
        buttons: ["OK"],
        as: "critical",
      });
    }
  }
  return [];
}
