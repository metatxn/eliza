import { Client, IAgentRuntime, elizaLogger } from "@elizaos/core";
import { privateKeyToAccount } from "viem/accounts";
import { chains } from "@lens-network/sdk/viem";
import { LensClient } from "./client";
import { LensPostManager } from "./post";
import { LensInteractionManager } from "./interactions";
import StorjProvider from "./providers/StorjProvider";
import { LensStorageClient } from "./providers/LensStorage";
import { createWalletClient, http } from "viem";
import { EvmAddress } from "@lens-protocol/client";

export class LensAgentClient implements Client {
    client: LensClient;
    posts: LensPostManager;
    interactions: LensInteractionManager;

    private accountAddress: EvmAddress;
    private app: EvmAddress;
    private ipfs: typeof LensStorageClient;

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
            "LENS_SMART_ACCOUNT_ADDRESS"
        )! as EvmAddress;

        this.app = runtime.getSetting("LENS_APP")! as EvmAddress;

        this.client = new LensClient({
            runtime: this.runtime,
            signer,
            cache,
            accountAddress: this.accountAddress,
            app: this.app,
            walletClient,
        });

        elizaLogger.info("Lens client initialized.");

        this.ipfs = LensStorageClient;

        elizaLogger.info("Storj provider initialized.");

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
