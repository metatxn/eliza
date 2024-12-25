import { Client, IAgentRuntime, elizaLogger } from "@elizaos/core";
import { privateKeyToAccount } from "viem/accounts";
import { chains } from "@lens-network/sdk/viem";
import { LensClient } from "./client";
import { LensPostManager } from "./post";
import { LensInteractionManager } from "./interactions";
import StorjProvider from "./providers/StorjProvider";
import { createWalletClient, http } from "viem";
import { zksyncSepoliaTestnet } from "viem/zksync";
import { EvmAddress } from "@lens-protocol/client";

export class LensAgentClient implements Client {
    client: LensClient;
    posts: LensPostManager;
    interactions: LensInteractionManager;

    private accountAddress: EvmAddress;
    private ipfs: StorjProvider;

    constructor(public runtime: IAgentRuntime) {
        const cache = new Map<string, any>();

        const privateKey = runtime.getSetting(
            "EVM_PRIVATE_KEY"
        ) as `0x${string}`;
        if (!privateKey) {
            throw new Error("EVM_PRIVATE_KEY is missing");
        }
        const signer = privateKeyToAccount(privateKey);

        const walletClient = createWalletClient({
            account: signer,
            chain: chains.testnet,
            transport: http(),
        });

        // need to change this to get the lens account address from runtime
        this.accountAddress = runtime.getSetting(
            "LENS_SMART_ACCOUT_ADDRESS"
        )! as EvmAddress;

        this.client = new LensClient({
            runtime: this.runtime,
            signer,
            cache,
            accountAddress: this.accountAddress,
            walletClient,
        });

        elizaLogger.info("Lens client initialized.");

        this.ipfs = new StorjProvider(runtime);

        this.posts = new LensPostManager(
            this.client,
            this.runtime,
            this.accountAddress,
            cache,
            this.ipfs
        );

        this.interactions = new LensInteractionManager(
            this.client,
            this.runtime,
            this.accountAddress,
            cache,
            this.ipfs
        );
    }

    async start() {
        await Promise.all([this.posts.start(), this.interactions.start()]);
    }

    async stop() {
        await Promise.all([this.posts.stop(), this.interactions.stop()]);
    }
}
