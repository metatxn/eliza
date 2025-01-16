import type { LensClient } from "../client";
import {
    elizaLogger,
    type Content,
    type IAgentRuntime,
    type Memory,
    type UUID,
} from "@elizaos/core";
import { textOnly } from "@lens-protocol/metadata";
import { createPostMemory } from "../memory";
import { AnyPost } from "@lens-protocol/client";
import { StorageProvider } from "../providers/StorageProvider";

export async function sendPost(
    runtime: IAgentRuntime,
    client: LensClient,
    content: Content,
    roomId: UUID,
    storage: StorageProvider,
    commentOn?: string
): Promise<{ memory?: Memory; post?: AnyPost }> {
    const metadata = textOnly({ content: content.text });
    let contentURI;
    try {
        elizaLogger.debug("post metadata: ", metadata);
        const response = await storage.uploadJson(metadata);
        elizaLogger.debug(" storage response: ", response);
        contentURI = response.url;
    } catch (e) {
        elizaLogger.warn(
            `Failed to upload metadata with storage provider: ${storage.provider}. Ensure your storage provider is configured correctly.`
        );
        throw e;
    }

    //elizaLogger.info(`Content URI: ${contentURI}`);
    const post = await client.createPost(
        contentURI,
        // false, // TODO: support collectable settings
        commentOn
    );

    if (post) {
        elizaLogger.debug("runtime agent id: ", runtime.agentId);
        return {
            post,
            memory: createPostMemory({
                roomId,
                senderId: runtime.agentId,
                runtime,
                post: post,
            }),
        };
    } else {
        elizaLogger.error("Failed to create post");
    }

    return {};
}
