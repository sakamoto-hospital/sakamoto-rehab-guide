// 新しいチラシPDFから、公開ページで使う4つのファイルを同じ版でそろえて作り直す。
// 使い方: node update-flyer.mjs <チラシ.pdf>
//   → ../../assets/takt-reha-sakamoto-flyer.pdf  （画質を保って軽くしたPDF）
//     ../../assets/flyer-cover.jpg              （1ページ目の表紙）
//     ../../assets/icon-drink.png / icon-towel.png（2ページ目の持ち物の絵）
// ★チラシのレイアウトが変わったら、下の ICONS の切り出し位置（ページに対する割合）を直す。
//   実行後にできた絵を必ず目で見て、絵が欠けていないか確かめること。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, DOMMatrix, Path2D, ImageData } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

globalThis.DOMMatrix = DOMMatrix;
globalThis.Path2D = Path2D;
globalThis.ImageData = ImageData;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '../../assets');
const JPEG_QUALITY = 90;      // 90 なら文字のまわりに汚れが出ない
const COVER_WIDTH = 792;      // index.html では 396×560 で表示。高精細画面用に2倍
const ICON_SIZE = 240;

// 2ページ目の持ち物の絵（x, y, 幅, 高さ をページの幅・高さに対する割合で）
const ICONS = {
  'icon-drink.png': [0.512, 0.296, 0.075, 0.068],
  'icon-towel.png': [0.735, 0.300, 0.085, 0.064],
};

class CanvasFactory {
  create(w, h) { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext('2d') }; }
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; }
}

const src = process.argv[2];
if (!src) { console.error('使い方: node update-flyer.mjs <チラシ.pdf>'); process.exit(1); }
const bytes = fs.readFileSync(src);

// 各ページに入っている一番大きい画像の画素数を調べる（拡大して無駄に重くしないため）
const lib = await PDFDocument.load(bytes);
const nativeWidth = lib.getPages().map(page => {
  let best = 0;
  const xo = page.node.Resources()?.lookup(PDFName.of('XObject'));
  for (const [, ref] of xo?.entries() ?? []) {
    const obj = lib.context.lookup(ref);
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image')
      best = Math.max(best, Number(obj.dict.get(PDFName.of('Width'))?.toString()));
  }
  return best || 2480;  // 画像が無いページ（文字だけ）は A4 300dpi で描く
});

const factory = new CanvasFactory();
const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), CanvasFactory, canvasFactory: factory, isEvalSupported: false, verbosity: 0 }).promise;

async function render(pageNo, width) {
  const page = await doc.getPage(pageNo);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / vp1.width });
  const cc = factory.create(Math.round(vp.width), Math.round(vp.height));
  cc.context.fillStyle = '#fff';
  cc.context.fillRect(0, 0, cc.canvas.width, cc.canvas.height);
  await page.render({ canvasContext: cc.context, viewport: vp, canvasFactory: factory }).promise;
  return { canvas: cc.canvas, size: vp1 };
}

// ① 軽くしたPDF（ページの大きさはそのまま・中身をJPEGにする）
const out = await PDFDocument.create();
const pages = [];
for (let i = 1; i <= doc.numPages; i++) {
  const { canvas, size } = await render(i, nativeWidth[i - 1]);
  pages.push(canvas);
  const jpg = await out.embedJpg(await canvas.encode('jpeg', JPEG_QUALITY));
  out.addPage([size.width, size.height]).drawImage(jpg, { x: 0, y: 0, width: size.width, height: size.height });
}
out.setTitle('短時間専門デイケア タクト・リハさかもと ご案内');
const pdfBytes = await out.save();
fs.writeFileSync(path.join(ASSETS, 'takt-reha-sakamoto-flyer.pdf'), pdfBytes);

// ② 表紙
const first = pages[0];
const cover = createCanvas(COVER_WIDTH, Math.round(first.height * COVER_WIDTH / first.width));
cover.getContext('2d').drawImage(first, 0, 0, cover.width, cover.height);
fs.writeFileSync(path.join(ASSETS, 'flyer-cover.jpg'), await cover.encode('jpeg', 85));

// ③ 持ち物の絵（2ページ目から。正方形の白地の真ん中に置く）
if (pages[1]) {
  for (const [name, [x, y, w, h]] of Object.entries(ICONS)) {
    const p = pages[1];
    const sx = x * p.width, sy = y * p.height, sw = w * p.width, sh = h * p.height;
    const icon = createCanvas(ICON_SIZE, ICON_SIZE);
    const ctx = icon.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
    const k = (ICON_SIZE * 0.9) / Math.max(sw, sh);
    ctx.drawImage(p, sx, sy, sw, sh, (ICON_SIZE - sw * k) / 2, (ICON_SIZE - sh * k) / 2, sw * k, sh * k);
    fs.writeFileSync(path.join(ASSETS, name), await icon.encode('png'));
  }
}

const mb = n => (n / 1024 / 1024).toFixed(1) + 'MB';
console.log(`PDF ${mb(bytes.length)} → ${mb(pdfBytes.length)}（${doc.numPages}ページ・各ページ ${nativeWidth.join(' / ')}px 幅）`);
console.log('index.html のチラシ欄の「PDF・A4 ○ページ／約○MB」をこの数字に直すこと。');
