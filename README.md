# image-viewer-V3

V2の見た目と機能を維持しつつ、様々な機能を追加します。

## 主な変更

- CBZ / ZIPを直接選択して読む
- JPG / JPEG / PNG / WebP / GIF / AVIFをページとして認識
- 画像本体はIndexedDBへ保存しない
- IndexedDBに保存するのは本棚情報、最終ページ、しおりだけ
- ページ表示時は必要な画像だけCBZから取り出す
- 前後ページを少数だけメモリに先読み
- 同じセッション中はCBZを選び直さず本棚から再度開ける
- セッションが切れた後は、本棚の「CBZ選択」から元CBZを選ぶと前回位置から再開

## 配置

GitHub Pagesでこのリポジトリのルートを公開してください。

初回だけzip.js取得のためネット接続が必要です。Service Workerがzip.jsを含むアプリ資材をキャッシュします。

zip.js: v2.8.34 (BSD-3-Clause)
https://github.com/gildas-lormeau/zip.js
