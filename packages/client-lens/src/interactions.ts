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
import { postUuid } from "./utils";
import { sendPost } from "./actions";
import { AnyPost, EvmAddress } from "@lens-protocol/client";

import StorjProvider from "./providers/StorjProvider";
import { UserAccount } from "./types";

export class LensInteractionManager {
    private timeout: NodeJS.Timeout | undefined;
    constructor(
        public client: LensClient,
        public runtime: IAgentRuntime,
        // TODO: check for good var name and make it consistent throughout the codebase
        private smartAccountAddress: EvmAddress,
        public cache: Map<string, any>,
        private ipfs: StorjProvider
    ) {}

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
        elizaLogger.info(`[Lens Client] User account: ${agent.name}`);
        for (const mention of mentions) {
            elizaLogger.info("Handling mention", mention);
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
                    mention.author?.username?.localName, // as of now, author metadata is not present in Post.author
                    "lens"
                );

                const thread = await buildConversationThread({
                    client: this.client,
                    runtime: this.runtime,
                    post: mention,
                });

                const memory: Memory = {
                    content: {
                        // @ts-ignore metadata.content
                        text: mention.metadata.content,
                        hash: mention.id,
                    },
                    agentId: this.runtime.agentId,
                    userId,
                    roomId,
                };
                await this.handlePublication({
                    agent,
                    post: mention,
                    memory,
                    thread,
                });
            }
        }

        this.client.lastInteractionTimestamp = new Date();
    }

    private async handlePublication({
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
        elizaLogger.info("Handling publication", post.id);
        if (
            post.__typename === "Post" &&
            post?.author?.address === agent?.address
        ) {
            elizaLogger.info("skipping cast from bot itself", post.id);
            return;
        }

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
                // @ts-ignore Metadata
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
                this.runtime.character?.templates?.shouldRespondTemplate ||
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
                `Not responding to publication because generated ShouldRespond was ${shouldRespondResponse}`
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
            modelClass: ModelClass.LARGE,
        });

        responseContent.inReplyTo = memoryId;

        if (!responseContent.text) return;

        if (this.runtime.getSetting("LENS_DRY_RUN") === "true") {
            elizaLogger.info(
                `Dry run: would have responded to publication ${post.id} with ${responseContent.text}`
            );
            return;
        }

        const callback: HandlerCallback = async (
            content: Content,
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
                    ipfs: this.ipfs,
                });
                if (!result?.post?.id) throw new Error("publication not sent");

                // sendPublication lost response action, so we need to add it back here?
                result.memory!.content.action = content.action;

                await this.runtime.messageManager.createMemory(result.memory!);
                return [result.memory!];
            } catch (error) {
                console.error("Error sending response cast:", error);
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
