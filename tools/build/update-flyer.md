# チラシを新しい版に差し替える

公開ページでチラシを使っている4つのファイルを、**同じ版にそろえて**作り直します。
古いチラシの絵が残らないように、必ず4つまとめて差し替えてください。

| ファイル | 使っている場所 |
|---|---|
| `assets/rehaplus-sakamoto-flyer.pdf` | チラシのダウンロード |
| `assets/flyer-cover.jpg` | チラシ欄の表紙の絵 |
| `assets/icon-drink.png` | 持ち物「お飲み物」の絵（チラシ2ページ目から切り出し） |
| `assets/icon-towel.png` | 持ち物「汗を拭くタオル」の絵（同上） |

## 手順

```sh
cd tools/build
npm install          # 初回だけ
node update-flyer.mjs "C:/Users/.../新しいチラシ.pdf"
```

1. 最後に出る「PDF ○MB → ○MB」を見て、`index.html` のチラシ欄の「PDF・A4 ○ページ／約○MB」を直す
2. `assets/icon-drink.png`・`assets/icon-towel.png` を開いて、絵が欠けていないか目で見る。
   欠けていたら `update-flyer.mjs` の `ICONS`（ページに対する割合）を直してもう一度
3. 軽くしたPDFを開いて、小さい文字がつぶれていないか見る

## しくみ

- チラシは全面が画像なので、ページごとの画像を元の画素数のまま JPEG（品質90）で入れ直して軽くしています。
  2026-09-26 の版は 16.0MB → 1.4MB、見た目は元と見分けがつきません。
- 元の画像より大きく描き直すことはしません（重くなるだけで細かくはならないため）。

## QRコードを作る

```sh
node make-qr.mjs https://kaitokuwajima.github.io/sakamoto-rehab-guide/fees.html ../../assets/qr-fees.png
```

契約書などのPDFを `assets/docs/` に置いたときも、同じようにQRを作って `assets/fees.json` の `documents` に
`"pdf"` と `"qr"` のパスを入れると、料金ページにダウンロードボタンとQRが出ます。
