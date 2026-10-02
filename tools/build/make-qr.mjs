// QRコードの画像を作る（ページの中で外部の仕組みに頼らずに表示するため、画像にして置いておく）
// 使い方: node make-qr.mjs <URL> <出力先.png>
//   例）node make-qr.mjs https://sakamoto-hospital.github.io/sakamoto-rehab-guide/fees.html ../../assets/qr-fees.png
import QRCode from 'qrcode';
const [url, out] = process.argv.slice(2);
if (!url || !out) { console.error('使い方: node make-qr.mjs <URL> <出力先.png>'); process.exit(1); }
await QRCode.toFile(out, url, { width: 480, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#083f42', light: '#ffffff' } });
console.log(`${out} ← ${url}`);
