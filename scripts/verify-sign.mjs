// Electron UI against real local engines and disposable certificates.
// Native dialog responses are automated here only; production has no test mode.
import { _electron as electron } from "playwright-core";
import { PDFDocument, PDFName } from "pdf-lib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import sharp from "sharp";
import { buildSync } from "esbuild";
const require = createRequire(import.meta.url);
const root = process.cwd();
const out = path.resolve(process.env.NODUS_SIGN_VERIFY_DIR || path.join(root, "docs/verification/nodus-sign"));
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nodus-sign-ui-"));
buildSync({entryPoints:["shared/signI18n.ts"],outfile:path.join(profile,"copy.cjs"),bundle:true,platform:"node",format:"cjs",logLevel:"silent"});
const { signText } = require(path.join(profile,"copy.cjs"));
const fixture = path.join(profile, "agreement.pdf");
const exported = path.join(out, "visual-signed.pdf");
const signedExport = path.join(out, "certificate-signed.pdf");
const python = process.env.NODUS_SIGN_PYTHON;
assert.ok(
  python,
  "Set NODUS_SIGN_PYTHON to a Python environment with pyHanko and Pillow",
);
const doc = await PDFDocument.create();
for (let i = 0; i < 3; i++) {
  const p = doc.addPage([595, 842]);
  p.drawText("NODUS RESEARCH", { x: 48, y: 780, size: 12 });
  p.drawText(
    i === 0
      ? "Research collaboration agreement"
      : i === 1
        ? "Institutional approval"
        : "Final approval",
    { x: 48, y: 720, size: 23 },
  );
  p.drawText("Local verification document - TEST ONLY", {
    x: 48,
    y: 678,
    size: 12,
  });
  for (let line = 0; line < 8; line++)
    p.drawText("This document is a disposable test fixture for Nodus Sign.", {
      x: 48,
      y: 610 - line * 28,
      size: 12,
    });
  p.drawLine({
    start: { x: 48, y: 200 },
    end: { x: 540, y: 200 },
    thickness: 1,
  });
  p.drawText(`Signature / page ${i + 1}`, { x: 48, y: 175, size: 11 });
}
const original = Buffer.from(await doc.save());
fs.writeFileSync(fixture, original);
execFileSync(python, [
  "-c",
  `from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from datetime import datetime,timedelta,timezone
import sys,pathlib
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Nodus TEST ONLY')]);now=datetime.now(timezone.utc)
c=x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=7)).add_extension(x509.KeyUsage(True,True,False,False,False,False,False,False,False),True).sign(k,hashes.SHA256())
pathlib.Path(sys.argv[1]).write_bytes(pkcs12.serialize_key_and_certificates(b'test',k,c,None,serialization.BestAvailableEncryption(b'test-only')))
`,
  path.join(profile, "test.p12"),
]);
const env = {
  ...process.env,
  NODUS_USERDATA: profile,
  NODUS_SIGN_PYTHON: python,
  NODUS_DISABLE_AUTO_UPDATE: "1",
  NODUS_E2E_UPDATE_STATUS: "not-available",
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const report = {
  platform: process.platform,
  arch: process.arch,
  realEngine: true,
  renderer: process.env.VITE_DEV_SERVER_URL ? "development server" : "production files",
  nativeConfirmation: process.env.NODUS_SIGN_NATIVE_CONFIRM
    ? "Real native dialog reviewed and authorized with the disposable test certificate"
    : "Native dialog response automated by this test harness",
  timestamp: new Date().toISOString(),
  simulatedCrypto: false,
  screenshots: [],
  windowSizes: [],
  checks: [],
  errors: [],
};
try {
  app = await electron.launch({
    executablePath: require("electron"),
    args: [root],
    env,
    timeout: 120000,
  });
  app
    .process()
    .stderr?.pipe(
      fs.createWriteStream("/tmp/nodus-sign-electron.log", { flags: "a" }),
    );
  page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.waitForFunction(() => typeof window.nodus === "object");
  const version = require("../package.json").version;
  await page.evaluate(
    async ({ version, backup }) => {
      localStorage.setItem("nodus.lastSeenVersion", version);
      localStorage.setItem(`nodus.mobileTeaserSeen.${version}`, "1");
      localStorage.setItem("nodus.platformHighlightsSeen.2026-07", "1");
      localStorage.setItem("nodus.tutorialVideosAnnouncementSeen.2026-07", "1");
      localStorage.setItem("nodus.pdfPresenterTutorialSeen.e2js_u-05OA", "1");
      localStorage.setItem("nodus.navCollapsed", "0");
      sessionStorage.setItem("nodus.startupUpdateChecked", "1");
      await window.nodus.updateSettings({
        onboardingComplete: true,
        basicsTutorialVersion: 999,
        firstVaultVersion: 1,
        recoverySetupVersion: 999,
        tourComplete: true,
        advancedTourComplete: true,
        mascotEnabled: false,
        mascotStyleChosen: true,
        uiLanguage: "is",
        promptLanguage: "is",
        theme: "light",
        sidebarCustomized: true,
        sidebarHidden: [],
        autoBackupFolder: backup,
        toolkitPinnedPages: ["sign"],
      });
    },
    { version, backup: path.join(profile, "backups") },
  );
  await page.reload();
  await page.getByTestId("app-shell").waitFor();
  if (await page.locator(".backup-health-dismiss").count()) await page.locator(".backup-health-dismiss").click();
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 1000);
  });
  // Navigate through the real sidebar shortcut created by the normal pin setting.
  const signNav = page.getByRole("button", { name: "Nodus Sign", exact: true });
  await signNav.first().click();
  await page.getByTestId("toolkit-sign-page").waitFor();
  // Ink pixels on the drawing canvas, and the precise placement fields behind their disclosure.
  const inkPixels = () => page.evaluate(() => { const c = document.querySelector('[data-testid="sign-drawing"]'); const d = c.getContext("2d").getImageData(0, 0, 900, 300).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++; return n; });
  const inkSpan = () => page.evaluate(() => { const c = document.querySelector('[data-testid="sign-drawing"]'); const d = c.getContext("2d").getImageData(0, 0, 900, 300).data; let l = 900, r = -1; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) { const x = ((i - 3) / 4) % 900; l = Math.min(l, x); r = Math.max(r, x); } return r - l + 1; });
  const openPrecise = async () => { for (const details of await page.locator('.sign-precise').all()) if (await details.isVisible() && !(await details.evaluate(el => el.open))) await details.locator('summary').click(); };
  const shot = async (name) => {
    if (!(await page.locator('.sign-dialog').count()) && await page.locator('.backup-health-dismiss').isVisible()) await page.locator('.backup-health-dismiss').click();
    // This fixture has text on every page. Wait for the actual PDF bitmap,
    // including after a theme/layout repaint, rather than capturing a blank frame.
    if (await page.locator('.sign-paper>canvas').count()) {
      await page.waitForFunction(() => {
        const canvas=document.querySelector('.sign-paper>canvas');
        if (!canvas || !canvas.width || getComputedStyle(canvas.parentElement).visibility !== 'visible') return false;
        const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        let ink=0; for(let i=0;i<pixels.length;i+=4) if(pixels[i]<180 && pixels[i+1]<180 && pixels[i+2]<180 && pixels[i+3]>0 && ++ink>200) return true;
        return false;
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    // Verify the captured compositor bitmap too: canvas readback can precede its paint.
    let buffer;
    for (let attempt=0; attempt<5; attempt++) {
      await page.waitForTimeout(200);
      buffer=await page.screenshot({fullPage:true,scale:"css"});
      const box=await page.locator('.sign-paper').count()?await page.locator('.sign-paper').first().boundingBox():null;
      if (!box || box.y<0 || box.width<30 || await page.locator('.sign-dialog').count()) break;
      const meta=await sharp(buffer).metadata();
      const scale=meta.width/(await page.evaluate(()=>window.innerWidth));
      const left=Math.max(0,Math.round(box.x*scale)),top=Math.max(0,Math.round(box.y*scale));
      const width=Math.min(Math.floor(box.width*scale),meta.width-left),height=Math.min(Math.floor(box.height*.6*scale),meta.height-top);
      if(width<10||height<10)break;
      const pixels=await sharp(buffer).extract({left,top,width,height}).removeAlpha().raw().toBuffer();
      let ink=0;for(let i=0;i<pixels.length;i+=3)if(pixels[i]<180&&pixels[i+1]<180&&pixels[i+2]<180)ink++;
      if(ink>100)break;
      assert.ok(attempt<4,'PDF text must be painted in the actual screenshot');
    }
    fs.writeFileSync(path.join(out,name),buffer);
    report.screenshots.push(name);
    console.log(name);
  };
  report.windowSizes.push(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds()));
  await shot("01-empty-light.png");
  report.checks.push("Empty state and pinned navigation");
  const dialog = async (kind, payload) =>
    app.evaluate(
      ({ dialog }, { kind, payload }) => {
        if (!globalThis.__signNativeMessageBox)
          globalThis.__signNativeMessageBox = dialog.showMessageBox;
        if (kind === "native")
          dialog.showMessageBox = globalThis.__signNativeMessageBox;
        else if (kind === "open")
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [payload],
          });
        else if (kind === "save")
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: payload,
          });
        else if (kind === "cancel")
          dialog.showSaveDialog = async () => ({ canceled: true });
        else if (kind === "confirm")
          dialog.showMessageBox = async () => ({
            response: payload,
            checkboxChecked: false,
          });
      },
      { kind, payload },
    );
  await dialog("open", fixture);
  await page.getByTestId("sign-open").click();
  await page.getByRole("spinbutton", { name: "Page number" }).waitFor();
  await page.locator(".sign-paper>canvas").waitFor({ state: "visible" });
  await page
    .getByRole("button", { name: "Show pages", exact: true })
    .click();
  assert.equal(await page.locator(".sign-thumbs").count(), 0);
  await page
    .getByRole("button", { name: "Show pages", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show library", exact: true })
    .click();
  assert.equal(await page.locator(".sign-panel").count(), 0);
  await page
    .getByRole("button", { name: "Show library", exact: true })
    .click();
  const panelBefore = await page
    .locator(".sign-panel")
    .evaluate((el) => el.clientWidth);
  await page.getByRole("separator", { name: "Panel width" }).focus();
  await page.keyboard.press("ArrowLeft");
  assert.ok(
    (await page.locator(".sign-panel").evaluate((el) => el.clientWidth)) >
      panelBefore,
  );
  await page.keyboard.press("ArrowRight");
  await page.getByLabel("Zoom", { exact: true }).selectOption("1.25");
  await page.getByLabel("Zoom", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Page 3", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Page number" }).fill("1");
  report.checks.push(
    "Hide/show panels; keyboard panel resize; zoom; thumbnail navigation",
  );

  await page.getByTestId("sign-create").click();
  await page
    .getByLabel("Signature name", { exact: true })
    .fill("Personal · Test");
  const canvas = page.getByTestId("sign-drawing");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 0; i < 75; i++)
    await page.mouse.move(
      box.x + box.width * (0.15 + i * 0.008),
      box.y + box.height * (0.5 + Math.sin(i * 0.28) * 0.18),
    );
  await page.mouse.up();
  await page.locator('.sign-dialog').getByRole('button',{name:'Undo',exact:true}).click();
  await page.waitForFunction(()=>{const c=document.querySelector('[data-testid="sign-drawing"]');return !c.getContext('2d').getImageData(0,0,900,300).data.some((v,i)=>i%4===3&&v>0);});
  await page.locator('.sign-dialog').getByRole('button',{name:'Redo',exact:true}).click();
  await page.waitForFunction(()=>{const c=document.querySelector('[data-testid="sign-drawing"]');return c.getContext('2d').getImageData(0,0,900,300).data.some((v,i)=>i%4===3&&v>0);});
  report.checks.push('Drawing undo and redo restore actual canvas pixels');
  // Draw on the trackpad. With a Mac trackpad the finger frames arrive from the
  // native addon; here they are injected on its own IPC channel. Elsewhere the
  // mode locks the cursor instead.
  const toolbar = page.locator('.sign-dialog .sign-toolbar');
  for (const label of ['Draw on the trackpad', 'Undo', 'Redo', 'Clear', 'Crop', 'Import image', 'Remove light background'])
    assert.equal(await toolbar.getByRole('button', { name: label, exact: true }).getAttribute('title'), label);
  const beforeTrackpad = await inkPixels();
  await page.getByTestId('sign-trackpad').click();
  await page.waitForFunction(() => document.querySelector('.sign-drawing')?.dataset.trackpad, null, { timeout: 5000 }).catch(() => {});
  const trackpadMode = await page.locator('.sign-drawing').getAttribute('data-trackpad');
  if (trackpadMode === 'finger') {
    await page.getByTestId('sign-trackpad-area').waitFor();
    await app.evaluate(async ({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      const send = (contacts) => wc.send('sign:trackpad:frame', { device: 0, width: 142.67, height: 85.09, contacts });
      for (let i = 0; i < 60; i++) { send([{ id: 9001, x: 0.1 + i * 0.013, y: 0.1 + (i % 20) * 0.04 }]); await new Promise(r => setTimeout(r, 8)); }
      send([]);
    });
    assert.ok(await inkPixels() > beforeTrackpad, 'finger frames draw');
    await shot('02a-trackpad-finger.png');
    await page.keyboard.press('Escape');
    await page.locator('.sign-drawing:not([data-trackpad])').waitFor();
    assert.equal(await page.locator('.sign-dialog').count(), 1, 'Esc ends trackpad drawing without closing the editor');
    await page.locator('.sign-dialog').getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction((n) => { const c = document.querySelector('[data-testid="sign-drawing"]'); const d = c.getContext('2d').getImageData(0, 0, 900, 300).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) k++; return k === n; }, beforeTrackpad);
    report.checks.push('Trackpad finger drawing: whole trackpad framed to scale, strokes from native frames, Esc keeps the editor open, one undo step per stroke');
  } else if (trackpadMode === 'cursor') {
    await page.keyboard.press('Enter');
    await page.locator('.sign-drawing:not([data-trackpad])').waitFor();
    report.checks.push('Trackpad cursor mode: locked cursor, Enter ends it and keeps the editor open');
  }
  // Crop before saving: the east handle trims the right part of the drawing.
  const fullSpan = await inkSpan();
  await page.getByTestId('sign-crop-tool').click();
  const cropFrame = page.getByTestId('sign-crop');
  await cropFrame.waitFor();
  const east = await cropFrame.locator('[data-handle="e"]').boundingBox();
  const drawingBox = await page.getByTestId('sign-drawing').boundingBox();
  await page.mouse.move(east.x + east.width / 2, east.y + east.height / 2);
  await page.mouse.down();
  await page.mouse.move(east.x - drawingBox.width * 0.2, east.y + east.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-testid="sign-crop"][data-editing]'));
  assert.equal(await page.locator('.sign-dialog').count(), 1, 'Esc ends cropping without closing the editor');
  await shot("02-drawing.png");
  await page.getByTestId("sign-save-signature").click();
  await page.getByTestId("sign-insert-signature").first().waitFor();
  const savedWidth = await page.evaluate(async () => (await window.nodus.getSignLibrary()).signatures[0].width);
  assert.ok(savedWidth < fullSpan + 17 - drawingBox.width * 0.1, `cropped width ${savedWidth} vs drawing ${fullSpan}`);
  report.checks.push(`Crop frame trims the saved signature (${fullSpan + 17} px wide uncropped, ${savedWidth} px saved)`);
  const signaturePng = await page.evaluate(
    async () => (await window.nodus.getSignLibrary()).signatures[0].png,
  );
  const importedSignature = path.join(profile, "signature.png");
  fs.writeFileSync(
    importedSignature,
    Buffer.from(signaturePng.split(",")[1], "base64"),
  );
  await page.getByTestId("sign-create").click();
  await page.getByLabel("Signature name", { exact: true }).fill("Academic");
  await page
    .locator(".sign-dialog input[type=file]")
    .setInputFiles(importedSignature);
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid="sign-drawing"]');
    return (
      c &&
      c
        .getContext("2d")
        .getImageData(0, 0, 900, 300)
        .data.some((v, i) => i % 4 === 3 && v > 0)
    );
  });
  await page
    .getByRole("button", { name: "Remove light background", exact: true })
    .click();
  await page.getByTestId("sign-save-signature").click();
  await page
    .getByRole("button", { name: "Edit signature: Academic", exact: true })
    .click();
  await page
    .getByLabel("Signature name", { exact: true })
    .fill("Institutional · Test");
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid="sign-drawing"]');
    return (
      c &&
      c
        .getContext("2d")
        .getImageData(0, 0, 900, 300)
        .data.some((v, i) => i % 4 === 3 && v > 0)
    );
  });
  await page.getByTestId("sign-save-signature").click();
  await page.getByTestId("sign-insert-signature").nth(1).waitFor();
  assert.equal(await page.getByTestId("sign-insert-signature").count(), 2);
  await page.getByTestId('sign-create').click();
  await page.getByLabel('Signature name',{exact:true}).fill('Temporary · Test');
  await page.locator('.sign-dialog input[type=file]').setInputFiles(importedSignature);
  await page.waitForFunction(()=>{const c=document.querySelector('[data-testid="sign-drawing"]');return c.getContext('2d').getImageData(0,0,900,300).data.some((v,i)=>i%4===3&&v>0);});
  await page.getByTestId('sign-save-signature').click();
  await page.getByTestId('sign-insert-signature').nth(2).waitFor();
  assert.equal(await page.getByTestId('sign-insert-signature').count(),3);
  await page.getByRole('button',{name:'Delete signature: Temporary · Test',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
  await page.getByRole('button',{name:'Delete signature: Temporary · Test',exact:true}).waitFor({state:'detached'});
  assert.equal(await page.getByTestId('sign-insert-signature').count(),2);
  report.checks.push('Signature library deletion confirmed through the real Nodus dialog; other signatures preserved');
  await shot("02b-library-import-edit.png");
  report.checks.push(
    "Multiple signatures; image import; light background processing; edit and rename",
  );

  await page.getByTestId("sign-insert-signature").first().click();
  await page.getByTestId("sign-placement").waitFor();
  const placed = page.getByTestId("sign-placement");
  await placed.focus();await page.keyboard.press('Delete');
  assert.equal(await placed.count(),0);
  await page.getByTestId('sign-insert-signature').first().click();
  const originalLeft=await placed.evaluate(el=>el.style.left);
  await placed.focus();await page.keyboard.press('ArrowRight');
  assert.notEqual(await placed.evaluate(el=>el.style.left),originalLeft);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await placed.evaluate(el=>el.style.left),originalLeft);
  report.checks.push('Placement deletion and keyboard position adjustment');
  assert.equal(
    await placed.evaluate((el) => el.style.top),
    "68%",
    "The latest default placement is rendered",
  );
  let bounds = await placed.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 70,
    bounds.y + bounds.height / 2 + 80,
    { steps: 8 },
  );
  await page.mouse.up();
  bounds = await placed.boundingBox();
  await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width + 20,
    bounds.y + bounds.height + 10,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.getByRole("slider", { name: "Rotation", exact: true }).fill("8");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await openPrecise();
  await page.getByRole('spinbutton',{name:'Horizontal position (%)',exact:true}).fill('12');
  await page.getByRole('spinbutton',{name:'Vertical position (%)',exact:true}).fill('65');
  await page.getByRole('spinbutton',{name:'Signature width (%)',exact:true}).fill('38.5');
  await page.getByLabel("Keep proportions",{exact:true}).uncheck();
  await page.getByRole('spinbutton',{name:'Signature height (%)',exact:true}).fill('10');
  await page.getByRole('combobox',{name:"Quick placement",exact:true}).selectOption('1-2');
  assert.equal(await placed.evaluate(el=>el.style.left),'30.75%');
  await page.getByRole('combobox',{name:"Signature pages",exact:true}).selectOption('custom');
  await page.getByRole('textbox',{name:"Pages or ranges",exact:true}).fill('99');
  assert.ok(await page.getByTestId('sign-apply-pages').isDisabled());
  await page.getByRole('textbox',{name:"Pages or ranges",exact:true}).fill('1, 3');
  await page.getByTestId('sign-apply-pages').click();
  await page.getByRole('spinbutton',{name:"Page number",exact:true}).fill('3');
  assert.equal(await placed.count(),1);
  assert.equal(await placed.evaluate(el=>el.style.width),'38.5%');
  await page.getByRole('combobox',{name:"Signature pages",exact:true}).selectOption('all');
  await page.getByTestId('sign-apply-pages').click();
  await page.getByRole('spinbutton',{name:"Page number",exact:true}).fill('2');
  assert.equal(await placed.count(),1);
  await page.getByRole('combobox',{name:"Signature pages",exact:true}).selectOption('custom');
  await page.getByRole('textbox',{name:"Pages or ranges",exact:true}).fill('1, 3');
  await page.getByTestId('sign-apply-pages').click();
  await page.getByRole('spinbutton',{name:"Page number",exact:true}).fill('2');
  assert.equal(await placed.count(),0);
  await page.getByRole('spinbutton',{name:"Page number",exact:true}).fill('1');
  await page.getByTestId('sign-apply-pages').scrollIntoViewIfNeeded();
  await shot('03a-placement-pages-light.png');
  await page.evaluate(()=>window.nodus.updateSettings({theme:'dark'}));
  await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
  await shot('03b-placement-pages-dark.png');
  await page.evaluate(()=>window.nodus.updateSettings({theme:'light'}));
  await page.waitForFunction(()=>document.documentElement.classList.contains('light'));
  await page.locator('.sign-placement-controls').scrollIntoViewIfNeeded();
  await shot('03c-exact-dimensions-light.png');
  report.checks.push('Exact numeric position and dimensions; unlock proportions; preset alignment; invalid range rejected; replicate all/custom; remove copies without duplicates');
  await page
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  await page.getByTestId("sign-insert-signature").first().click();
  await page
    .getByRole("textbox", {
      name: "Name, date, institution or role",
      exact: true,
    })
    .fill("Nodus Research\n15/10/2026 · Test only");
  await page
    .getByRole("button", { name: "Insert text", exact: true })
    .click();
  await shot("03-multiple-light.png");
  report.checks.push(
    "PDF import; drawing; persistent signature; move; resize; rotate; undo/redo; multiple pages; text",
  );
  await page
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await dialog("save", fixture);
  await page.getByTestId("sign-export").click();
  await page
    .getByText("The original is protected. Choose another name or location.", {
      exact: true,
    })
    .waitFor();
  assert.deepEqual(fs.readFileSync(fixture), original);
  report.checks.push("Export over original refused");
  await dialog("cancel");
  await page.getByTestId("sign-export").click();
  await page.getByText("Operation cancelled.", { exact: true }).waitFor();
  await dialog("save", exported);
  await page.getByTestId("sign-export").click();
  await page.getByText("Signed copy exported.", { exact: true }).waitFor();
  assert.ok(fs.existsSync(exported));
  assert.deepEqual(fs.readFileSync(fixture), original);
  await shot("04-preview-export.png");
  await page.getByTestId("sign-save-vault").click();
  await page
    .getByText("Copy saved in Nodus files.", { exact: true })
    .waitFor();
  report.checks.push("Export and save to Nodus; original byte identical");
  await page.getByRole("button", { name: "From Nodus", exact: true }).click();
  await page.locator(".sign-vault-source").first().click();
  await page.locator(".sign-paper>canvas").waitFor({ state: "visible" });
  report.checks.push("Reimport from the real Nodus archive");
  await page.getByRole("tab", { name: "Certificates", exact: true }).click();
  await page.getByTestId("sign-pick-certificate").waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="sign-pick-certificate"]').disabled,
    { timeout: 90000 },
  );
  await page.getByRole("spinbutton", { name: "Page number" }).fill("3");
  await shot("05-certificate-no-selection.png");
  await page.getByText("Advanced engine settings",{exact:true}).click();
  await dialog("open", path.join(profile, "missing-python"));
  await page.getByRole('button',{name:"Use another Python",exact:true}).click();
  await page.locator('.sign-engine').filter({hasText:"Certificate engine unavailable"}).waitFor();
  await shot('05b-engine-unavailable.png');
  await page.getByTestId('sign-install-engine').click();
  await page.getByTestId('sign-install-progress').waitFor();
  await shot('05c-engine-install-progress.png');
  await page.getByRole('tab',{name:"Handwritten",exact:true}).click();
  assert.ok(await page.getByTestId('sign-create').isEnabled());
  await page.getByRole('tab',{name:"Certificates",exact:true}).click();
  await page.getByRole('button',{name:"Cancel installation",exact:true}).click();
  await page.getByText("Installation cancelled. You can try again.",{exact:true}).waitFor();
  await shot('05d-engine-install-cancelled.png');
  await page.getByTestId('sign-install-engine').click();
  await page.getByText("Signing engine installed and ready to use.",{exact:true}).waitFor({timeout:300000});
  assert.ok(await page.getByTestId('sign-pick-certificate').isEnabled());
  await shot('05e-engine-installed.png');
  report.checks.push('Real automatic installation by button; progress; cancellation; retry; isolated environment; handwriting remains usable during installation');
  await dialog("open", path.join(profile, "test.p12"));
  await page.getByTestId("sign-pick-certificate").click();
  await page
    .getByLabel("Certificate password", { exact: true })
    .fill("wrong");
  await page.getByTestId("sign-inspect-certificate").click();
  await page.getByRole("alert").waitFor();
  await shot("06-certificate-error.png");
  await page
    .getByLabel("Certificate password", { exact: true })
    .fill("test-only");
  await page.getByTestId("sign-inspect-certificate").click();
  await page
    .getByText("Certificate available for signing.", { exact: true })
    .waitFor();
  await page.locator('.sign-certificate').scrollIntoViewIfNeeded();await shot('06b-certificate-details.png');
  await page
    .getByLabel("Visible name", { exact: true })
    .fill("Nodus TEST ONLY");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Research approval · TEST ONLY");
  await page
    .getByLabel("Handwritten image", { exact: true })
    .selectOption({ label: "Personal · Test" });
  await page
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  const cryptoPlaced=page.getByTestId('sign-crypto-placement');
  const cryptoBefore=await cryptoPlaced.boundingBox();
  await page.mouse.move(cryptoBefore.x+cryptoBefore.width/2,cryptoBefore.y+cryptoBefore.height/2);
  await page.mouse.down();await page.mouse.move(cryptoBefore.x+cryptoBefore.width/2-30,cryptoBefore.y+cryptoBefore.height/2-30,{steps:8});await page.mouse.up();
  const resize=await cryptoPlaced.locator('[data-handle="se"]').boundingBox();
  await page.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2);await page.mouse.down();await page.mouse.move(resize.x-20,resize.y+15,{steps:8});await page.mouse.up();
  assert.notEqual(await cryptoPlaced.evaluate(el=>el.style.width),'64%');
  // The west edge stretches only the width and keeps the right edge in place.
  const boxStyle=()=>cryptoPlaced.evaluate(el=>({left:parseFloat(el.style.left),width:parseFloat(el.style.width),height:parseFloat(el.style.height)}));
  const beforeWest=await boxStyle();
  const west=await cryptoPlaced.locator('[data-handle="w"]').boundingBox();
  await page.mouse.move(west.x+west.width/2,west.y+west.height/2);await page.mouse.down();await page.mouse.move(west.x-40,west.y+west.height/2+10,{steps:8});await page.mouse.up();
  await page.waitForFunction(before=>parseFloat(document.querySelector('[data-testid="sign-crypto-placement"]').style.width)>before+2,beforeWest.width);
  const afterWest=await boxStyle();
  assert.ok(Math.abs(afterWest.left+afterWest.width-beforeWest.left-beforeWest.width)<0.05&&Math.abs(afterWest.height-beforeWest.height)<1e-6,JSON.stringify({beforeWest,afterWest}));
  report.checks.push('Certificate box: corner keeps proportions, west edge stretches width only with the opposite edge fixed');
  await openPrecise();
  await page.getByRole('spinbutton',{name:'Horizontal position (%)',exact:true}).fill('8');
  await page.getByRole('spinbutton',{name:'Vertical position (%)',exact:true}).fill('60');
  await page.getByLabel("Keep proportions",{exact:true}).uncheck();
  await page.getByRole('spinbutton',{name:'Signature width (%)',exact:true}).fill('70');
  await page.getByRole('spinbutton',{name:'Signature height (%)',exact:true}).fill('15');
  await page.getByRole('combobox',{name:"Signature pages",exact:true}).selectOption('custom');
  await page.getByRole('textbox',{name:"Pages or ranges",exact:true}).fill('1, 3');
  await page.getByRole('spinbutton',{name:"Page number",exact:true}).fill('2');
  assert.equal(await cryptoPlaced.count(),0);
  await page.getByRole('spinbutton',{name:"Page number",exact:true}).fill('1');
  assert.equal(await cryptoPlaced.count(),1);
  assert.equal(await cryptoPlaced.evaluate(el=>el.style.width),'70%');
  await page.getByRole('spinbutton',{name:"Page number",exact:true}).fill('3');
  await page.getByRole('combobox',{name:"Signature pages",exact:true}).selectOption('all');
  await page.getByRole('spinbutton',{name:"Page number",exact:true}).fill('2');
  assert.equal(await cryptoPlaced.count(),1);
  await page.getByRole('combobox',{name:"Signature pages",exact:true}).selectOption('custom');
  await page.getByRole('spinbutton',{name:"Page number",exact:true}).fill('3');
  await page.locator('.sign-placement-controls').scrollIntoViewIfNeeded();
  await shot('07a-certificate-placement-pages.png');
  report.checks.push('Certificate drag and resize; exact position and dimensions; preview only on selected pages; all/current/custom selectors');
  await page
    .getByLabel(
      "I authorize signing a copy of this document with the selected certificate.",
      { exact: true },
    )
    .check();
  await shot("07-certificate-ready.png");
  // Verify native cancellation does not create a cryptographic history entry.
  await dialog("confirm", 0);
  await page.getByTestId("sign-crypto-submit").click();
  await page.getByText("Operation cancelled.", { exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(),0,'User cancellation is a neutral notice');
  await shot("08-certificate-cancelled.png");
  await page
    .getByLabel("Certificate password", { exact: true })
    .fill("test-only");
  await page
    .getByLabel(
      "I authorize signing a copy of this document with the selected certificate.",
      { exact: true },
    )
    .check();
  await dialog(process.env.NODUS_SIGN_NATIVE_CONFIRM ? "native" : "confirm", 1);
  if (process.env.NODUS_SIGN_NATIVE_CONFIRM)
    console.log("Awaiting native signing confirmation");
  await page.getByTestId("sign-crypto-submit").click();
  await page
    .getByText("Cryptographic signature completed and checked.", { exact: true })
    .waitFor({ timeout: 120000 });
  await page.getByTestId("sign-validation").waitFor();
  await page.getByText("Cryptographic integrity verified.",{exact:true}).first().waitFor();
  assert.equal(await page.getByText("Cryptographic integrity verified.",{exact:true}).count(),2);
  assert.equal(await page.getByRole('spinbutton',{name:"Page number"}).inputValue(),'3');
  await page.getByText('Covers a previous signed revision.',{exact:true}).waitFor();
  await page.getByText('Covers the entire document.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Compatible changes to forms or later signatures.',{exact:true}).count(),1);
  assert.equal(await page.locator('[data-testid="sign-validation"]').getByText(/ENTIRE_REVISION|FORM_FILLING/).count(),0);
  await shot("09-certificate-signed.png");
  await dialog("save", signedExport);
  await page.getByTestId("sign-export").click();
  await page.getByText("Signed copy exported.", { exact: true }).waitFor();
  assert.ok(fs.existsSync(signedExport));
  // Read-only inspection: never serialize a signed PDF through pdf-lib.
  const signedPdf=await PDFDocument.load(fs.readFileSync(signedExport),{updateMetadata:false});
  const widgets=signedPdf.getPages().map(p=>(p.node.Annots()?.asArray()??[]).map(ref=>signedPdf.context.lookup(ref)).filter(a=>a.get(PDFName.of('Subtype'))===PDFName.of('Widget')));
  assert.deepEqual(widgets.map(list=>list.length),[1,0,1]);
  for (const n of [0,2]) {
    const rect=widgets[n][0].lookup(PDFName.of('Rect')).asArray().map(v=>v.asNumber());
    for(const [i,expected] of [47.6,210.5,464.1,336.8].entries()) assert.ok(Math.abs(rect[i]-expected)<.02,`${rect} vs expected position/size`);
  }
  report.checks.push('Signed PDF widgets on pages 1 and 3 only; exported rectangles match 8%/60% position and 70%/15% dimensions');
  report.checks.push(
    "Real PKCS#12; wrong password; appearance profile; handwriting in appearance; explicit authorization; cancellation; real PAdES; validation",
  );
  await page.evaluate(() => window.nodus.updateSettings({ theme: "dark" }));
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("dark"),
  );
  await shot("10-dark.png");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(850, 780),
  );
  report.windowSizes.push(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds()));
  await shot("11-small-dark.png");
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await shot("12-history-dark.png");
  const lib = await page.evaluate(() => window.nodus.getSignLibrary());
  assert.equal(lib.signatures.length, 2);
  assert.equal(lib.profiles.length, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(profile,'toolkit','sign','library.json'),'utf8'),/test-only|PRIVATE KEY|"password"/);
  assert.deepEqual(fs.readFileSync(fixture),original);
  assert.equal(lib.history.filter((h) => h.mode === "certificate").length, 1);
  report.checks.push(
    "Dark theme; small window; history; signature/profile persistence",
  );
  await page.getByRole('tab',{name:"Certificates",exact:true}).click();
  await page.getByRole('button',{name:"Prepare another signature",exact:true}).click();
  await openPrecise();
  await page.getByRole('spinbutton',{name:'Signature width (%)',exact:true}).scrollIntoViewIfNeeded();
  await shot('13-small-certificate-controls-dark.png');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));
  // A certificate signature with no appearance: nothing to place, one more valid signature.
  await page.getByTestId('sign-crypto-visible').uncheck();
  assert.equal(await page.getByTestId('sign-crypto-placement').count(),0);
  assert.equal(await page.locator('.sign-placement-controls').count(),0);
  await page.getByText('The signature is embedded in the PDF without any mark on its pages. PDF readers show it in their signatures panel.',{exact:true}).waitFor();
  await page.getByLabel('Certificate password',{exact:true}).fill('test-only');
  await page.getByLabel('I authorize signing a copy of this document with the selected certificate.',{exact:true}).check();
  await dialog('confirm',1);
  await page.getByTestId('sign-crypto-submit').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-testid="sign-validation"] *')].filter(el=>el.childElementCount===0&&el.textContent==='Cryptographic integrity verified.').length===3,null,{timeout:120000});
  const invisibleExport=path.join(out,'certificate-signed-invisible.pdf');
  await dialog('save',invisibleExport);
  await page.getByTestId('sign-export').click();
  await page.getByText('Signed copy exported.',{exact:true}).waitFor();
  const invisiblePdf=await PDFDocument.load(fs.readFileSync(invisibleExport),{updateMetadata:false});
  const allWidgets=invisiblePdf.getPages().flatMap(p=>(p.node.Annots()?.asArray()??[]).map(ref=>invisiblePdf.context.lookup(ref)).filter(a=>a.get(PDFName.of('Subtype'))===PDFName.of('Widget')));
  const zeroRects=allWidgets.filter(a=>a.lookup(PDFName.of('Rect')).asArray().every(v=>v.asNumber()===0));
  assert.equal(allWidgets.length,3);
  assert.equal(zeroRects.length,1,'one signature has a zero-sized, invisible widget');
  const invisibleSig=execFileSync('pdfsig',[invisibleExport],{encoding:'utf8'});
  assert.equal((invisibleSig.match(/Signature is Valid/g)||[]).length,3);
  report.checks.push('Certificate signature without appearance: no placement, one zero-sized widget, Poppler validates all three signatures');
  await page.getByRole('button',{name:"Prepare another signature",exact:true}).click();
  await page.getByTestId('sign-crypto-visible').check();
  for (const theme of ['light','dark']) {
    await page.evaluate(({theme})=>window.nodus.updateSettings({theme,appTheme:'sage-stone'}),{theme});
    await page.waitForFunction(({theme})=>document.documentElement.classList.contains(theme)&&document.documentElement.dataset.appTheme==='sage-stone',{theme});
    const colors=await page.locator('.sign-workspace').evaluate(el=>{
      const dark=document.documentElement.classList.contains('dark');
      const probe=document.createElement('span');el.append(probe);
      probe.style.color='var(--sign-accent)';const actual=getComputedStyle(probe).color;
      probe.style.color=dark?'var(--a-400)':'var(--a-600)';const expected=getComputedStyle(probe).color;
      probe.style.backgroundColor=dark?'var(--n-900)':'var(--n-50)';const expectedBg=getComputedStyle(probe).backgroundColor;
      const actualBg=getComputedStyle(el.querySelector('.sign-panel')).backgroundColor;
      probe.remove();return {actual,expected,actualBg,expectedBg};
    });
    assert.equal(colors.actual,colors.expected);
    assert.equal(colors.actualBg,colors.expectedBg);
    report.checks.push(`Custom sage-stone palette ${theme}: ${JSON.stringify(colors)}`);
    await shot(`14-palette-${theme}.png`);
  }
  await page.evaluate(()=>window.nodus.updateSettings({theme:'light',appTheme:'default',interfaceScale:1.3,accessibleFont:true}));
  await page.getByRole('tab',{name:"Handwritten",exact:true}).click();
  await shot('15a-large-ui-light.png');
  await page.getByTestId('sign-create').click();
  await shot('15-drawing-large-ui-light.png');
  await page.getByRole('button',{name:"Cancel",exact:true}).click();
  await page.evaluate(()=>window.nodus.updateSettings({theme:'dark',interfaceScale:1,accessibleFont:false}));
  await page.getByTestId('sign-create').click();
  await shot('16-drawing-dark.png');
  await page.getByRole('button',{name:"Cancel",exact:true}).click();
  const overflow=await page.locator('.sign-workspace').evaluate(el=>el.scrollWidth>el.clientWidth+1);
  assert.equal(overflow,false,'Workspace has no horizontal overflow');
  report.checks.push('Custom palette in both modes; large interface and accessible font; drawing dialog light/dark; no workspace horizontal overflow');
  await page.reload();
  await page.getByTestId("app-shell").waitFor();
  await page
    .getByRole("button", { name: "Nodus Sign", exact: true })
    .first()
    .click();
  await page.getByTestId("sign-insert-signature").nth(1).waitFor();
  assert.equal(await page.getByTestId("sign-insert-signature").count(), 2);
  await page.getByRole("tab", { name: "Certificates", exact: true }).click();
  await page
    .getByLabel("Appearance profile")
    .selectOption(lib.profiles[0].id);
  assert.equal(
    await page.getByLabel("Visible name", { exact: true }).inputValue(),
    "Nodus TEST ONLY",
  );
  report.checks.push("Library and profiles survive renderer restart");
  // Locale layout checks use real translations and the same real certificate engine.
  // Existing user-authored signature/profile names remain as entered.
  await dialog("open",fixture);
  await page.getByTestId("sign-open").click();
  await dialog('open',path.join(profile,'test.p12'));
  await page.getByTestId('sign-pick-certificate').click();
  await page.getByLabel('Certificate password',{exact:true}).fill('test-only');
  await page.getByTestId('sign-inspect-certificate').click();
  await page.getByText('Certificate available for signing.',{exact:true}).waitFor();
  await page.getByLabel('I authorize signing a copy of this document with the selected certificate.',{exact:true}).check();
  const authorizedAppearance=await page.getByTestId('sign-crypto-placement').locator('img').getAttribute('src');
  await page.evaluate(()=>window.nodus.updateSettings({uiLanguage:'ja'}));
  await page.getByRole('tab',{name:signText('ja','Certificados'),exact:true}).waitFor();
  await page.waitForFunction(before=>document.querySelector('[data-testid="sign-crypto-placement"] img')?.getAttribute('src')!==before,authorizedAppearance);
  assert.equal(await page.getByLabel(signText('ja','Autorizo firmar una copia de este documento con el certificado seleccionado.'),{exact:true}).isChecked(),false);
  report.checks.push('Language change refreshes certificate appearance/date and withdraws explicit authorization');
  await page.evaluate(()=>window.nodus.updateSettings({uiLanguage:'en'}));
  await page.getByRole('tab',{name:'Certificates',exact:true}).waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,780));
  for(const [index,language] of ['en','es','fr','de','pt','pt-BR','it','tr','zh-CN','zh-TW','ja','ko'].entries()) {
    const theme=index%2?'dark':'light';
    await page.evaluate(({language,theme})=>window.nodus.updateSettings({uiLanguage:language,theme}),{language,theme});
    await page.getByRole('tab',{name:signText(language,'Certificados'),exact:true}).waitFor();
    await page.getByRole('tab',{name:signText(language,'Certificados'),exact:true}).click();
    await page.getByRole('combobox',{name:signText(language,'Páginas de la firma'),exact:true}).selectOption('custom');
    await page.getByRole('textbox',{name:signText(language,'Páginas o intervalos'),exact:true}).fill('1, 3');
    await openPrecise();
    await page.getByRole('spinbutton',{name:signText(language,'Ancho de firma')+' (%)',exact:true}).scrollIntoViewIfNeeded();
    assert.ok(await page.getByText(signText(language,'Se aplicará una firma criptográfica por página seleccionada, conservando las anteriores mediante actualizaciones incrementales.'),{exact:true}).isVisible());
    assert.equal(await page.locator('.sign-workspace').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,language+' workspace overflow');
    // The hero glow overflows its box; the hero must never scroll it into view.
    assert.equal(await page.locator('.toolkit-hero').evaluate(el=>el.scrollLeft),0,language+' hero shifted');
    await shot('locale-'+language+'-placement-'+theme+'.png');
    await page.getByRole('tab',{name:signText(language,'Manuscritas'),exact:true}).click();
    await page.evaluate(({theme})=>window.nodus.updateSettings({theme}),{theme:theme==='light'?'dark':'light'});
    if (await page.locator('.backup-health-dismiss').isVisible()) await page.locator('.backup-health-dismiss').click();
    await page.getByTestId('sign-create').click();
    await page.getByRole('heading',{name:signText(language,'Crear firma manuscrita'),exact:true}).waitFor();
    assert.equal(await page.locator('.sign-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,language+' editor overflow');
    await shot('locale-'+language+'-editor.png');
    await page.locator('.sign-dialog footer').getByRole('button',{name:signText(language,'Cancelar'),exact:true}).click();
    report.checks.push('Real Electron locale layout: '+language+'; certificate placement and drawing editor; light/dark; no horizontal overflow');
  }
  // Changing UI language also refreshes localized stamp text/date and revokes authorization.
  await page.getByRole('tab',{name:signText('ko','Certificados'),exact:true}).click();
  const beforeLanguage=await page.getByTestId('sign-crypto-placement').locator('img').getAttribute('src');
  await page.evaluate(()=>window.nodus.updateSettings({uiLanguage:'en',theme:'light'}));
  await page.getByRole('tab',{name:'Certificates',exact:true}).waitFor();
  await page.waitForFunction(before=>document.querySelector('[data-testid="sign-crypto-placement"] img')?.getAttribute('src')!==before,beforeLanguage);
  report.checks.push('Certificate appearance regenerates when UI language changes');
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  // Independent Poppler rendering and byte-level validation are separate from pdfjs.
  execFileSync("pdftoppm", [
    "-scale-to",
    "1000",
    "-png",
    exported,
    path.join(out, "visual-reopened"),
  ]);
  execFileSync("pdftoppm", [
    "-scale-to",
    "1000",
    "-png",
    signedExport,
    path.join(out, "certificate-reopened"),
  ]);
  const pdfsig=execFileSync('pdfsig',[signedExport],{encoding:'utf8'});
  fs.writeFileSync(path.join(out,'poppler-signature-validation.txt'),pdfsig.split(signedExport).join(path.basename(signedExport)));
  assert.equal((pdfsig.match(/Signature is Valid/g)||[]).length,2);
  report.checks.push('Independent Poppler validates both real cryptographic signatures');
  report.checks.push(
    "Exported PDFs reopened and rendered by independent Poppler viewer",
  );
} catch (e) {
  if (page) {
    await page
      .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
      .catch(() => {});
    report.visibleText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
  }
  report.failure = e.stack;
  throw e;
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  if (app) {
    const closeTimeout = setTimeout(() => app.process().kill("SIGKILL"), 5000);
    await app.close().catch(() => {});
    clearTimeout(closeTimeout);
  }
  fs.rmSync(profile, { recursive: true, force: true });
}
