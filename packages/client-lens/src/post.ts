import {
    composeContext,
    generateText,
    IAgentRuntime,
    ModelClass,
    stringToUuid,
    elizaLogger,
} from "@elizaos/core";
import { LensClient } from "./client";
import { formatTimeline, postTemplate } from "./prompts";
import { postUuid } from "./utils";
import { createPostMemory } from "./memory";
import { sendPost } from "./actions/sendPost";
import { StorageProvider } from "./providers/StorageProvider";
import { EvmAddress } from "@lens-protocol/client";

export class LensPostManager {
    private timeout: NodeJS.Timeout | undefined;

    constructor(
        public client: LensClient,
        public runtime: IAgentRuntime,
        private smartAccountAddress: EvmAddress,
        public cache: Map<string, any>,
        private storage: StorageProvider
    ) {}

    public async start() {
        const generateNewPostLoop = async () => {
            try {
                await this.generateNewPost();
            } catch (error) {
                elizaLogger.error(error);
                return;
            }

            this.timeout = setTimeout(
                generateNewPostLoop,
                (Math.floor(Math.random() * (4 - 1 + 1)) + 1) * 60 * 60 * 1000
            ); // Random interval between 1 and 4 hours
        };

        generateNewPostLoop();
    }

    public async stop() {
        if (this.timeout) clearTimeout(this.timeout);
    }

    private async generateNewPost() {
        elizaLogger.info("Generating new post");
        try {
            const userAccount = await this.client.getAccount(
                this.smartAccountAddress
            );
            elizaLogger.info(
                `[Lens Client] User account: ${userAccount.localName}`
            );
            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                userAccount.localName!,
                this.runtime.character.name,
                "lens" // TODO: this is a global namespace and in lensV3 it is represented by an evm address
            );

            const timeline = await this.client.getTimeline(
                this.smartAccountAddress
            );

            // this.cache.set("lens/timeline", timeline);

            const formattedHomeTimeline = formatTimeline(
                this.runtime.character,
                timeline
            );

            const generateRoomId = stringToUuid("lens_generate_room");

            const state = await this.runtime.composeState(
                {
                    roomId: generateRoomId,
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: { text: "", action: "" },
                },
                {
                    lensHandle: userAccount.localName,
                    timeline: formattedHomeTimeline,
                }
            );

            // Generate new post
            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.lensPostTemplate ||
                    postTemplate,
            });

            const content = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            if (this.runtime.getSetting("LENS_DRY_RUN") === "true") {
                elizaLogger.info(`Dry run: would have posted: ${content}`);
                return;
            }

            try {
                const response = await sendPost(
                    this.runtime,
                    this.client,
                    { text: content },
                    generateRoomId,
                    this.storage
                );

                const post = response.post;
                if (!post) throw new Error("failed to send post");

                const postId = post.id;
                if (!postId) throw new Error("failed to get post id");

                const roomId = postUuid({
                    agentId: this.runtime.agentId,
                    pubId: postId,
                });

                await this.runtime.ensureRoomExists(roomId);

                await this.runtime.ensureParticipantInRoom(
                    this.runtime.agentId,
                    roomId
                );

                elizaLogger.info(`[Lens Client] Posted ${post.id}`);

                await this.runtime.messageManager.createMemory(
                    createPostMemory({
                        roomId,
                        senderId: this.runtime.agentId,
                        runtime: this.runtime,
                        post,
                    })
                );
            } catch (error) {
                elizaLogger.error("Error sending post:", error);
            }
        } catch (error) {
            elizaLogger.error("Error generating new post:", error);
        }
    }
}
