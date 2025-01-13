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
} from "@lens-protocol/client/actions";
import { UserAccount, operationResultType } from "./types";
import { PrivateKeyAccount, Client as WalletClient } from "viem";
import { handleTxnLifeCycle } from "./utils";
//import { parse } from "graphql";
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

    // signer -> instance of wallet account to sign messages
    // accountId -> Not necessary as of now
    // sessionClient -> Will be used with lens client to make authenticated mutations
    // accountAddress -> address of the lens-account, Not user address
    // authenticated -> Bool to represent if the client is authenticated
    // authenticatedAccount -> Account details of the lens-account

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
            origin: "https://myappdomain.xyz", // Ignored if running in a browser
            debug: true,
            cache: true,
        });
        this.lastInteractionTimestamp = new Date();
        this.authenticated = false;
        this.authenticatedAccount = null;
        this.sessionClient = null;
    }

    async authenticate(): Promise<void> {
        try {
            elizaLogger.info("Authenticating lens client");
            // to login We need to provide, Account's unique address, app address, instance of
            // user address made using PrivateKeyAccount.

            // login as account owner, accountAddress is lens-account's address
            // app address is the address of the app that is using the lens-account,
            // owner address is actual user's address
            const authenticated = await this.core.login({
                accountOwner: {
                    account: this.accountAddress,
                    app: this.app,
                    owner: this.signer.address,
                },
                signMessage: (message) => this.signer.signMessage({ message }),
            });

            if (authenticated.isErr()) {
                return console.error(authenticated.error);
            }

            // sessionClient: { ... }
            const sessionClient = authenticated.value;

            // set session client to use it for authenticated mutations
            this.sessionClient = sessionClient;

            // fetch account details from account address
            const accountResult = await fetchAccount(sessionClient, {
                address: this.accountAddress,
            });
            if (accountResult.isOk()) {
                // set account details in authenticatedAccount
                this.authenticatedAccount = accountResult.value;
                this.authenticated = true;
            } else {
                throw new Error();
            }
        } catch (error) {
            elizaLogger.error("client-lens:: auth error", error);
            throw error;
        }
    }

    async createPost(contentUri: string, commentOn?: string): Promise<AnyPost> {
        try {
            elizaLogger.info(
                "Creating post via createPost...",
                contentUri,
                commentOn
            );
            if (!this.authenticated || !this.sessionClient) {
                await this.authenticate();
                elizaLogger.log("done authenticating");
            }

            // now that we are sure that we have authenticated, we can use sessionClient
            if (!this.sessionClient) {
                elizaLogger.error("sessionClient is null after authentication");
                throw new Error("sessionClient is null after authentication");
            }

            let req: CreatePostRequest;

            if (commentOn) {
                req = {
                    commentOn: { post: commentOn },
                    contentUri,
                };
            } else {
                req = {
                    contentUri,
                };
            }

            const postExecutionResult = await post(this.sessionClient, req);
            if (postExecutionResult.isErr()) {
                console.error(
                    "failed to post comment",
                    postExecutionResult.error
                );
                throw new Error(
                    "Failed to comment" + postExecutionResult.error
                );
            }

            const postResult: operationResultType = postExecutionResult.value;
            elizaLogger.debug("Post execution result:", postResult);
            const txnResult: string = await handleTxnLifeCycle(
                postResult,
                this.walletClient,
                this.signer
            );

            // Add debug logs
            elizaLogger.debug("Transaction hash received:", txnResult);

            // Add retry logic with delay
            let viewPost: AnyPost | undefined;
            let attempts = 0;
            const maxAttempts = 5;
            const delayMs = 5000; // 5 seconds

            while (!viewPost && attempts < maxAttempts) {
                attempts++;
                elizaLogger.info(`Attempt ${attempts} to fetch post...`);

                const postResponse = await fetchPost(this.sessionClient, {
                    txHash: txnResult,
                });

                if (postResponse.isOk() && postResponse.value) {
                    viewPost = postResponse?.value;
                    break;
                }

                if (attempts < maxAttempts) {
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

    async getPost(postId: string): Promise<AnyPost | null> {
        if (this.cache.has(`lens/post/${postId}`)) {
            return this.cache.get(`lens/post/${postId}`);
        }

        if (!this.authenticated || !this.sessionClient) {
            await this.authenticate();
            elizaLogger.log("done authenticating");
        }

        if (!this.sessionClient) {
            elizaLogger.error("sessionClient is null");
            throw new Error("sessionClient is null");
        }
        const postResult = await fetchPost(this.sessionClient, {
            post: postId,
        });

        if (postResult.isErr()) {
            console.error("Error fetching post", postResult.error);
            return null;
        } else {
            this.cache.set(`lens/post/${postId}`, postResult);
            return postResult?.value;
        }
    }

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

    async getMentions(): Promise<{
        mentions: AnyPost[];
        next?: () => void;
    }> {
        if (!this.authenticated || !this.sessionClient) {
            await this.authenticate();
            elizaLogger.log("done authenticating");
        }

        // now that we are sure that we have authenticated, we can use sessionClient
        if (!this.sessionClient) {
            throw new Error("sessionClient is null after authentication");
        }
        // TODO: we should limit to new ones or at least latest n

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

        /**
         * OUTPUT:
         * fetchNotifications result
            {"value":{"__typename":"PaginatedNotificationResult","items":[],
            "pageInfo":{"__typename":"PaginatedResultInfo","prev":null,"next":null}}}
         */
        elizaLogger.info("done fetching notifications...");
        const mentions: AnyPost[] = [];

        const unwrappedResult = result.unwrapOr({ items: [], next: undefined });
        const items = unwrappedResult?.items;
        const next =
            "next" in unwrappedResult ? unwrappedResult?.next : undefined;
        items.map((notification) => {
            const item = notification.post || notification.comment;
            // TODO: isEncrypted is not available in lensV3
            if (!item.isEncrypted) {
                mentions.push(item);
                this.cache.set(`lens/post/${item.id}`, item);
            }
        });

        return { mentions, next };
    }

    // @note: smartAccountAddress is the address of the lens-account. when username is created then
    // a smart account is created with the username and the address of the smart contract is the smartAccountAddress
    // In LensV3, everything is getting accumulated at this address.
    async getAccount(smartAccountAddress: EvmAddress): Promise<UserAccount> {
        if (this.cache.has(`lens/account/${smartAccountAddress}`)) {
            return this.cache.get(
                `lens/account/${smartAccountAddress}`
            ) as UserAccount;
        }

        // Note: account.metadata might get removed in future
        // TODO: handle namespace as well
        const result = await fetchAccount(this.core, {
            address: smartAccountAddress,
        });
        if (!result?.isOk) {
            elizaLogger.error("Error fetching user by account address");
            throw "getAccount ERROR";
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
            const data = result?.value;
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

    async getTimeline(
        userAddress: EvmAddress,
        limit: number = 10
    ): Promise<AnyPost[]> {
        try {
            if (!this.authenticated) {
                await this.authenticate();
            }

            if (!this.sessionClient) {
                throw new Error("sessionClient is null after authentication");
            }

            const timeline: AnyPost[] = [];

            // Initial fetch outside the loop
            const initialResult = await fetchTimeline(this.sessionClient, {
                account: userAddress,
                filter: {
                    eventType: ["POST"],
                },
            });

            //elizaLogger.info("Initial result data", initialResult);

            if (!initialResult || initialResult.isErr()) {
                elizaLogger.warn(
                    "Initial fetch returned null",
                    initialResult.error
                );
                return timeline;
            }

            let initialData;
            if (initialResult.isOk()) {
                initialData = initialResult.value;
            }
            if (!initialData || !initialData.items) {
                elizaLogger.warn("Invalid data structure in initial fetch");
                return timeline;
            }

            //elizaLogger.info("Initial fetch data", initialData);
            // Process initial items
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

                    if (!result) break;

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
                    elizaLogger.error("Error during pagination", {
                        error: paginationError,
                        currentLength: timeline.length,
                    });
                    break; // Exit loop but return what we have so far
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
}
