// Browser entry for the PayStage "Try it" widget. Mounts into #try-it-root.
import {
  NETWORKS,
  PRESETS,
  CHAIN_PARAMS,
  createBrowserSigner,
  runPaidEvaluate,
  getWalletChainId,
  ensureWalletChain,
} from "./pay.js";
import { createDebugLog, attachDebugPanel } from "./debug.js";

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
    node.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return node;
}

function friendlyError(err, net) {
  if (!err) return "Unknown error";
  const code = err.code ?? err?.cause?.code;
  const msg = String(err.message || err);
  if (code === 4001 || /user rejected|user denied/i.test(msg)) {
    return "Request rejected in wallet.";
  }
  if (/no (eip-1193 )?wallet|provider|ethereum/i.test(msg)) {
    return "No wallet detected. Install MetaMask or Coinbase Wallet to continue.";
  }
  if (/still on chain|switch|network/i.test(msg)) {
    return msg;
  }
  if (/insufficient|funds|balance/i.test(msg)) {
    const hint = net?.faucet ? ` Get test USDC: ${net.faucet}` : "";
    return `Insufficient USDC.${hint}`;
  }
  if (/bigint|serialize/i.test(msg)) {
    return `Wallet typed-data error: ${msg}`;
  }
  return msg;
}

function mount(root) {
  root.innerHTML = "";

  let walletChainId = null;

  const presetSelect = el("select", {
    id: "try-it-preset",
    class: "try-it-select",
  });
  for (const [key, preset] of Object.entries(PRESETS)) {
    presetSelect.append(
      el("option", {
        value: key,
        text: `${preset.label} — expect: ${preset.expect}`,
      }),
    );
  }

  const networkSelect = el("select", {
    id: "try-it-network",
    class: "try-it-select",
  });
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

  const chainHint = el("p", {
    class: "try-it-chain-hint",
    role: "status",
    text: "Wallet chain: unknown",
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

  const status = el("p", {
    class: "try-it-status",
    role: "status",
    "data-state": "idle",
  });
  const output = el("pre", { class: "try-it-output" });
  const txWrap = el("p", { class: "try-it-tx" });
  const debugRoot = el("div", { class: "try-it-debug-root" });

  function fillPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    bodyArea.value = JSON.stringify(preset.body, null, 2);
  }

  function updateChainHint() {
    const net = NETWORKS[networkSelect.value];
    if (walletChainId == null) {
      chainHint.textContent = `Selected: ${net.label} (${net.chainId}). Wallet chain unknown.`;
      return;
    }
    if (walletChainId === net.chainId) {
      chainHint.textContent = `Wallet on ${net.label} (chain ${walletChainId}).`;
    } else {
      chainHint.textContent = `Wallet on chain ${walletChainId}; selected ${net.label} (${net.chainId}).`;
    }
  }

  presetSelect.addEventListener("change", () => fillPreset(presetSelect.value));
  networkSelect.addEventListener("change", () => {
    warning.hidden = networkSelect.value !== "mainnet";
    updateChainHint();
  });
  fillPreset("small_pay");
  updateChainHint();

  const ethereum = typeof window !== "undefined" ? window.ethereum : null;
  if (ethereum && typeof ethereum.on === "function") {
    ethereum.on("chainChanged", (hex) => {
      walletChainId = Number.parseInt(hex, 16);
      updateChainHint();
      status.dataset.state = "idle";
      status.textContent = `Wallet switched to chain ${walletChainId}.`;
    });
    getWalletChainId(ethereum)
      .then((id) => {
        walletChainId = id;
        updateChainHint();
      })
      .catch(() => {});
  }

  runBtn.addEventListener("click", async () => {
    output.textContent = "";
    txWrap.textContent = "";
    debugRoot.innerHTML = "";
    const debug = createDebugLog();
    attachDebugPanel(debugRoot, debug);
    status.textContent = `Request id: ${debug.requestId}`;

    if (!window.ethereum) {
      status.dataset.state = "error";
      status.textContent = friendlyError(new Error("no wallet"), NETWORKS.sepolia);
      debug.log("error", { message: "no wallet" });
      return;
    }

    let body;
    try {
      body = JSON.parse(bodyArea.value);
    } catch (e) {
      status.dataset.state = "error";
      status.textContent = "Body is not valid JSON.";
      debug.log("error", { message: "invalid JSON", detail: e?.message });
      return;
    }

    const net = NETWORKS[networkSelect.value];
    runBtn.disabled = true;
    try {
      const eth = window.ethereum;
      debug.log("wallet:detected", {
        isMetaMask: !!eth.isMetaMask,
        isCoinbaseWallet: !!eth.isCoinbaseWallet,
        providers: Array.isArray(eth.providers) ? eth.providers.length : undefined,
      });

      status.dataset.state = "pending";
      status.textContent = `Requesting account… (${debug.requestId})`;
      const accounts = await eth.request({
        method: "eth_requestAccounts",
      });
      const address = accounts && accounts[0];
      debug.log("wallet:accounts", {
        count: accounts ? accounts.length : 0,
        address: address ? address.slice(0, 8) + "…" : null,
      });
      if (!address) throw new Error("No account returned by wallet");

      // Chain check BEFORE any signing.
      try {
        walletChainId = await getWalletChainId(window.ethereum);
      } catch {
        walletChainId = null;
      }
      updateChainHint();

      debug.log("wallet:chainId", { chainId: walletChainId });
      debug.log("network:selected", {
        key: networkSelect.value,
        label: net.label,
        api: net.api,
        caip: net.id,
      });

      if (walletChainId !== net.chainId) {
        status.textContent = `Your wallet is on chain ${
          walletChainId ?? "unknown"
        }. Switch to ${net.label}?`;
        debug.log("wallet:switch_prompt", {
          from: walletChainId,
          to: net.chainId,
        });
        const sw = await ensureWalletChain(
          window.ethereum,
          net.chainId,
          CHAIN_PARAMS[net.chainId],
        );
        debug.log("wallet:switch_result", sw);
        walletChainId = await getWalletChainId(window.ethereum);
        updateChainHint();
        if (walletChainId !== net.chainId) {
          throw new Error(
            `Wallet is still on chain ${walletChainId}; expected ${net.chainId}.`,
          );
        }
      }

      const signer = createBrowserSigner(window.ethereum, address);
      status.textContent = `Requesting payment signature… (${debug.requestId})`;
      debug.log("sign:requested", { address: address.slice(0, 8) + "…" });

      const result = await runPaidEvaluate({
        fetchImpl: window.fetch.bind(window),
        signer,
        baseUrl: net.api,
        networkCaip: net.id,
        body,
        debug,
        requestId: debug.requestId,
      });

      status.dataset.state = result.status === 200 ? "ok" : "error";
      status.textContent = `HTTP ${result.status}${
        result.decision ? ` — decision: ${result.decision}` : ""
      }`;
      output.textContent = JSON.stringify(result.raw, null, 2);

      if (result.txUrl) {
        txWrap.append(
          el("a", {
            href: result.txUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            class: "try-it-tx-link",
            text: "View settlement on explorer",
          }),
        );
      }
    } catch (err) {
      status.dataset.state = "error";
      status.textContent = friendlyError(err, net);
      debug.log("error", {
        name: err?.name,
        message: err?.message,
        code: err?.code,
        stack: err?.stack ? String(err.stack).slice(0, 800) : undefined,
      });
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
      chainHint,
      el("label", { class: "try-it-field try-it-field-wide" }, [
        el("span", { text: "Request body (evaluate_mcp_payment)" }),
        bodyArea,
      ]),
      el("div", { class: "try-it-actions" }, [runBtn]),
      status,
      txWrap,
      output,
      debugRoot,
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
