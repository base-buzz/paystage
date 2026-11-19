/**
 * The slice of n8n's node API this package implements, declared locally.
 *
 * `n8n-workflow` is not a dependency on purpose: it drags in `isolated-vm`, a native module that fails to compile in CI, and a
 * community node needs none of its runtime — n8n injects the context. Declaring the four interfaces used here keeps the package
 * installable anywhere while still type-checking the contract n8n will hold us to.
 *
 * If n8n changes these shapes, this file is where the mismatch shows up.
 */
declare module "n8n-workflow" {
  export type IDataObject = Record<string, unknown>;

  export interface INodeExecutionData {
    json: IDataObject;
    binary?: Record<string, unknown>;
    pairedItem?: unknown;
  }

  export interface INodeTypeDescription {
    displayName: string;
    name: string;
    group: string[];
    version: number;
    description: string;
    defaults: { name: string };
    inputs: string[];
    outputs: string[];
    properties: Array<Record<string, unknown>>;
  }

  export interface IExecuteFunctions {
    getInputData(): INodeExecutionData[];
    getNodeParameter(name: string, itemIndex: number, fallback?: unknown): unknown;
    helpers: {
      httpRequest(options: {
        method: string;
        url: string;
        body?: unknown;
        json?: boolean;
        timeout?: number;
      }): Promise<unknown>;
    };
  }

  export interface INodeType {
    description: INodeTypeDescription;
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
  }
}
