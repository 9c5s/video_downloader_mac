# yt-dlp Automator JXA Script

macOS Automatorから呼び出し、Safari/ChromeのURLを基にyt-dlpで動画をダウンロードするJXAスクリプト

## 機能

* ブラウザ: Safari/Chrome
* 依存: yt-dlp, (optionally ffmpeg)
* 入力: Automator引数 `-d <output_dir>`, `-f <filename_template>`
* 処理:
  * URL取得
  * yt-dlpで動画/プレイリスト情報取得
  * プレイリストはフォルダに分割ダウンロード
  * 通知で進捗/結果表示
* テンプレート:
  * 単一動画: `%(title)s_%(height)s_%(fps)s_%(vcodec.:4)s_(%(id)s).%(ext)s`
  * プレイリスト: `%(playlist_index& - |)s%(title)s_%(height)s_%(fps)s_%(vcodec.:4)s_(%(id)s).%(ext)s`

## 導入

1. JXAスクリプトを保存 (例: `video_downloader.js`)
2. Automator.app で「クイックアクション」作成
3. 「シェルスクリプトを実行」を追加
   * 「入力の引渡し方法」: 「引数として」
   * シェル: `/bin/zsh`
4. シェルスクリプトに以下を記述 (パスは適宜変更)

   ```bash
   osascript /path/to/video_downloader.js "$@"
   ```

5. 必要に応じて「Finder項目の取得」などで `-d`, `-f` を渡す
6. クイックアクションを保存

## 使用方法

1. Safari/Chromeで動画/プレイリストを開く
2. クイックアクション実行
3. 引数で出力ディレクトリ/ファイル名テンプレート指定 (例: `-d ~/Videos -f "%(title)s.%(ext)s"`)
