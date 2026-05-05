const puppeteer = require('puppeteer-core');
const fs        = require('fs');
const path      = require('path');
const { execSync } = require('child_process');

const CHROME  = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTML    = path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const FRAMES  = path.join(__dirname, '_frames');
const OUTPUT  = path.join(__dirname, 'presentation_te.mp4');
const W = 1440, H = 810;

const SLIDE_DURATIONS = [6000,6000,6000,10000,7000,7000,7000,7000,7000,7000,8000];
const TOTAL_MS = SLIDE_DURATIONS.reduce((a,b)=>a+b,0) + 3000;

async function main() {
  if (fs.existsSync(FRAMES)) fs.rmSync(FRAMES, { recursive: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  console.log('Launching Chrome...');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      `--window-size=${W},${H}`,
      '--no-sandbox',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    defaultViewport: { width: W, height: H },
  });

  const page = await browser.newPage();
  await page.goto(`file:///${HTML}`, { waitUntil: 'networkidle0' });

  // Switch to Telugu before recording starts
  await page.evaluate(() => switchLang('te'));
  // Small pause so the first slide renders in Telugu before screencast begins
  await new Promise(r => setTimeout(r, 400));

  const client = await page.createCDPSession();

  let frameCount = 0;
  const timestamps = [];

  client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = path.join(FRAMES, `f${String(frameCount).padStart(6,'0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    timestamps.push(metadata.timestamp);
    frameCount++;
    await client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (frameCount % 30 === 0) {
      process.stdout.write(`\r  Captured ${frameCount} frames (~${(frameCount / 30).toFixed(1)}s)`);
    }
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    maxWidth: W,
    maxHeight: H,
    everyNthFrame: 2,
  });

  console.log(`Recording ${(TOTAL_MS/1000).toFixed(0)}s presentation...`);
  await new Promise(r => setTimeout(r, TOTAL_MS));

  await client.send('Page.stopScreencast');
  await browser.close();
  console.log(`\n  Total frames captured: ${frameCount}`);

  if (frameCount === 0) {
    console.error('No frames captured — aborting.');
    process.exit(1);
  }

  // Build ffconcat file with real per-frame durations from timestamps
  let concat = 'ffconcat version 1.0\n';
  for (let i = 0; i < frameCount; i++) {
    const dur = i < frameCount - 1
      ? (timestamps[i + 1] - timestamps[i]).toFixed(6)
      : '0.033333';
    concat += `file 'f${String(i).padStart(6,'0')}.jpg'\nduration ${dur}\n`;
  }
  const concatFile = path.join(FRAMES, 'concat.txt');
  fs.writeFileSync(concatFile, concat);

  console.log('Encoding MP4 with ffmpeg...');
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" ` +
    `-vf "scale=${W}:${H}:flags=lanczos" ` +
    `-c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow "${OUTPUT}"`,
    { stdio: 'inherit' }
  );

  fs.rmSync(FRAMES, { recursive: true });
  console.log(`\nDone!  →  ${OUTPUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
