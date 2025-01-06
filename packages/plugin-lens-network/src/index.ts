export * from "./actions/bridge";
export * from "./actions/swap";
export * from "./actions/transfer";
export * from "./providers/wallet";
export * from "./types";

import type { Plugin } from "@elizaos/core";
import { bridgeAction } from "./actions/bridge";
import { swapAction } from "./actions/swap";
import { transferAction } from "./actions/transfer";
import { evmWalletProvider } from "./providers/wallet";

export const lensNetworkPlugin: Plugin = {
    name: "lens-network",
    description: "Lens Network Plugin for Eliza",
    providers: [evmWalletProvider],
    evaluators: [],
    services: [],
    actions: [transferAction, bridgeAction, swapAction],
};

export default lensNetworkPlugin;
