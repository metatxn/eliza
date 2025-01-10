import {
    elizaLogger,
    getEmbeddingZeroVector,
    IAgentRuntime,
    stringToUuid,
    type Memory,
    type UUID,
} from "@elizaos/core";
import { hasContent, postUuid } from "./utils";
import { LensClient } from "./client";
import { AnyPost } from "@lens-protocol/client";

export function createPostMemory({
    roomId,
    runtime,
    post,
}: {
    roomId: UUID;
    runtime: IAgentRuntime;
    post: AnyPost;
}): Memory {
    const commentOn =
        post.__typename === "Post"
            ? post.commentOn
            : undefined // TODO: check if this is correct
              ? postUuid({
                    pubId: post.id,
                    agentId: runtime.agentId,
                })
              : undefined;

    return {
        id: postUuid({
            pubId: post.id,
            agentId: runtime.agentId,
        }),
        agentId: runtime.agentId,
        userId: runtime.agentId,
        content: {
            text:
                post.__typename === "Post" && hasContent(post.metadata)
                    ? post.metadata.content
                    : "Default content",
            //text: "This is lens content",
            source: "lens",
            url: "",
            commentOn,
            id: post.id,
        },
        roomId,
        embedding: getEmbeddingZeroVector(),
    };
}

export async function buildConversationThread({
    post,
    runtime,
    client,
}: {
    post: AnyPost;
    runtime: IAgentRuntime;
    client: LensClient;
}): Promise<AnyPost[]> {
    const thread: AnyPost[] = [];
    // Initializes a set to keep track of the post IDs that have already been processed, preventing infinite loops.
    const visited: Set<string> = new Set();
    async function processThread(currentPost: AnyPost) {
        if (visited.has(currentPost.id)) {
            return;
        }

        visited.add(currentPost.id);

        const roomId = postUuid({
            pubId: currentPost.id,
            agentId: runtime.agentId,
        });

        // Check if the current cast has already been saved
        const memory = await runtime.messageManager.getMemoryById(roomId);

        if (!memory) {
            elizaLogger.log("Creating memory for post", currentPost.id);

            const userId = stringToUuid("12");

            if (currentPost.__typename === "Post") {
                await runtime.ensureConnection(
                    userId,
                    roomId,
                    currentPost?.author?.address,
                    currentPost?.author?.metadata?.name ||
                        currentPost?.author?.username?.localName,
                    "lens"
                );
            } else {
                elizaLogger.warn("currentPost is not a Post: ", currentPost);
            }
            await runtime.messageManager.createMemory(
                createPostMemory({
                    roomId,
                    runtime,
                    post: currentPost,
                })
            );
        }

        thread.unshift(currentPost);

        if (currentPost.id) {
            // Check if currentPost has a commentOn property
            if ("commentOn" in currentPost && currentPost.commentOn) {
                const parentPost = await client.getPost(
                    currentPost.commentOn.id
                );
                if (parentPost) await processThread(parentPost);
            }
        }
    }

    await processThread(post);
    return thread;
}
