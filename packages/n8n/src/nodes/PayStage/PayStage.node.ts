import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

/**
 * PayStage for n8n: two operations, no credentials.
 *
 * The node calls the **hosted** endpoint, so a workflow gets the same gate an agent does without holding a key, a wallet or a
 * policy file. Two rules from the rest of the project carry over:
 *
 *  - the verdict is returned as-is — `pay`, `review` or `do_not_pay` — with the reasons that produced it. The node does not
 *    translate a refusal into an error, because a workflow usually wants to branch on it rather than fail;
 *  - a network failure is reported as `unverifiable`, never as `pay`. A gate that fails open is not a gate.
 *
 * **Verification is deliberately not an operation here.** Receipt checks belong on the caller's machine — that is the point of
 * a signed receipt, and a hosted verify endpoint would mean trusting the same server that issued it. The `@paystage/mcp`
 * package ships `paystage-verify` and a `verify_receipt` tool for that, both offline.
 */
export class PayStage implements INodeType {
  description: INodeTypeDescription = {
    displayName: "PayStage",
    name: "payStage",
    group: ["transform"],
    version: 1,
    description: "Check an x402 payment before your workflow signs it, or verify a receipt it received",
    defaults: { name: "PayStage" },
    inputs: ["main"],
    outputs: ["main"],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Evaluate a Payment",
            value: "evaluate",
            description: "Return pay, review or do_not_pay for a proposed x402 payment",
            action: "Evaluate a payment",
          },
        ],
        default: "evaluate",
      },
      {
        displayName: "Payment Required (JSON)",
        name: "paymentRequired",
        type: "json",
        displayOptions: { show: { operation: ["evaluate"] } },
        default: "{}",
        description:
          "The decoded 402 challenge — the object the seller returned under accepts, or the whole x402 challenge body",
        required: true,
      },
      {
        displayName: "Policy (JSON)",
        name: "policy",
        type: "json",
        displayOptions: { show: { operation: ["evaluate"] } },
        default: "{}",
        description:
          "Your spend policy. Leave empty to have the hosted gate use its default policy, which refuses unknown payees",
      },
      {
        displayName: "Base URL",
        name: "baseUrl",
        type: "string",
        default: "https://api.paystage.xyz",
        description: "The hosted PayStage API. Change only for a self-hosted or testnet instance",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i += 1) {
      // One operation today; the parameter stays so a second can be added without a breaking version bump.
      this.getNodeParameter("operation", i);
      const baseUrl = (this.getNodeParameter("baseUrl", i, "https://api.paystage.xyz") as string).replace(/\/+$/, "");

      const body = {
        payment_required: this.getNodeParameter("paymentRequired", i, {}),
        policy: this.getNodeParameter("policy", i, {}),
      };
      const url = `${baseUrl}/v1/evaluate_mcp_payment`;

      try {
        const response = await this.helpers.httpRequest({
          method: "POST",
          url,
          body,
          json: true,
          timeout: 20_000,
        });
        out.push({ json: response as IDataObject });
      } catch (error) {
        // Fail closed: an unreachable gate must never look like a pass.
        out.push({
          json: {
            decision: "unverifiable",
            reasons: [`PayStage could not be reached: ${error instanceof Error ? error.message : String(error)}`],
            fail_closed: true,
          },
        });
      }
    }

    return [out];
  }
}
