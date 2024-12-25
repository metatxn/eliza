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
import StorjProvider from "./providers/StorjProvider";

export async function sendPost({
    client,
    runtime,
    content,
    roomId,
    commentOn,
    ipfs,
}: {
    client: LensClient;
    runtime: IAgentRuntime;
    content: Content;
    roomId: UUID;
    commentOn?: string;
    ipfs: StorjProvider;
}): Promise<{ memory?: Memory; post?: AnyPost }> {
    // TODO: arweave provider for content hosting
    const metadata = textOnly({ content: content.text });
    const contentURI = await ipfs.pinJson(metadata);

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
