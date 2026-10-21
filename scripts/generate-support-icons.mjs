import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'apps/nodus-support/assets');
const geometry = JSON.parse(fs.readFileSync(path.join(root, 'shared/nodusMark.json'), 'utf8'));
const svg = fs.readFileSync(path.join(root, 'shared/support/mark.svg'), 'utf8');
fs.mkdirSync(output, { recursive: true });
const mark = await loadImage(Buffer.from(svg.replace('width="64" height="64"', 'width="1024" height="1024"')));
function render(size) {
  const canvas = createCanvas(size, size), ctx = canvas.getContext('2d');
  const inset = size * geometry.plateInsetRatio, plate = size - inset * 2;
  ctx.beginPath();
  ctx.roundRect(inset, inset, plate, plate, plate * geometry.plateRadiusRatio);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = size * 0.006; ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.stroke();
  const markSize = plate * geometry.markScaleRatio;
  ctx.drawImage(mark, (size - markSize) / 2, (size - markSize) / 2, markSize, markSize);
  return canvas.toBuffer('image/png');
}
const images = new Map([16,24,32,48,64,128,256,512,1024].map(size => [size, render(size)]));
fs.writeFileSync(path.join(output, 'icon.png'), images.get(1024));
const icoSizes = [16,24,32,48,64,128,256];
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
for (const [index, size] of icoSizes.entries()) {
  const start = 6 + index * 16, bytes = images.get(size);
  header[start] = size === 256 ? 0 : size; header[start + 1] = header[start];
  header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(bytes.length, start + 8); header.writeUInt32LE(offset, start + 12);
  offset += bytes.length;
}
fs.writeFileSync(path.join(output, 'icon.ico'), Buffer.concat([header, ...icoSizes.map(size => images.get(size))]));
// PNG-backed ICNS elements work on every supported macOS version; generation is portable.
const elements = [[16,'icp4'],[32,'icp5'],[64,'icp6'],[128,'ic07'],[256,'ic08'],[512,'ic09'],[1024,'ic10']].map(([size, type]) => {
  const png = images.get(size), item = Buffer.alloc(8);
  item.write(type); item.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([item,png]);
});
const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(8 + elements.reduce((n, item) => n + item.length, 0), 4);
fs.writeFileSync(path.join(output, 'icon.icns'), Buffer.concat([icns,...elements]));
console.log('Generated Nodus Support S icons for Windows, macOS and Linux.');
