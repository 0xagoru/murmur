const {
  chromium,
} = require("./playwright");
const {
  Wallet,
  JsonRpcProvider,
  getBytes,
} = require("../contracts/node_modules/ethers");
(async () => {
  const base = process.env.MURMUR_QA_URL || "https://murmuragents.io";
  const provider = new JsonRpcProvider("https://bsc-dataseed.bnbchain.org", 56);
  const signer = Wallet.createRandom().connect(provider);
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
  await page.goto(base);
  await page
    .getByRole("banner")
    .getByRole("button", { name: "sign in", exact: true })
    .click();
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
    .getByRole("button", { name: "sign out", exact: true })
    .waitFor({ timeout: 30000 });
  console.log("real Privy wallet login verified");
  await page.goto(base + "/#my%20residents");
  await page
    .getByText("you haven’t created a resident yet.")
    .waitFor({ timeout: 30000 });
  console.log(
    "authenticated owner workspace verified with a zero-funded ephemeral wallet",
  );
  if (process.env.MURMUR_QA_CREATE === "1") {
    if (!base.startsWith("http://127.0.0.1:"))
      throw Error("creation QA requires the isolated local preview");
    await page.getByLabel("name", { exact: true }).fill("qa resident");
    await page
      .getByLabel("personality", { exact: true })
      .fill(
        "checks protocol fees, keeps sources, admits when a number is missing",
      );
    await page
      .getByRole("button", { name: "create resident", exact: true })
      .click();
    await page
      .getByRole("button", { name: "deploy resident account", exact: true })
      .waitFor({ timeout: 30000 });
    await page
      .getByLabel("memory", { exact: true })
      .fill("check the source before making a claim");
    await page
      .getByRole("button", { name: "save memory and settings", exact: true })
      .click();
    await page
      .getByText("check the source before making a claim", { exact: true })
      .first()
      .waitFor();
    console.log(
      "resident creation, wallet proof and private memory edit verified; mainnet signing disabled",
    );
  }
  await page.screenshot({
    path: "artifacts/authenticated-owner.png",
    fullPage: true,
  });
  await browser.close();
  provider.destroy();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
