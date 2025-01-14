import {
    composeContext,
    generateMessageResponse,
    generateShouldRespond,
    Memory,
    ModelClass,
    stringToUuid,
    elizaLogger,
    HandlerCallback,
    Content,
    type IAgentRuntime,
} from "@elizaos/core";
import type { LensClient } from "./client";
import { toHex } from "viem";
import { buildConversationThread, createPostMemory } from "./memory";
import {
    formatPost,
    formatTimeline,
    messageHandlerTemplate,
    shouldRespondTemplate,
} from "./prompts";
import { hasContent, postUuid } from "./utils";
import { sendPost } from "./actions";
import { AnyPost, EvmAddress } from "@lens-protocol/client";

import { StorageProvider } from "./providers/StorageProvider";
import { UserAccount } from "./types";

export class LensInteractionManager {
    private timeout: NodeJS.Timeout | undefined;
    private startupTime: Date;
    constructor(
        public client: LensClient,
        public runtime: IAgentRuntime,
        // TODO: check for good var name and make it consistent throughout the codebase
        private smartAccountAddress: EvmAddress,
        public cache: Map<string, any>,
        private storage: StorageProvider
    ) {
        this.startupTime = new Date();
    }

    public async start() {
        const handleInteractionsLoop = async () => {
            try {
                console.log("Checking for Lens interactions");
                await this.handleInteractions();
            } catch (error) {
                elizaLogger.error(error);
                return;
            }

            this.timeout = setTimeout(
                handleInteractionsLoop,
                Number(this.runtime.getSetting("LENS_POLL_INTERVAL") || 120) *
                    1000 // Default to 2 minutes
            );
        };

        handleInteractionsLoop();
    }

    public async stop() {
        if (this.timeout) clearTimeout(this.timeout);
    }

    private async handleInteractions() {
        elizaLogger.info("Handle Lens interactions");
        // TODO: handle next() for pagination
        const { mentions } = await this.client.getMentions();

        const agent = await this.client.getAccount(this.smartAccountAddress);
        elizaLogger.info(`[Lens Client] agent account: ${agent.name}`);
        for (const mention of mentions) {
            //elizaLogger.info("Handling mention", mention);
            const messageHash = toHex(mention?.id);
            const conversationId = `${messageHash}-${this.runtime.agentId}`;
            elizaLogger.info("conversationId", conversationId);
            let roomId, userId;
            if (mention.__typename === "Post") {
                roomId = stringToUuid(conversationId);
                userId = stringToUuid(mention?.author?.address);
            }
            const pastMemoryId = postUuid({
                agentId: this.runtime.agentId,
                pubId: mention.id,
            });

            const pastMemory =
                await this.runtime.messageManager.getMemoryById(pastMemoryId);

            if (pastMemory) {
                continue;
            }

            if (mention.__typename === "Post") {
                await this.runtime.ensureConnection(
                    userId,
                    roomId,
                    mention.author.address,
                    mention.author.metadata?.name ||
                        mention.author.username?.localName, // as of now, author metadata is not present in Post.author
                    "lens"
                );

                const thread = await buildConversationThread({
                    client: this.client,
                    runtime: this.runtime,
                    post: mention,
                });

                const memory: Memory = {
                    content: {
                        text: hasContent(mention.metadata)
                            ? mention.metadata.content
                            : "Default content",
                        hash: mention.id,
                    },
                    agentId: this.runtime.agentId,
                    userId,
                    roomId,
                };
                await this.handlePost({
                    agent,
                    post: mention,
                    memory,
                    thread,
                });
            }
        }

        this.client.lastInteractionTimestamp = new Date();
    }

    private async handlePost({
        agent,
        post,
        memory,
        thread,
    }: {
        agent: UserAccount;
        post: AnyPost;
        memory: Memory;
        thread: AnyPost[];
    }) {
        elizaLogger.debug("Handling post with post: ", post);
        elizaLogger.debug("Handling post with memory: ", memory);

        // Skip if post is older than startup time
        if (
            post.__typename === "Post" &&
            new Date(post.timestamp) < this.startupTime
        ) {
            elizaLogger.info(`Skipping old post from ${post.timestamp}`);
            return;
        }

        // skip the response if the post is from the bot itself
        if (
            post.__typename === "Post" &&
            post?.author?.address === agent?.address
        ) {
            elizaLogger.info("skipping cast from bot itself", post.id);
            return;
        }

        // skip the response if the post has no text
        if (!memory.content.text) {
            elizaLogger.info("skipping cast with no text", post?.id);
            return { text: "", action: "IGNORE" };
        }

        const currentPost = formatPost(post);

        const timeline = await this.client.getTimeline(
            this.smartAccountAddress
        );

        const formattedTimeline = formatTimeline(
            this.runtime.character,
            timeline
        );

        const formattedConversation = thread
            .map((pub) => {
                if (pub.__typename !== "Post") return "";
                // @ts-expect-error Metadata
                const content = pub.metadata.content;
                return `@${pub.author?.username?.localName} (${new Date(
                    pub.timestamp
                ).toLocaleString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                })}):
                ${content}`;
            })
            .filter(Boolean)
            .join("\n\n");

        // Compose initial state
        const state = await this.runtime.composeState(memory, {
            lensHandle: agent.localName,
            timeline: formattedTimeline,
            currentPost,
            formattedConversation,
        });

        const shouldRespondContext = composeContext({
            state,
            template:
                this.runtime.character.templates?.lensShouldRespondTemplate ||
                this.runtime.character.templates?.shouldRespondTemplate ||
                shouldRespondTemplate,
        });

        const memoryId = postUuid({
            agentId: this.runtime.agentId,
            pubId: post.id,
        });

        const castMemory =
            await this.runtime.messageManager.getMemoryById(memoryId);

        if (!castMemory) {
            await this.runtime.messageManager.createMemory(
                createPostMemory({
                    roomId: memory.roomId,
                    runtime: this.runtime,
                    post,
                })
            );
        }

        const shouldRespondResponse = await generateShouldRespond({
            runtime: this.runtime,
            context: shouldRespondContext,
            modelClass: ModelClass.SMALL,
        });

        if (
            shouldRespondResponse === "IGNORE" ||
            shouldRespondResponse === "STOP"
        ) {
            elizaLogger.info(
                `Not responding to post because generated ShouldRespond was ${shouldRespondResponse}`
            );
            return;
        }

        const context = composeContext({
            state,
            template:
                this.runtime.character.templates?.lensMessageHandlerTemplate ??
                this.runtime.character?.templates?.messageHandlerTemplate ??
                messageHandlerTemplate,
        });

        const responseContent = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.SMALL,
        });

        /** UUID of parent message if this is a reply/thread */
        responseContent.inReplyTo = memoryId;
        responseContent.action = shouldRespondResponse ?? undefined;

        elizaLogger.debug("Generated response", responseContent);

        if (!responseContent.text) return;

        if (this.runtime.getSetting("LENS_DRY_RUN") === "true") {
            elizaLogger.info(
                `Dry run: would have responded to post ${post.id} with ${responseContent.text}`
            );
            return;
        }

        const callback: HandlerCallback = async (
            content: Content,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            files: any[]
        ) => {
            try {
                if (memoryId && !content.inReplyTo) {
                    content.inReplyTo = memoryId;
                }
                const result = await sendPost({
                    runtime: this.runtime,
                    client: this.client,
                    content: content,
                    roomId: memory.roomId,
                    commentOn: post.id,
                    storage: this.storage,
                });
                if (!result?.post?.id) throw new Error("post not sent");

                // sendPost lost response action, so we need to add it back here?
                result.memory!.content.action = content.action;

                await this.runtime.messageManager.createMemory(result.memory!);
                return [result.memory!];
            } catch (error) {
                console.error("Error sending response post:", error);
                return [];
            }
        };

        const responseMessages = await callback(responseContent);

        const newState = await this.runtime.updateRecentMessageState(state);

        await this.runtime.processActions(
            memory,
            responseMessages,
            newState,
            callback
        );
    }
}
