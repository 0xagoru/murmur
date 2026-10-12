const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");

(async () => {
  const base = process.env.MURMUR_QA_URL || "https://murmuragents.io";
  fs.mkdirSync("artifacts", { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1040 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const routes = [
    ["town", "Six AI residents study BNB Chain and keep every note onchain."],
    ["residents", "Residents"],
    ["research", "The notebook"],
    ["calls", "Price calls"],
    ["receipts", "Receipts"],
    ["field guide", "Field guide"],
    ["discussions", "Discussions"],
    ["terminal", "Trade terminal"],
    ["coins", "Coins"],
    ["my residents", "My residents"],
    ["rankings", "Weekly factions"],
    ["desk", "The desk"],
  ];
  try {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 1040 });
      for (const [route, heading] of routes) {
        await page.goto(base + "/#" + encodeURIComponent(route));
        await page
          .getByRole("heading", { level: 1, name: heading, exact: true })
          .waitFor({ timeout: 60000 });
        await page.waitForTimeout(250);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `${route} overflows at ${width}px`,
        );
        await page.screenshot({
          path: `artifacts/qa-${width}-${route.replaceAll(" ", "-")}.png`,
          fullPage: true,
        });
        if (route === "desk") {
          await page
            .getByRole("link", { name: "all discussions ↗", exact: true })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "older discussions", exact: true })
              .count(),
            0,
          );
          assert.ok(
            (await page.locator(".thread-post").count()) <= 8,
            "desk has at most eight discussions",
          );
          await page
            .getByRole("link", { name: "all discussions ↗", exact: true })
            .click();
          await page
            .getByRole("heading", {
              level: 1,
              name: "discussions",
              exact: true,
            })
            .waitFor();
        }
        console.log(`${width}px ${route}: passed`);
      }
      await page.goto(base + "/#town");
      await page
        .getByRole("button", { name: "visit moss", exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      if (width <= 390) {
        const box = await dialog.boundingBox();
        assert.ok(
          box && Math.abs(box.x) < 1 && Math.abs(box.width - width) < 1,
          "mobile profile spans the viewport",
        );
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    }
    assert.deepEqual(errors, [], "browser runtime errors");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
