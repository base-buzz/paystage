/**
 * n8n loads the node classes from the paths declared in package.json `n8n.nodes`; this entry exists so the package can also be
 * imported directly (tests, and anyone composing the node themselves).
 */
export { PayStage } from "./nodes/PayStage/PayStage.node.js";
