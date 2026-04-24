const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, firefox } = require('playwright');

const BASE_URL = process.env.DEMO_BASE_URL || 'http://127.0.0.1:8080';
const AUTH_TOKEN = process.env.DEMO_AUTH_TOKEN || '';
const OUT_DIR = process.env.DEMO_OUT_DIR || 'docs/assets/demo';
const BROWSER = (process.env.DEMO_BROWSER || 'chromium').toLowerCase();
const VIEWPORT_WIDTH = Number(process.env.DEMO_VIEWPORT_WIDTH || '1920');
const VIEWPORT_HEIGHT = Number(process.env.DEMO_VIEWPORT_HEIGHT || '900');
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

  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }
  });
  const page = await context.newPage();
  let frame = 1;

  const shot = async (label, waitMs = 1200) => {
    if (waitMs > 0) await page.waitForTimeout(waitMs);
    const file = path.join(FRAMES_DIR, `${String(frame).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: file, fullPage: false });
    frame += 1;
  };

  const closeDrawer = async () => {
    const closeBtn = page.locator('#drawer-close');
    if ((await closeBtn.count()) > 0) {
      await closeBtn.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(700);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  };

  const openDrawerAndShot = async (selector, labelBase) => {
    const el = page.locator(selector);
    if ((await el.count()) === 0) return;
    await shot(`${labelBase}-before`, 200);
    await el.first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(250);
    await shot(`${labelBase}-opening`, 0);
    await page.waitForTimeout(1200);
    await shot(`${labelBase}-open`, 200);
    await closeDrawer();
  };

  if (AUTH_TOKEN) {
    await page.goto(`${BASE_URL}/?token=${encodeURIComponent(AUTH_TOKEN)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot('01-overview-main', 900);

    await openDrawerAndShot('#kNodesCard', '02-kpi-nodes-drawer');
    await openDrawerAndShot('#kWasteCard', '03-kpi-waste-drawer');
    await openDrawerAndShot('#kCpuCard', '04-kpi-cpu-drawer');
    await openDrawerAndShot('#kMemCard', '05-kpi-memory-drawer');
    await openDrawerAndShot('#ph-events', '06-incidents-expand-drawer');

    const effTab = page.locator('#eff-tab-btn');
    if ((await effTab.count()) > 0) {
      await shot('07-finops-before-efficiency', 300);
      await effTab.first().click({ timeout: 3000 }).catch(() => {});
      await shot('08-efficiency-view', 1400);
      const finopsTab = page.locator('#fino-tab-btn');
      if ((await finopsTab.count()) > 0) {
        await finopsTab.first().click({ timeout: 3000 }).catch(() => {});
        await shot('09-finops-view-return', 900);
      }
    }

    await openDrawerAndShot('#ph-finops', '10-finops-expand-drawer');

    await page.goto(`${BASE_URL}/status`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await shot('11-status-page', 1000);
    await page.goto(`${BASE_URL}/?token=${encodeURIComponent(AUTH_TOKEN)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await shot('12-overview-final', 800);
  } else {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await shot('01-dashboard-entry-no-token', 1800);
  }

  await context.close();
  await browser.close();

  process.stdout.write(`FRAMES_DIR=${FRAMES_DIR}\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
