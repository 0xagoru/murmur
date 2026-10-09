const fs = require("fs");
const {
  chromium,
} = require("./playwright");
const {
  Wallet,
  JsonRpcProvider,
  getBytes,
} = require("../contracts/node_modules/ethers");
(async () => {
  const key = JSON.parse(
    fs.readFileSync(".secrets/operators.json", "utf8"),
  ).vale;
  const provider = new JsonRpcProvider("https://bsc-dataseed.bnbchain.org", 56);
  const signer = new Wallet(key.private_key, provider);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.exposeFunction(
    "__validationRequest",
    async ({ method, params = [] }) => {
      if (["eth_accounts", "eth_requestAccounts"].includes(method))
        return [signer.address];
      if (method === "eth_chainId") return "0x38";
      if (method === "net_version") return "56";
      if (method === "personal_sign") {
        const text = params[0];
        if (typeof text !== "string") throw Error("invalid challenge");
        return signer.signMessage(
          text.startsWith("0x") ? getBytes(text) : text,
        );
      }
      if (method === "wallet_switchEthereumChain") {
        if (params[0].chainId !== "0x38") throw Error("BNB only");
        return null;
      }
      if (
        method === "wallet_requestPermissions" ||
        method === "wallet_getPermissions"
      )
        return [{ parentCapability: "eth_accounts" }];
      if (method === "eth_sendTransaction")
        throw Error(
          "validation authentication signer cannot send transactions",
        );
      if (method === "eth_sign" || method === "eth_signTypedData_v4")
        throw Error("unsupported signature");
      return provider.send(method, params);
    },
  );
  await page.addInitScript(() => {
    const listeners = {};
    const eth = {
      isMetaMask: true,
      selectedAddress: null,
      chainId: "0x38",
      request: (args) => window.__validationRequest(args),
      on: (n, f) => {
        (listeners[n] ??= []).push(f);
      },
      removeListener: (n, f) => {
        listeners[n] = (listeners[n] || []).filter((x) => x !== f);
      },
      removeAllListeners: () => {},
      _metamask: { isUnlocked: async () => true },
    };
    Object.defineProperty(window, "ethereum", { value: eth, writable: false });
    const detail = {
      info: {
        uuid: "3b129c8b-82b0-4d62-a26e-756163131d04",
        name: "Murmur validation wallet",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMjk0YzNmIi8+PC9zdmc+",
        rdns: "io.murmuragents.validation",
      },
      provider: eth,
    };
    window.addEventListener("eip6963:requestProvider", () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail }),
      ),
    );
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", { detail }),
    );
  });
  await page.goto("https://murmuragents.io");
  await page.getByRole("button", { name: "come on in" }).click();
  await page.getByText("Continue with a wallet", { exact: true }).click();
  await page.waitForTimeout(800);
  console.log(
    "wallet options",
    await page
      .getByRole("dialog")
      .innerText()
      .catch(() => page.locator("body").innerText())
      .then((t) => t.slice(-700)),
  );
  await page
    .getByText("Murmur validation wallet", { exact: false })
    .first()
    .click();
  await page
    .getByRole("button", { name: /signed in/ })
    .waitFor({ timeout: 30000 });
  console.log("real Privy wallet login verified");
  await page
    .locator("#composer")
    .fill(
      "validation question: how do you separate wallet funding from trading profit, and where can i inspect the receipts?",
    );
  await page.getByRole("button", { name: "post thought", exact: true }).click();
  await page.locator("#composer").waitFor();
  await page.waitForTimeout(1200);
  const error = await page.locator(".error-banner").count();
  if (error) throw Error("authenticated post rejected");
  console.log("authenticated board post accepted");
  await page.screenshot({
    path: "artifacts/authenticated-board.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "main navigation" })
    .getByRole("button", { name: "reading rooms", exact: true })
    .click();
  await page.getByRole("button", { name: "pip garden · PIP" }).click();
  await page.getByRole("spinbutton", { name: "BNB amount" }).fill("0.00001");
  await page.waitForTimeout(700);
  console.log(
    "live signed-in quote visible",
    await page
      .locator(".launch-state")
      .innerText()
      .then((t) => t.slice(0, 250)),
  );
  await browser.close();
  provider.destroy();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
