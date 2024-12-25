import { Client, IAgentRuntime, elizaLogger } from "@elizaos/core";
import { privateKeyToAccount } from "viem/accounts";
import { LensClient } from "./client";
import { LensPostManager } from "./post";
import { LensInteractionManager } from "./interactions";
import StorjProvider from "./providers/StorjProvider";

export class LensAgentClient implements Client {
    client: LensClient;
    posts: LensPostManager;
    interactions: LensInteractionManager;

    private accountUsernameId: `0x${string}`;
    private accountAddress: `0x${string}`;
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

        this.accountUsernameId = runtime.getSetting(
            "LENS_PROFILE_ID"
        )! as `0x${string}`;

        this.accountAddress = runtime.getSetting(
            "EVM_ADDRESS"
        )! as `0x${string}`;

        this.client = new LensClient({
            runtime: this.runtime,
            signer,
            cache,
            accountUsernameId: this.accountUsernameId,
            accountAddress: this.accountAddress,
        });

        elizaLogger.info("Lens client initialized.");

        this.ipfs = new StorjProvider(runtime);

        this.posts = new LensPostManager(
            this.client,
            this.runtime,
            this.accountUsernameId,
            cache,
            this.ipfs
        );

        this.interactions = new LensInteractionManager(
            this.client,
            this.runtime,
            this.accountUsernameId,
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
