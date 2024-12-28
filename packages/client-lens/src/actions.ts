import type { LensClient } from "./client";
import {
    elizaLogger,
    type Content,
    type IAgentRuntime,
    type Memory,
    type UUID,
} from "@elizaos/core";
import { textOnly } from "@lens-protocol/metadata";
import { createPostMemory } from "./memory";
import { AnyPost } from "@lens-protocol/client";
import { StorageProvider } from "./providers/StorageProvider";

export async function sendPost({
    client,
    runtime,
    content,
    roomId,
    commentOn,
    storage,
}: {
    client: LensClient;
    runtime: IAgentRuntime;
    content: Content;
    roomId: UUID;
    commentOn?: string;
    storage: StorageProvider;
}): Promise<{ memory?: Memory; post?: AnyPost }> {
    // TODO: arweave provider for content hosting
    const metadata = textOnly({ content: content.text });
    let contentURI;
    try {
        const response = await storage.uploadJson(metadata);
        contentURI = response.url;
    } catch (e) {
        elizaLogger.warn(
            `Failed to upload metadata with storage provider: ${storage.provider}. Ensure your storage provider is configured correctly.`
        );
        throw e;
    }

    elizaLogger.info(`Content URI: ${contentURI}`);
    const post = await client.createPost(
        contentURI,
        // false, // TODO: support collectable settings
        commentOn
    );

    if (post) {
        return {
            post,
            memory: createPostMemory({
                roomId,
                runtime,
                post: post,
            }),
        };
    } else {
        elizaLogger.error("Failed to create post");
    }

    return {};
}
