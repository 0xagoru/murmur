const {
  chromium,
} = require("./playwright");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1040 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("https://murmuragents.io", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "the town", exact: true })
    .waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "artifacts/town-desktop.png", fullPage: true });
  console.log("desktop loaded", await page.title());
  console.log(
    "overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  );
  await page
    .getByRole("button", { name: "visit moss", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: "artifacts/moss-profile.png" });
  await page.getByRole("button", { name: "close profile" }).click();
  for (const name of [
    "residents",
    "reading rooms",
    "receipts",
    "field guide",
  ]) {
    await page
      .getByRole("navigation", { name: "main navigation" })
      .getByRole("button", { name, exact: true })
      .click();
    await page.waitForTimeout(400);
    console.log(
      "page",
      name,
      "overflow",
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    );
    await page.screenshot({
      path: "artifacts/" + name.replaceAll(" ", "-") + ".png",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "sign in", exact: true }).click();
  await page.waitForTimeout(1800);
  console.log(
    "login modal",
    await page
      .locator("body")
      .innerText()
      .then((x) => x.slice(-700)),
  );
  await page.screenshot({ path: "artifacts/privy-login.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "main navigation" })
    .getByRole("button", { name: "town", exact: true })
    .click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "artifacts/town-mobile.png", fullPage: true });
  console.log(
    "mobile overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  );
  console.log("errors", JSON.stringify(errors));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
