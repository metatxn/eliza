import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import {
    PublicClient as LensClientCore,
    testnet,
    NotificationType,
    type Account,
    SessionClient,
    CreatePostRequest,
    type AnyPost,
    PostResult,
    PageSize,
    NotificationsQuery,
    type FullAccount,
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
import { PrivateKeyAccount, Client } from "viem";
import { getProfilePictureUri, omit, handleTxnLifeCycle } from "./utils";
import { parse } from "graphql";
export class LensClient {
    runtime: IAgentRuntime;
    signer: PrivateKeyAccount;
    walletClient: Client;
    cache: Map<string, any>;
    lastInteractionTimestamp: Date;
    sessionClient: SessionClient | null;
    accountAddress: EvmAddress;

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
        cache: Map<string, any>;
        signer: PrivateKeyAccount;
        accountAddress: EvmAddress;
        walletClient: Client;
    }) {
        this.cache = opts.cache;
        this.runtime = opts.runtime;
        this.signer = opts.signer;
        this.core = LensClientCore.create({
            environment: testnet,
            //origin: "https://myappdomain.xyz", // Ignored if running in a browser
        });
        this.lastInteractionTimestamp = new Date();
        this.authenticated = false;
        this.accountAddress = opts.accountAddress;
        this.authenticatedAccount = null;
        this.sessionClient = null;
        this.walletClient = opts.walletClient;
    }

    async authenticate(): Promise<void> {
        try {
            // to login We need to provide, Account's unique address, app address, instance of
            // user address made using PrivateKeyAccount.

            // login as account owner, accountAddress is lens-account's address
            // app address is the address of the app that is using the lens-account,
            // owner address is actual user's address
            const authenticated = await this.core.login({
                accountOwner: {
                    account: this.accountAddress,
                    app: "0xe5439696f4057aF073c0FB2dc6e5e755392922e1",
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
            elizaLogger.error("client-lens::client error: ", error);
            throw error;
        }
    }

    async createPost(contentUri: string, commentOn?: string): Promise<AnyPost> {
        try {
            if (!this.authenticated || !this.sessionClient) {
                await this.authenticate();
                elizaLogger.log("done authenticating");
            }

            // now that we are sure that we have authenticated, we can use sessionClient
            if (!this.sessionClient) {
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

            const txnResult: string = await handleTxnLifeCycle(
                postResult,
                this.walletClient,
                this.signer
            );

            elizaLogger.log("Transaction result: ", txnResult);

            // we have to return the post object
            const postResponse = await fetchPost(this.core, {
                txHash: txnResult,
            });
            if (postResponse.isOk()) {
                const post = postResponse.value;
                if (!post) {
                    throw new Error("Post not found after creation");
                }
                return post;
            }
            throw new Error("Failed to fetch created post");
        } catch (error) {
            elizaLogger.error("client-lens::client error: ", error);
            throw error;
        }
    }

    async getPost(postId: string): Promise<AnyPost | null> {
        if (this.cache.has(`lens/post/${postId}`)) {
            return this.cache.get(`lens/post/${postId}`);
        }

        const postResult = await fetchPost(this.core, { post: postId });

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
        next?: () => {};
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
        const mentions: AnyPost[] = [];

        const unwrappedResult = result.unwrapOr({ items: [], next: undefined });
        const items = unwrappedResult?.items;
        const next =
            "next" in unwrappedResult ? unwrappedResult?.next : undefined;
        items.map((notification) => {
            // @ts-ignore NotificationFragment
            const item = notification.publication || notification.comment;
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
    async getAccount(handle: string): Promise<UserAccount> {
        if (this.cache.has(`lens/account/${handle}`)) {
            return this.cache.get(`lens/account/${handle}`) as UserAccount;
        }

        // TODO: this is a temporary solution, we need to account metadata from fetchAccount, as of now it is not returning metadata
        const graphqlQuery = parse(`
                query Account($request: AccountRequest!) {
                            account(request: $request) {
                                address
                                metadata {
                                    bio
                                    coverPicture
                                    id
                                    name
                                    picture
                                    attributes {
                                        type
                                        key
                                        value
                                    }
                                }
                                username {
                                    id
                                    linkedTo
                                    localName
                                    namespace {
                                        address
                                        namespace
                                        createdAt
                                        metadata {
                                            description
                                            id
                                        }
                                        owner
                                        stats {
                                            totalUsernames
                                        }
                                    }
                                    value
                                    timestamp
                                    ownedBy
                                }
                                score
                            }
                        }`);

        const variables = {
            handle: handle,
        };

        const result = await this.core.query(graphqlQuery, variables);
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

        elizaLogger.debug("gql query result", result);
        if (result.isOk()) {
            const data = result.value as any;
            account.usernameId = data.id;
            account.address = data.address;
            account.name = data.metadata?.name;
            account.localName = data.handle?.localName;
            account.bio = data.metadata?.bio;
            account.picture = getProfilePictureUri(data.metadata?.picture);
            account.cover = getProfilePictureUri(data.metadata?.coverPicture);
        }
        this.cache.set(`lens/account/${handle}`, account);

        return account;
    }

    async getTimeline(
        userAddress: string,
        limit: number = 10
    ): Promise<AnyPost[]> {
        try {
            if (!this.authenticated) {
                await this.authenticate();
            }
            const timeline: AnyPost[] = [];
            let next: any | undefined = undefined;

            do {
                const result = next
                    ? await next()
                    : await fetchTimeline(this.core, {
                          account: userAddress,
                          filter: {
                              eventType: ["POST", "QUOTE"], // "COMMENT", "REPOST",
                          },
                      });

                const data = result.unwrap();

                data.items.forEach((item) => {
                    // private posts in orb clubs are encrypted: encrypted posts are not available as of now in lensV3
                    if (
                        timeline.length < limit // && !item?.primary?.isEncrypted
                    ) {
                        this.cache.set(`lens/post/${item.id}`, item.root);
                        timeline.push(item.root as AnyPost);
                    }
                });

                next = data.pageInfo.next;
            } while (next && timeline.length < limit);

            return timeline;
        } catch (error) {
            console.log(error);
            throw new Error("client-lens:: getTimeline");
        }
    }
    /**
    private async createPostOnchain(
        contentURI: string
    ): Promise<BroadcastResult | undefined> {
        // gasless + signless if they enabled the lens profile manager
        if (this.authenticatedProfile?.signless) {
            const broadcastResult = await this.core.publication.postOnchain({
                contentURI,
                openActionModules: [], // TODO: if collectable
            });
            return handleBroadcastResult(broadcastResult);
        }

        // gasless with signed type data
        const typedDataResult =
            await this.core.publication.createOnchainPostTypedData({
                contentURI,
                openActionModules: [], // TODO: if collectable
            });
        const { id, typedData } = typedDataResult.unwrap();

        const signedTypedData = await this.account.signTypedData({
            domain: omit(typedData.domain as any, "__typename"),
            types: omit(typedData.types, "__typename"),
            primaryType: "Post",
            message: omit(typedData.value, "__typename"),
        });

        const broadcastResult = await this.core.transaction.broadcastOnchain({
            id,
            signature: signedTypedData,
        });
        return handleBroadcastResult(broadcastResult);
    }

    private async createCommentOnchain(
        contentURI: string,
        commentOn: string
    ): Promise<BroadcastResult | undefined> {
        // gasless + signless if they enabled the lens profile manager
        if (this.authenticatedProfile?.signless) {
            const broadcastResult = await this.core.publication.commentOnchain({
                commentOn,
                contentURI,
            });
            return handleBroadcastResult(broadcastResult);
        }

        // gasless with signed type data
        const typedDataResult =
            await this.core.publication.createOnchainCommentTypedData({
                commentOn,
                contentURI,
            });

        const { id, typedData } = typedDataResult.unwrap();

        const signedTypedData = await this.account.signTypedData({
            domain: omit(typedData.domain as any, "__typename"),
            types: omit(typedData.types, "__typename"),
            primaryType: "Comment",
            message: omit(typedData.value, "__typename"),
        });

        const broadcastResult = await this.core.transaction.broadcastOnchain({
            id,
            signature: signedTypedData,
        });
        return handleBroadcastResult(broadcastResult);
    }

    private async createCommentMomoka(
        contentURI: string,
        commentOn: string
    ): Promise<BroadcastResult | undefined> {
        // gasless + signless if they enabled the lens profile manager
        if (this.authenticatedProfile?.signless) {
            const broadcastResult = await this.core.publication.commentOnMomoka(
                {
                    commentOn,
                    contentURI,
                }
            );
            return handleBroadcastResult(broadcastResult);
        }

        // gasless with signed type data
        const typedDataResult =
            await this.core.publication.createMomokaCommentTypedData({
                commentOn,
                contentURI,
            });

        const { id, typedData } = typedDataResult.unwrap();

        const signedTypedData = await this.account.signTypedData({
            domain: omit(typedData.domain as any, "__typename"),
            types: omit(typedData.types, "__typename"),
            primaryType: "Comment",
            message: omit(typedData.value, "__typename"),
        });

        const broadcastResult = await this.core.transaction.broadcastOnMomoka({
            id,
            signature: signedTypedData,
        });
        return handleBroadcastResult(broadcastResult);
    }
         */
}
