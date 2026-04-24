const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, firefox } = require('playwright');

const BASE_URL = process.env.DEMO_BASE_URL || 'http://127.0.0.1:8080';
const AUTH_TOKEN = process.env.DEMO_AUTH_TOKEN || '';
const OUT_DIR = process.env.DEMO_OUT_DIR || 'docs/assets/demo';
const BROWSER = (process.env.DEMO_BROWSER || 'chromium').toLowerCase();
const FRAMES_DIR = path.join(OUT_DIR, 'frames');

async function ensureCleanDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await ensureCleanDir(FRAMES_DIR);

  const launcher = BROWSER === 'firefox' ? firefox : chromium;
  const launchOptions = { headless: true };
  if (BROWSER === 'firefox' && process.env.FIREFOX_PATH) {
    launchOptions.executablePath = process.env.FIREFOX_PATH;
  }
  const browser = await launcher.launch(launchOptions);

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  let frame = 1;

  const shot = async (label, waitMs = 1200) => {
    if (waitMs > 0) await page.waitForTimeout(waitMs);
    const file = path.join(FRAMES_DIR, `${String(frame).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: file, fullPage: false });
    frame += 1;
  };

  await page.goto(`${BASE_URL}/status`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await shot('status-overview', 1800);

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await shot('dashboard-entry', 1800);

  if (AUTH_TOKEN) {
    await page.goto(`${BASE_URL}/?token=${encodeURIComponent(AUTH_TOKEN)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await shot('overview-auth', 2800);

    const eventsPanel = page.locator('#ph-events');
    if ((await eventsPanel.count()) > 0) {
      await eventsPanel.first().click();
      await shot('incidents-drawer', 1800);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }

    const finopsPanel = page.locator('#ph-finops');
    if ((await finopsPanel.count()) > 0) {
      await finopsPanel.first().click();
      await shot('finops-drawer', 1800);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }

    await page.goto(`${BASE_URL}/status`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await shot('status-final', 1200);
  }

  await context.close();
  await browser.close();

  process.stdout.write(`FRAMES_DIR=${FRAMES_DIR}\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
