// Browser entry for the PayStage "Try it" widget. Mounts into #try-it-root.
import {
  NETWORKS,
  PRESETS,
  createBrowserSigner,
  runPaidEvaluate,
} from "./pay.js";

const CHAIN_PARAMS = {
  [NETWORKS.sepolia.chainId]: {
    chainId: "0x" + NETWORKS.sepolia.chainId.toString(16),
    chainName: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia.base.org"],
    blockExplorerUrls: [NETWORKS.sepolia.explorer],
  },
  [NETWORKS.mainnet.chainId]: {
    chainId: "0x" + NETWORKS.mainnet.chainId.toString(16),
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: [NETWORKS.mainnet.explorer],
  },
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "hidden") node.hidden = !!v;
    else if (v != null) node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

async function ensureChain(ethereum, chainId) {
  const hex = "0x" + chainId.toString(16);
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex }],
    });
  } catch (err) {
    if (err && (err.code === 4902 || err.code === -32603)) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [CHAIN_PARAMS[chainId]],
      });
    } else {
      throw err;
    }
  }
}

function friendlyError(err, net) {
  if (!err) return "Unknown error";
  const code = err.code ?? err?.cause?.code;
  const msg = String(err.message || err);
  if (code === 4001 || /user rejected/i.test(msg)) {
    return "Signature rejected in wallet.";
  }
  if (/no (eip-1193 )?wallet|provider|ethereum/i.test(msg)) {
    return "No wallet detected. Install MetaMask or Coinbase Wallet to continue.";
  }
  if (/chain|network/i.test(msg)) {
    return `Wrong chain. Switch to ${net.label} and retry.`;
  }
  if (/insufficient|funds|balance/i.test(msg)) {
    const hint = net.faucet ? ` Get test USDC: ${net.faucet}` : "";
    return `Insufficient USDC.${hint}`;
  }
  return msg;
}

function mount(root) {
  root.innerHTML = "";

  const presetSelect = el("select", { id: "try-it-preset", class: "try-it-select" });
  for (const [key, preset] of Object.entries(PRESETS)) {
    presetSelect.append(
      el("option", { value: key, text: `${preset.label} — expect: ${preset.expect}` }),
    );
  }

  const networkSelect = el("select", { id: "try-it-network", class: "try-it-select" });
  networkSelect.append(
    el("option", { value: "sepolia", text: "Base Sepolia (test USDC)" }),
    el("option", { value: "mainnet", text: "Base mainnet — real USDC" }),
  );

  const warning = el("p", {
    class: "try-it-warning",
    role: "status",
    text: "Mainnet costs $0.002 real USDC per call.",
    hidden: true,
  });

  const bodyArea = el("textarea", {
    id: "try-it-body",
    class: "try-it-textarea",
    rows: "12",
    spellcheck: "false",
  });

  const runBtn = el("button", {
    type: "button",
    class: "try-it-run",
    text: "Connect wallet & run",
  });

  const status = el("p", { class: "try-it-status", role: "status", "data-state": "idle" });
  const output = el("pre", { class: "try-it-output" });
  const txWrap = el("p", { class: "try-it-tx" });

  function fillPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    bodyArea.value = JSON.stringify(preset.body, null, 2);
  }

  presetSelect.addEventListener("change", () => fillPreset(presetSelect.value));
  networkSelect.addEventListener("change", () => {
    warning.hidden = networkSelect.value !== "mainnet";
  });
  fillPreset("small_pay");

  runBtn.addEventListener("click", async () => {
    output.textContent = "";
    txWrap.textContent = "";
    const ethereum = window.ethereum;
    if (!ethereum) {
      status.dataset.state = "error";
      status.textContent = friendlyError(new Error("no wallet"), NETWORKS.sepolia);
      return;
    }

    let body;
    try {
      body = JSON.parse(bodyArea.value);
    } catch {
      status.dataset.state = "error";
      status.textContent = "Body is not valid JSON.";
      return;
    }

    const net = NETWORKS[networkSelect.value];
    runBtn.disabled = true;
    try {
      status.dataset.state = "pending";
      status.textContent = "Requesting account…";
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      const address = accounts && accounts[0];
      if (!address) throw new Error("No account returned by wallet");

      status.textContent = `Switching to ${net.label}…`;
      await ensureChain(ethereum, net.chainId);

      const signer = createBrowserSigner(ethereum, address);
      status.textContent = "Requesting payment signature…";

      const result = await runPaidEvaluate({
        fetchImpl: window.fetch.bind(window),
        signer,
        baseUrl: net.api,
        networkCaip: net.id,
        body,
      });

      status.dataset.state = result.status === 200 ? "ok" : "error";
      status.textContent = `HTTP ${result.status}${
        result.decision ? ` — decision: ${result.decision}` : ""
      }`;
      output.textContent = JSON.stringify(result.raw, null, 2);

      if (result.txUrl) {
        const link = el("a", {
          href: result.txUrl,
          target: "_blank",
          rel: "noopener noreferrer",
          class: "try-it-tx-link",
          text: "View settlement on explorer",
        });
        txWrap.append(link);
      }
    } catch (err) {
      status.dataset.state = "error";
      status.textContent = friendlyError(err, net);
    } finally {
      runBtn.disabled = false;
    }
  });

  root.append(
    el("div", { class: "try-it-panel" }, [
      el("div", { class: "try-it-controls" }, [
        el("label", { class: "try-it-field" }, [
          el("span", { text: "Preset" }),
          presetSelect,
        ]),
        el("label", { class: "try-it-field" }, [
          el("span", { text: "Network" }),
          networkSelect,
        ]),
      ]),
      warning,
      el("label", { class: "try-it-field try-it-field-wide" }, [
        el("span", { text: "Request body (evaluate_mcp_payment)" }),
        bodyArea,
      ]),
      el("div", { class: "try-it-actions" }, [runBtn]),
      status,
      txWrap,
      output,
    ]),
  );
}

function boot() {
  const root = document.getElementById("try-it-root");
  if (root) mount(root);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
