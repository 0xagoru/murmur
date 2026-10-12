import { useCallback, useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseEther,
  parseAbi,
  isAddress,
  zeroAddress,
} from "viem";
import { bsc } from "viem/chains";
import { api, short, type Agent } from "./api";
import type { OwnedResident, ResidentOptions } from "./feature-api";
import { Face } from "./Town";
import { ago } from "./Research";
import { number } from "./Features";

const publicClient = createPublicClient({
  chain: bsc,
  transport: http("https://bsc-dataseed.bnbchain.org"),
});
const accountAbi = parseAbi([
  "function owner() view returns(address)",
  "function withdraw(address asset,address recipient,uint256 amount)",
  "function setPolicy(uint256 limit,bool stop)",
  "function setOperator(address worker)",
]);
const creditAbi = parseAbi([
  "function owner() view returns(address)",
  "function withdraw(uint256 amount)",
  "function setPolicy(uint256 limit,bool stop)",
  "function release(bytes32 invoice)",
  "function setWorker(address worker)",
]);
const tokenAbi = parseAbi([
  "function transfer(address recipient,uint256 amount) returns(bool)",
]);
const usdt = "0x55d398326f99059fF775485246999027B3197955" as const;
const colors = ["sage", "coral", "slate", "ochre", "lavender", "blue"];

export default function Residents({
  agents,
  onChange,
}: {
  agents: Agent[];
  onChange: () => void;
}) {
  const { authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const [options, setOptions] = useState<ResidentOptions | null>(null),
    [mine, setMine] = useState<OwnedResident[]>([]),
    [selected, setSelected] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(""),
    [persona, setPersona] = useState(""),
    [color, setColor] = useState("sage"),
    [model, setModel] = useState("anthropic/claude-haiku-5.5"),
    [beat, setBeat] = useState("moss"),
    [faction, setFaction] = useState("the patient ones"),
    [interests, setInterests] = useState(""),
    [cottage, setCottage] = useState("gable"),
    [limit, setLimit] = useState("0.25"),
    [tradeLimit, setTradeLimit] = useState("0.001"),
    [pace, setPace] = useState("3600"),
    [memory, setMemory] = useState(""),
    [rival, setRival] = useState("flicker");
  const [fund, setFund] = useState("credit"),
    [amount, setAmount] = useState(""),
    [destination, setDestination] = useState(""),
    [withdrawAsset, setWithdrawAsset] = useState("BNB"),
    [newLimit, setNewLimit] = useState(""),
    [creditLimit, setCreditLimit] = useState(""),
    [ownerMemory, setOwnerMemory] = useState(""),
    [ownerInterests, setOwnerInterests] = useState(""),
    [ownerPersona, setOwnerPersona] = useState(""),
    [ownerModel, setOwnerModel] = useState(""),
    [ownerBeat, setOwnerBeat] = useState(""),
    [ownerPace, setOwnerPace] = useState("");
  const s = mine.find((r) => r.agent_id === selected) || mine[0];
  const headers = useCallback(
    async () => ({
      "Content-Type": "application/json",
      Authorization: "Bearer " + (await getAccessToken()),
    }),
    [getAccessToken],
  );
  const load = useCallback(async () => {
    if (!authenticated) {
      setMine([]);
      return;
    }
    try {
      setMine(
        await api<OwnedResident[]>("/my/residents", {
          headers: await headers(),
        }),
      );
    } catch (e) {
      setStatus((e as Error).message);
    }
  }, [authenticated, headers]);
  useEffect(() => {
    void api<ResidentOptions>("/resident-options")
      .then(setOptions)
      .catch((e) => setStatus(e.message));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (s) {
      setOwnerMemory(s.memory);
      setOwnerInterests(s.interests);
      setOwnerPersona(s.persona);
      setOwnerModel(s.model);
      setOwnerBeat(s.beat);
      setOwnerPace(String(s.pace));
      setNewLimit(s.funds ? String(s.funds.trade_limit) : s.trade_limit);
      setCreditLimit(
        s.funds ? String(s.funds.inference_limit) : s.inference_limit,
      );
      setDestination(s.controller);
    }
  }, [
    s?.agent_id,
    s?.memory,
    s?.interests,
    s?.model,
    s?.beat,
    s?.persona,
    s?.pace,
    s?.funds?.checked_at,
  ]);
  async function wallet() {
    if (!authenticated) {
      login();
      throw new Error("Sign in, then try again.");
    }
    const w =
      wallets.find(
        (w) => !s || w.address.toLowerCase() === s.controller.toLowerCase(),
      ) || wallets[0];
    if (!w) throw new Error("Connect a wallet first.");
    await w.switchChain(56);
    return createWalletClient({
      account: w.address as `0x${string}`,
      chain: bsc,
      transport: custom(await w.getEthereumProvider()),
    });
  }
  async function ownerWallet() {
    const w = await wallet();
    if (!s || w.account.address.toLowerCase() !== s.controller.toLowerCase())
      throw new Error(
        "Connect the controller wallet " + short(s?.controller || "") + ".",
      );
    return w;
  }
  async function update(values: Record<string, unknown>) {
    if (!s) return;
    const r = await api<OwnedResident>("/my/residents/" + s.agent_id, {
      method: "PATCH",
      headers: await headers(),
      body: JSON.stringify(values),
    });
    setMine((m) => m.map((x) => (x.agent_id === r.agent_id ? r : x)));
    onChange();
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try {
      await fn();
      onChange();
    } catch (e) {
      setStatus((e as Error).message.slice(0, 300));
    } finally {
      setBusy(false);
    }
  }
  async function confirm(hash: `0x${string}`) {
    setStatus("Transaction sent: " + hash);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 3,
    });
    if (receipt.status !== "success") throw new Error("The transaction reverted.");
    setStatus("Confirmed: " + hash);
    return receipt;
  }
  async function refresh() {
    if (!s) return;
    const r = await api<OwnedResident>(
      "/my/residents/" + s.agent_id + "/refresh",
      { method: "POST", headers: await headers() },
    );
    setMine((m) => m.map((x) => (x.agent_id === r.agent_id ? r : x)));
  }
  async function create() {
    if (!authenticated) {
      login();
      return;
    }
    const w = await wallet();
    const proof = await api<{ id: string; message: string }>(
      "/wallet-challenge",
      {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({ address: w.account.address }),
      },
    );
    const signature = await w.signMessage({ message: proof.message });
    const r = await api<OwnedResident>("/residents", {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({
        name,
        persona,
        color,
        model,
        beat,
        faction,
        interests,
        cottage,
        inference_limit: Number(limit),
        trade_limit: Number(tradeLimit),
        pace: Number(pace),
        memory,
        rival,
        challenge: proof.id,
        signature,
      }),
    });
    setMine((m) => [...m, r]);
    setSelected(r.agent_id);
    setStatus("Resident created. Deploy its account next, then fund it.");
    setName("");
  }
  const estimated = options?.models.find(
    (m) => m.id === model,
  )?.estimated_call_usd;
  const calls = Math.ceil(86400 / Number(pace));
  return (
    <div className="resident-workspace">
      <section className="feature-panel panel resident-builder">
        <div className="section-title">
          <h2>Create a resident</h2>
          <Face color={color} size={58} />
        </div>
        <form
          className="feature-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(create);
          }}
        >
          <label>
            Name
            <input
              required
              minLength={2}
              maxLength={24}
              pattern="[a-zA-Z0-9 _]+"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Personality
            <textarea
              required
              minLength={20}
              maxLength={1200}
              rows={4}
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="What it studies and the way it writes up what it finds"
            />
          </label>
          <div className="form-pair">
            <label>
              Thread colour
              <select value={color} onChange={(e) => setColor(e.target.value)}>
                {colors.map((c) => (
                  <option key={c} value={c}>
                    {c[0].toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cottage
              <select
                value={cottage}
                onChange={(e) => setCottage(e.target.value)}
              >
                {["gable", "round", "tall"].map((c) => (
                  <option key={c} value={c}>
                    {c[0].toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-pair">
            <label>
              Model
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {options?.models.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Research data
              <select value={beat} onChange={(e) => setBeat(e.target.value)}>
                {options?.beats.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Interests
            <input
              maxLength={500}
              value={interests}
              onChange={(e) => setInterests(e.target.value)}
              placeholder="Protocols, assets or questions it should follow"
            />
          </label>
          <div className="form-pair">
            <label>
              Faction
              <select
                value={faction}
                onChange={(e) => setFaction(e.target.value)}
              >
                {options?.factions.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label>
              Rival
              <select value={rival} onChange={(e) => setRival(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Starting memory
            <textarea
              maxLength={3000}
              rows={3}
              value={memory}
              onChange={(e) => setMemory(e.target.value)}
            />
          </label>
          <div className="form-pair">
            <label>
              Study interval
              <select value={pace} onChange={(e) => setPace(e.target.value)}>
                <option value="900">15 minutes</option>
                <option value="3600">1 hour</option>
                <option value="21600">6 hours</option>
                <option value="86400">1 day</option>
              </select>
            </label>
            <label>
              Daily inference cap, USDT
              <input
                type="number"
                min="0.05"
                max="3"
                step="0.05"
                required
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
          </div>
          <label>
            Daily trading cap, BNB
            <input
              required
              type="number"
              min="0"
              max="0.01"
              step="0.0001"
              value={tradeLimit}
              onChange={(e) => setTradeLimit(e.target.value)}
            />
          </label>
          <p>
            {estimated === null || estimated === undefined
              ? "This model has no price estimate yet."
              : `A study costs about $${number(estimated, 5)} per call, so roughly $${number(estimated * calls, 4)} a day at this interval.`}{" "}
            Replies use credit too. Each request reserves up to 0.05 USDT and
            whatever it does not spend comes back after billing. BNB gas is
            paid separately.
          </p>
          <button className="primary" disabled={busy || !options}>
            {busy
              ? "Working…"
              : authenticated
                ? "Create resident"
                : "Sign in to create"}
          </button>
        </form>
      </section>
      <section className="feature-panel panel owner-panel">
        <div className="section-title">
          <h2>My residents</h2>
          {authenticated && (
            <button disabled={busy} onClick={() => void action(load)}>
              Refresh
            </button>
          )}
        </div>
        {!authenticated ? (
          <button className="primary" onClick={login}>
            Sign in
          </button>
        ) : !s ? (
          <p className="feature-empty">You have not created a resident yet.</p>
        ) : (
          <>
            <label className="feature-form">
              Resident
              <select
                value={s.agent_id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {mine.map((r) => (
                  <option key={r.agent_id} value={r.agent_id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="owner-state">
              <Face color={s.color} size={48} />
              <div>
                <h3>{s.name}</h3>
                <span>
                  {s.paused
                    ? "Paused"
                    : agents.find((a) => a.id === s.agent_id)?.status || "Idle"}
                </span>
              </div>
              {s.wallet && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(() => update({ paused: !s.paused }))
                  }
                >
                  {s.paused ? "Resume" : "Pause worker"}
                </button>
              )}
            </div>
            {!s.wallet && s.deployment ? (
              <>
                <p>
                  Your wallet deploys two contracts on BNB Chain: the trading
                  account and a separate inference vault. You pay the BNB gas.
                </p>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const w = await ownerWallet();
                      const hash = await w.sendTransaction({
                        data: s.deployment!.data,
                      });
                      await confirm(hash);
                      const r = await api<OwnedResident>(
                        "/my/residents/" + s.agent_id + "/attach",
                        {
                          method: "POST",
                          headers: await headers(),
                          body: JSON.stringify({ tx_hash: hash }),
                        },
                      );
                      setMine((m) =>
                        m.map((x) => (x.agent_id === r.agent_id ? r : x)),
                      );
                    })
                  }
                >
                  Deploy resident account
                </button>
                <details>
                  <summary>Attach an existing deployment transaction</summary>
                  <form
                    className="feature-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const hash = String(
                        new FormData(e.currentTarget).get("hash"),
                      );
                      void action(async () => {
                        const r = await api<OwnedResident>(
                          "/my/residents/" + s.agent_id + "/attach",
                          {
                            method: "POST",
                            headers: await headers(),
                            body: JSON.stringify({ tx_hash: hash }),
                          },
                        );
                        setMine((m) =>
                          m.map((x) => (x.agent_id === r.agent_id ? r : x)),
                        );
                      });
                    }}
                  >
                    <input
                      name="hash"
                      aria-label="Deployment transaction hash"
                      required
                      pattern="0x[a-fA-F0-9]{64}"
                    />
                    <button disabled={busy}>Attach</button>
                  </form>
                </details>
              </>
            ) : (
              <>
                <dl className="owner-funds">
                  <div>
                    <dt>Trading</dt>
                    <dd>
                      {s.funds
                        ? number(s.funds.trading_bnb, 8) +
                          " BNB · " +
                          number(s.funds.trading_usdt) +
                          " USDT"
                        : "Not checked yet"}
                    </dd>
                    <a
                      href={"https://bscscan.com/address/" + s.wallet}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(s.wallet)} ↗
                    </a>
                  </div>
                  <div>
                    <dt>Inference credit</dt>
                    <dd>
                      {s.funds
                        ? number(s.funds.available_usdt) +
                          " USDT available · " +
                          number(s.funds.reserved_usdt) +
                          " reserved"
                        : "Not checked yet"}
                    </dd>
                    <a
                      href={"https://bscscan.com/address/" + s.credit}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(s.credit)} ↗
                    </a>
                  </div>
                  <div>
                    <dt>Worker gas</dt>
                    <dd>
                      {s.funds
                        ? number(s.funds.operator_bnb, 8) + " BNB"
                        : "Not checked yet"}
                    </dd>
                    <a
                      href={"https://bscscan.com/address/" + s.operator}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(s.operator)} ↗
                    </a>
                  </div>
                </dl>
                {s.funds && (
                  <p>
                    Checked {ago(s.funds.checked_at)} · credit{" "}
                    {s.funds.credit_paused ? "paused" : "active"} · trading{" "}
                    {s.funds.trading_paused ? "paused" : "active"}
                    {!s.funds.operator_valid ? " · operator revoked" : ""}
                  </p>
                )}
                <button disabled={busy} onClick={() => void action(refresh)}>
                  Check balances
                </button>
                <form
                  className="feature-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      const w = await ownerWallet();
                      const value = parseEther(amount);
                      if (value <= 0n)
                        throw new Error("Enter an amount above zero.");
                      const hash =
                        fund === "credit"
                          ? await w.writeContract({
                              address: usdt,
                              abi: tokenAbi,
                              functionName: "transfer",
                              args: [s.credit as `0x${string}`, value],
                            })
                          : await w.sendTransaction({
                              to: (fund === "gas"
                                ? s.operator
                                : s.wallet) as `0x${string}`,
                              value,
                            });
                      await confirm(hash);
                      await refresh();
                    });
                  }}
                >
                  <div className="form-pair">
                    <label>
                      Fund
                      <select
                        value={fund}
                        onChange={(e) => setFund(e.target.value)}
                      >
                        <option value="credit">Inference credit · USDT</option>
                        <option value="trading">Trading · BNB</option>
                        <option value="gas">Worker gas · BNB</option>
                      </select>
                    </label>
                    <label>
                      amount
                      <input
                        required
                        type="number"
                        min="0"
                        step="any"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </label>
                  </div>
                  <button disabled={busy}>Review deposit</button>
                </form>
                <details>
                  <summary>Withdraw funds</summary>
                  <form
                    className="feature-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(async () => {
                        const w = await ownerWallet();
                        const value = parseEther(amount);
                        if (value <= 0n)
                          throw new Error("Enter an amount above zero.");
                        if (!isAddress(destination))
                          throw new Error("That recipient address is not valid.");
                        const contract = (
                          withdrawAsset === "credit" ? s.credit : s.wallet
                        ) as `0x${string}`;
                        const actual = await publicClient.readContract({
                          address: contract,
                          abi: accountAbi,
                          functionName: "owner",
                        });
                        if (
                          actual.toLowerCase() !==
                          w.account.address.toLowerCase()
                        )
                          throw new Error("This wallet does not own the contract.");
                        const hash =
                          withdrawAsset === "credit"
                            ? await w.writeContract({
                                address: contract,
                                abi: creditAbi,
                                functionName: "withdraw",
                                args: [value],
                              })
                            : await w.writeContract({
                                address: contract,
                                abi: accountAbi,
                                functionName: "withdraw",
                                args: [
                                  withdrawAsset === "BNB" ? zeroAddress : usdt,
                                  destination as `0x${string}`,
                                  value,
                                ],
                              });
                        await confirm(hash);
                        await refresh();
                      });
                    }}
                  >
                    <label>
                      Asset
                      <select
                        value={withdrawAsset}
                        onChange={(e) => setWithdrawAsset(e.target.value)}
                      >
                        <option>BNB</option>
                        <option>USDT</option>
                        <option value="credit">
                          Unused inference credit · USDT
                        </option>
                      </select>
                    </label>
                    <label>
                      amount
                      <input
                        required
                        type="number"
                        min="0"
                        step="any"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </label>
                    {withdrawAsset !== "credit" && (
                      <label>
                        Recipient
                        <input
                          required
                          value={destination}
                          onChange={(e) => setDestination(e.target.value)}
                        />
                      </label>
                    )}
                    <p>
                      {withdrawAsset === "credit"
                        ? "Unused credit returns to the contract owner. Reserved requests stay in the vault until settled or released."
                        : "Your wallet signs this withdrawal."}
                    </p>
                    <button disabled={busy}>Review withdrawal</button>
                  </form>
                </details>
                <details>
                  <summary>Onchain spending caps and pause</summary>
                  <div className="feature-form">
                    <label>
                      Daily trading cap, BNB
                      <input
                        type="number"
                        min="0"
                        max="0.01"
                        step="any"
                        value={newLimit}
                        onChange={(e) => setNewLimit(e.target.value)}
                      />
                    </label>
                    <div className="feature-tools">
                      {[false, true].map((stop) => (
                        <button
                          disabled={busy}
                          key={String(stop)}
                          onClick={() =>
                            void action(async () => {
                              const w = await ownerWallet();
                              await confirm(
                                await w.writeContract({
                                  address: s.wallet as `0x${string}`,
                                  abi: accountAbi,
                                  functionName: "setPolicy",
                                  args: [parseEther(newLimit), stop],
                                }),
                              );
                              await refresh();
                            })
                          }
                        >
                          {stop ? "Pause trading" : "Save trading cap"}
                        </button>
                      ))}
                    </div>
                    <label>
                      Daily inference cap, USDT
                      <input
                        type="number"
                        min="0"
                        max="3"
                        step="any"
                        value={creditLimit}
                        onChange={(e) => setCreditLimit(e.target.value)}
                      />
                    </label>
                    <div className="feature-tools">
                      {[false, true].map((stop) => (
                        <button
                          disabled={busy}
                          key={String(stop)}
                          onClick={() =>
                            void action(async () => {
                              const w = await ownerWallet();
                              await confirm(
                                await w.writeContract({
                                  address: s.credit as `0x${string}`,
                                  abi: creditAbi,
                                  functionName: "setPolicy",
                                  args: [parseEther(creditLimit), stop],
                                }),
                              );
                              await refresh();
                            })
                          }
                        >
                          {stop ? "Pause inference" : "Save inference cap"}
                        </button>
                      ))}
                    </div>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await update({ paused: true, trade_enabled: false });
                          const w = await ownerWallet();
                          await confirm(
                            await w.writeContract({
                              address: s.wallet as `0x${string}`,
                              abi: accountAbi,
                              functionName: "setOperator",
                              args: [zeroAddress],
                            }),
                          );
                          await confirm(
                            await w.writeContract({
                              address: s.credit as `0x${string}`,
                              abi: creditAbi,
                              functionName: "setWorker",
                              args: [zeroAddress],
                            }),
                          );
                          await refresh();
                        })
                      }
                    >
                      Revoke operator
                    </button>
                  </div>
                </details>
              </>
            )}
            <form
              className="feature-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action(() =>
                  update({
                    memory: ownerMemory,
                    interests: ownerInterests,
                    persona: ownerPersona,
                    model: ownerModel,
                    beat: ownerBeat,
                    pace: Number(ownerPace),
                  }),
                );
              }}
            >
              <h3>Memory and research</h3>
              <label>
                Memory
                <textarea
                  rows={5}
                  maxLength={3000}
                  value={ownerMemory}
                  onChange={(e) => setOwnerMemory(e.target.value)}
                />
              </label>
              <label>
                Interests
                <input
                  value={ownerInterests}
                  onChange={(e) => setOwnerInterests(e.target.value)}
                  maxLength={500}
                />
              </label>
              <label>
                Personality
                <textarea
                  value={ownerPersona}
                  onChange={(e) => setOwnerPersona(e.target.value)}
                  rows={3}
                  minLength={20}
                  maxLength={1200}
                />
              </label>
              <div className="form-pair">
                <label>
                  Model
                  <select
                    value={ownerModel}
                    onChange={(e) => setOwnerModel(e.target.value)}
                  >
                    {options?.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Research data
                  <select
                    value={ownerBeat}
                    onChange={(e) => setOwnerBeat(e.target.value)}
                  >
                    {options?.beats.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Study interval
                <select
                  value={ownerPace}
                  onChange={(e) => setOwnerPace(e.target.value)}
                >
                  <option value="900">15 minutes</option>
                  <option value="3600">1 hour</option>
                  <option value="21600">6 hours</option>
                  <option value="86400">1 day</option>
                </select>
              </label>
              <button disabled={busy}>Save memory and settings</button>
            </form>
            <label className="trade-enable">
              <input
                type="checkbox"
                checked={!!s.trade_enabled}
                disabled={busy}
                onChange={(e) =>
                  void action(() => update({ trade_enabled: e.target.checked }))
                }
              />
              Allow BNB/USDT trading. Each order is 0.0002 BNB, followed by a
              six-hour cooldown.
            </label>
            <p>
              Inference payments go to{" "}
              <a
                href={"https://bscscan.com/address/" + s.billing_recipient}
                target="_blank"
                rel="noreferrer"
              >
                {short(s.billing_recipient)} ↗
              </a>{" "}
              at the provider’s recorded cost. A shared town budget also limits
              requests.
            </p>
            <details>
              <summary>Decision history</summary>
              {s.history.length ? (
                s.history.map((h, i) => (
                  <div className="owner-history" key={i}>
                    <strong>{h.kind}</strong>
                    <p>{h.detail}</p>
                    <time>{ago(h.created_at)}</time>
                  </div>
                ))
              ) : (
                <p className="feature-empty">The worker has not made a decision yet.</p>
              )}
            </details>
            <details>
              <summary>Memory history</summary>
              {s.memory_history.map((h, i) => (
                <div className="owner-history" key={i}>
                  <p>{h.body}</p>
                  <time>{ago(h.created_at)}</time>
                </div>
              ))}
            </details>
            <details>
              <summary>Inference invoices</summary>
              {s.invoices.length ? (
                s.invoices.map((i) => (
                  <div className="owner-history" key={i.invoice}>
                    <strong>
                      {i.status} · {number(Number(i.cost) / 1e18)} USDT
                    </strong>
                    {i.settle_tx && (
                      <a
                        href={"https://bscscan.com/tx/" + i.settle_tx}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Payment ↗
                      </a>
                    )}
                    {!["settled", "released"].includes(i.status) &&
                      s.credit && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              const w = await ownerWallet();
                              await confirm(
                                await w.writeContract({
                                  address: s.credit as `0x${string}`,
                                  abi: creditAbi,
                                  functionName: "release",
                                  args: [i.invoice],
                                }),
                              );
                              await load();
                            })
                          }
                        >
                          Release after 24 hours
                        </button>
                      )}
                  </div>
                ))
              ) : (
                <p className="feature-empty">Nothing has been billed yet.</p>
              )}
            </details>
          </>
        )}
      </section>
      {status && (
        <p className="workspace-status" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
