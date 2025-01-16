import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import {
    PublicClient as LensClientCore,
    testnet,
    NotificationType,
    type Account,
    SessionClient,
    CreatePostRequest,
    type AnyPost,
    PageSize,
    EvmAddress,
} from "@lens-protocol/client";
import {
    fetchAccount,
    fetchNotifications,
    fetchPost,
    fetchPosts,
    fetchTimeline,
    post,
    addReaction,
} from "@lens-protocol/client/actions";
import { UserAccount, operationResultType } from "./types";
import { PrivateKeyAccount, Client as WalletClient } from "viem";
import { handleTxnLifeCycle } from "./utils";

export class LensClient {
    runtime: IAgentRuntime;
    signer: PrivateKeyAccount;
    cache: Map<string, any>;
    accountAddress: EvmAddress;
    app: EvmAddress;
    walletClient: WalletClient;
    sessionClient: SessionClient | null;
    lastInteractionTimestamp: Date;

    private authenticated: boolean;
    private authenticatedAccount: Account | null;
    private core: LensClientCore;

    constructor(opts: {
        runtime: IAgentRuntime;
        signer: PrivateKeyAccount;
        cache: Map<string, any>;
        accountAddress: EvmAddress;
        app: EvmAddress;
        walletClient: WalletClient;
    }) {
        this.runtime = opts.runtime;
        this.signer = opts.signer;
        this.cache = opts.cache;
        this.accountAddress = opts.accountAddress;
        this.app = opts.app;
        this.walletClient = opts.walletClient;
        this.core = LensClientCore.create({
            environment: testnet,
            origin: "https://myappdomain.xyz",
            debug: true,
            cache: true,
        });
        this.lastInteractionTimestamp = new Date();
        this.authenticated = false;
        this.authenticatedAccount = null;
        this.sessionClient = null;
    }

    /**
     * Ensures the client is authenticated.
     * If not, it calls the `authenticate` method.
     */
    private async ensureAuthenticated(): Promise<void> {
        if (!this.authenticated || !this.sessionClient) {
            await this.authenticate();
        }
    }

    /**
     * Authenticates the client with the Lens Protocol.
     */
    private async authenticate(): Promise<void> {
        try {
            elizaLogger.info("Authenticating lens client");

            const authenticated = await this.core.login({
                accountOwner: {
                    account: this.accountAddress,
                    app: this.app,
                    owner: this.signer.address,
                },
                signMessage: (message) => this.signer.signMessage({ message }),
            });

            if (authenticated.isErr()) {
                throw authenticated.error;
            }

            this.sessionClient = authenticated.value;

            const accountResult = await fetchAccount(this.sessionClient, {
                address: this.accountAddress,
            });

            if (accountResult.isOk()) {
                this.authenticatedAccount = accountResult.value;
                this.authenticated = true;
            } else {
                throw new Error("Failed to fetch authenticated account");
            }
        } catch (error) {
            elizaLogger.error("client-lens:: auth error", error);
            throw error;
        }
    }

    /**
     * Creates a post or comment on the Lens Protocol.
     */
    async createPost(contentUri: string, commentOn?: string): Promise<AnyPost> {
        try {
            elizaLogger.debug("Creating post via createPost...", {
                contentUri,
                commentOn,
            });

            await this.ensureAuthenticated();

            if (!this.sessionClient) {
                throw new Error("sessionClient is null after authentication");
            }

            const req: CreatePostRequest = commentOn
                ? { commentOn: { post: commentOn }, contentUri }
                : { contentUri };

            const postExecutionResult = await post(this.sessionClient, req);

            if (postExecutionResult.isErr()) {
                elizaLogger.error(
                    "Failed to post comment",
                    postExecutionResult.error
                );
                throw new Error(
                    "Failed to comment: " + postExecutionResult.error.message
                );
            }

            const postResult: operationResultType = postExecutionResult.value;
            const txnResult: string = await handleTxnLifeCycle(
                postResult,
                this.walletClient,
                this.signer
            );

            elizaLogger.debug("Transaction hash received:", txnResult);

            // Retry logic to fetch the post after creation
            let viewPost: AnyPost | null = null;
            const maxAttempts = 5;
            const delayMs = 5000;

            for (let attempts = 0; attempts < maxAttempts; attempts++) {
                try {
                    viewPost = await this.getPost({ txHash: txnResult });
                    if (viewPost) {
                        elizaLogger.info(
                            "Successfully fetched post after attempt: ",
                            attempts
                        );
                        break;
                    }
                } catch (error) {
                    elizaLogger.error(
                        `Error in fetch attempt ${attempts}:`,
                        error
                    );
                }

                if (attempts < maxAttempts - 1) {
                    elizaLogger.info(
                        `Post not ready, waiting ${delayMs}ms before retry...`
                    );
                    await new Promise((resolve) =>
                        setTimeout(resolve, delayMs)
                    );
                }
            }

            if (!viewPost) {
                throw new Error(
                    `Failed to fetch post after ${maxAttempts} attempts`
                );
            }

            return viewPost;
        } catch (error) {
            elizaLogger.error("client-lens::create post error: ", error);
            throw error;
        }
    }

    /**
     * Fetches a post by its ID or transaction hash.
     */
    async getPost(options: {
        postId?: string;
        txHash?: string;
    }): Promise<AnyPost | null> {
        try {
            const { postId, txHash } = options;

            if (!postId && !txHash) {
                throw new Error("Either postId or txHash must be provided");
            }

            // Check cache if fetching by postId
            if (postId && this.cache.has(`lens/post/${postId}`)) {
                return this.cache.get(`lens/post/${postId}`);
            }

            await this.ensureAuthenticated();

            if (!this.sessionClient) {
                throw new Error("sessionClient is null");
            }

            const postResult = await fetchPost(this.sessionClient, {
                ...(postId ? { post: postId } : {}),
                ...(txHash ? { txHash } : {}),
            });

            if (postResult.isErr()) {
                elizaLogger.error("Error fetching post", {
                    error: postResult.error,
                    postId,
                    txHash,
                });
                return null;
            }

            const post = postResult.value;

            // Cache the result if we have a post and postId
            if (post && post.id) {
                this.cache.set(`lens/post/${post.id}`, post);
            }

            return post;
        } catch (error) {
            elizaLogger.error("Error in getPost", { error, ...options });
            throw error;
        }
    }

    /**
     * Fetches posts for a specific author.
     */
    async getPostsFor(
        authorAddress: string,
        pageSize: number = 50
    ): Promise<AnyPost[]> {
        const timeline: AnyPost[] = [];
        let next: any | undefined = undefined;

        do {
            const { items, next: newNext } = next
                ? await next()
                : await fetchPosts(this.core, {
                      pageSize: PageSize.Fifty,
                      filter: {
                          authors: [authorAddress],
                      },
                  });

            items.forEach((post) => {
                this.cache.set(`lens/post/${post.id}`, post);
                timeline.push(post);
            });

            next = newNext;
        } while (next && timeline.length < pageSize);

        return timeline;
    }

    /**
     * Fetches mentions and comments for the authenticated user.
     */
    async getMentions(): Promise<{ mentions: AnyPost[]; next?: () => void }> {
        await this.ensureAuthenticated();

        if (!this.sessionClient) {
            throw new Error("sessionClient is null after authentication");
        }

        const result = await fetchNotifications(this.sessionClient, {
            filter: {
                notificationTypes: [
                    NotificationType.Mentioned,
                    NotificationType.Commented,
                ],
                includeLowScore: true,
                timeBasedAggregation: false,
            },
        });

        const mentions: AnyPost[] = [];
        const unwrappedResult = result.unwrapOr({ items: [], next: undefined });
        const items = unwrappedResult?.items;
        const next =
            "next" in unwrappedResult ? unwrappedResult?.next : undefined;
        items.map((notification) => {
            const item = notification.post || notification.comment;
            // TODO: isEncrypted is not available in lensV3
            //if (!item.isEncrypted) {
            mentions.push(item);
            this.cache.set(`lens/post/${item.id}`, item);
            //}
        });

        return { mentions, next };
    }

    /**
     * Fetches account details for a given smart account address.
     */
    async getAccount(smartAccountAddress: EvmAddress): Promise<UserAccount> {
        if (this.cache.has(`lens/account/${smartAccountAddress}`)) {
            return this.cache.get(
                `lens/account/${smartAccountAddress}`
            ) as UserAccount;
        }

        const result = await fetchAccount(this.core, {
            address: smartAccountAddress,
        });

        if (!result.isOk()) {
            elizaLogger.error("Error fetching user by account address");
            throw new Error("Failed to fetch account");
        }

        const account: UserAccount = {
            usernameId: "",
            address: "0x" as EvmAddress,
            name: "",
            localName: "",
            namespace: "",
            picture: "",
            bio: "",
            cover: "",
        };

        if (result.isOk()) {
            const data = result.value;
            account.usernameId = data?.username?.id;
            account.address = data?.address;
            account.name = data?.metadata?.name;
            account.localName = data?.username?.localName;
            account.bio = data?.metadata?.bio;
            account.picture = data?.metadata?.picture;
            account.cover = data?.metadata?.coverPicture;
        }

        this.cache.set(`lens/account/${smartAccountAddress}`, account);
        return account;
    }

    /**
     * Fetches the timeline for a given user address.
     */
    async getTimeline(
        userAddress: EvmAddress,
        limit: number = 10
    ): Promise<AnyPost[]> {
        try {
            await this.ensureAuthenticated();

            if (!this.sessionClient) {
                throw new Error("sessionClient is null after authentication");
            }

            const timeline: AnyPost[] = [];
            const initialResult = await fetchTimeline(this.sessionClient, {
                account: userAddress,
                filter: {
                    eventType: ["POST"],
                },
            });

            if (initialResult.isErr()) {
                elizaLogger.warn(
                    "Initial fetch returned null",
                    initialResult.error
                );
                return timeline;
            }

            const initialData = initialResult.value;
            if (!initialData || !initialData.items) {
                elizaLogger.warn("Invalid data structure in initial fetch");
                return timeline;
            }

            for (const item of initialData.items) {
                if (timeline.length >= limit) break;

                if (!item || !item.primary || !item.primary?.id) {
                    elizaLogger.warn("Invalid item in timeline");
                    continue;
                }

                const post = item.primary as AnyPost;
                this.cache.set(`lens/post/${item.primary?.id}`, post);
                timeline.push(post);
            }

            // Only enter pagination loop if we need more items
            let nextPage = initialData.pageInfo?.next;
            while (nextPage && timeline.length < limit) {
                try {
                    const result = await nextPage();
                    const data = result.unwrap();

                    if (!data || !data.items) break;

                    for (const item of data.items) {
                        if (timeline.length >= limit) break;

                        if (!item || !item.primary || !item.primary.id)
                            continue;

                        const post = item.primary as AnyPost;
                        this.cache.set(`lens/post/${item.primary.id}`, post);
                        timeline.push(post);
                    }

                    nextPage = data.pageInfo?.next;
                } catch (paginationError) {
                    elizaLogger.error(
                        "Error during pagination",
                        paginationError
                    );
                    break;
                }
            }

            return timeline;
        } catch (error) {
            elizaLogger.error("Failed to fetch timeline", {
                error,
                userAddress,
                limit,
            });
            throw error instanceof Error
                ? error
                : new Error(`Failed to fetch timeline: ${error}`);
        }
    }

    // Helper function to like a post
    async likePost(post: AnyPost): Promise<void> {
        try {
            const postId = post.id;
            elizaLogger.debug("Liking a post via likePost...", {
                postId,
            });

            await this.ensureAuthenticated();

            if (!this.sessionClient) {
                throw new Error("sessionClient is null after authentication");
            }

            // first check if the agent already reacted on it
            const isAlreadyUpvoted =
                post.__typename == "Post" ? post.operations?.hasUpvoted : "";

            if (!isAlreadyUpvoted) {
                const result = await addReaction(this.sessionClient, {
                    post: postId,
                    reaction: "UPVOTE",
                });
                elizaLogger.debug("like post result: ", result);
                if (result.isErr()) {
                    elizaLogger.error("error in upvoting post", result.error);
                } else if (result.value.__typename == "AddReactionResponse") {
                    const response = result.value.success;
                    elizaLogger.debug("response in like post: ", response);
                } else if (result.value.__typename == "AddReactionFailure") {
                    elizaLogger.warn(
                        "error in upvoting post: ",
                        result.value.reason
                    );
                }
            }

            await elizaLogger.info(`Liked post with ID: ${postId}`);
        } catch (error) {
            elizaLogger.error("Error liking post:", error);
            throw error;
        }
    }
}
