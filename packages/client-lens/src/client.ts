import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import {
    type AnyPostFragment,
    PublicClient as LensClientCore,
    testnet,
    TransactionStatusQuery,
    PageSize,
    NotificationType,
    AccountFragment,
    PostType,
    PostActionType,
    SessionClient,
    AccountManaged,
    AccountAvailableFragment,
    AccountAvailable,
    Account,
    type PostResult,
    PostId,
    SelfFundedTransactionRequest,
    SponsoredTransactionRequest,
    PostResponse,
} from "@lens-protocol/client";
import { PrivateKeyAccount } from "viem";
import { getProfilePictureUri, handlePostResult, omit } from "./utils";
import { evmAddress } from "@lens-protocol/client";
import { fetchAccountsAvailable, post } from "@lens-protocol/client/actions";

export class LensClient {
    runtime: IAgentRuntime;
    signer: PrivateKeyAccount;
    cache: Map<string, any>;
    lastInteractionTimestamp: Date;
    accountUsernameId: `0x${string}`;
    accountAddress: `0x${string}`;

    private authenticated: boolean;
    private authenticatedAccount: Account | null;
    private sessionClient: SessionClient | null; // Store the sessionClient
    private core: LensClientCore;

    constructor(opts: {
        runtime: IAgentRuntime;
        cache: Map<string, any>;
        signer: PrivateKeyAccount;
        accountUsernameId: `0x${string}`;
        accountAddress: `0x${string}`;
    }) {
        this.cache = opts.cache;
        this.runtime = opts.runtime;
        this.signer = opts.signer;
        this.core = LensClientCore.create({
            environment: testnet,
            //origin: "https://myappdomain.xyz", // Ignored if running in a browser
        });
        this.lastInteractionTimestamp = new Date();
        this.accountUsernameId = opts.accountUsernameId;
        this.accountAddress = opts.accountAddress;
        this.authenticated = false;
        this.authenticatedAccount = null;
        this.sessionClient = null; // Initialize sessionClient as null
    }

    async authenticate(): Promise<void> {
        console.log(
            "authenticating",
            this.accountAddress,
            this.signer,
            this.core
        );
        try {
            const authenticated = await this.core.login({
                accountOwner: {
                    account: this.accountAddress,
                    app: "0xe5439696f4057aF073c0FB2dc6e5e755392922e1",
                    owner: this.signer?.address,
                },
                signMessage: (message) => this.signer.signMessage({ message }),
            });

            if (authenticated.isErr()) {
                return console.error(
                    "unable to authenticate: ",
                    authenticated.error
                );
            }

            // Use the SessionClient to interact with @lens-protocol/client/actions that require authentication
            this.sessionClient = authenticated.value;
            console.log("sessionClient", this.sessionClient);

            //

            // Call getAuthenticatedUser and handle the result
            const authenticatedUserResult =
                await this.sessionClient.getAuthenticatedUser();

            if (authenticatedUserResult.isOk()) {
                const result = await fetchAccountsAvailable(this.core, {
                    managedBy: evmAddress(this.accountAddress),
                    includeOwned: true,
                });

                if (result.isErr()) {
                    console.error("Error fetching accounts: ", result.error);
                    throw new Error("Error fetching accounts" + result.error);
                }
                console.log("result", result);
                const accounts = result.value;
                if (!accounts?.items || accounts.items.length === 0) {
                    throw new Error("No profiles found for this address.");
                }

                // Attempt to find the matching profile if `accountUsernameId` is provided
                let primaryAccount: AccountAvailable | undefined;
                if (this.accountUsernameId) {
                    primaryAccount = accounts.items.find(
                        (item) =>
                            item.account.username?.id === this.accountUsernameId
                    );
                }
                // If the specified profile is not found, use the first one in the list
                if (!primaryAccount) {
                    primaryAccount = accounts.items[0];
                    if (this.accountUsernameId) {
                        elizaLogger.warn(
                            `Could not find account with ID ${this.accountUsernameId}, using the first account instead`
                        );
                    }
                }
                if (!primaryAccount) {
                    throw new Error(
                        "Could not determine account ID from available accounts"
                    );
                }

                this.authenticatedAccount = primaryAccount.account;

                //this.authenticatedAccount = result[0];
            } else {
                console.error(
                    "Error fetching authenticated user:",
                    authenticatedUserResult.error
                );
            }
            //await this.core.authentication.authenticate({ id, signature });

            //this.authenticatedProfile = await this.core.profile.fetch({
            //    forProfileId: this.profileId,
            // });

            this.authenticated = true;
        } catch (error) {
            elizaLogger.error("client-lens::client error: ", error);
            throw error;
        }
    }

    async createPost(
        contentUri: string,
        commentOn?: string
    ): Promise<typeof AnyPostFragment | null | undefined> {
        try {
            if (!this.authenticated || !this.sessionClient) {
                await this.authenticate();
                elizaLogger.log("done authenticating");
            }

            // now that we are sure that we have authenticated, we can use sessionClient
            if (!this.sessionClient) {
                throw new Error("sessionClient is null after authentication");
            }
            let postResult: PostResult | undefined;
            if (commentOn) {
                const commentResult = await post(this.sessionClient, {
                    commentOn: { post: commentOn }, // Wrap commentOn in an object
                    contentUri,
                });

                if (commentResult.isErr()) {
                    console.error(
                        "failed to post comment",
                        commentResult.error
                    );
                    throw new Error("Failed to comment" + commentResult.error);
                }
                postResult = handlePostResult(commentResult.value);
            } else {
                const postResultValue = await post(this.sessionClient, {
                    contentUri: contentUri,
                });
                if (postResultValue.isErr()) {
                    console.error("failed to post", postResultValue.error);
                    throw new Error("Failed to post" + postResultValue.error);
                }

                postResult = handlePostResult(postResultValue.value);
                console.log("postResult", postResult);
            }

            elizaLogger.log("broadcastResult", postResult);

            if (!postResult) {
                return null;
            }
        } catch (error) {
            elizaLogger.error("client-lens::client error: ", error);
            throw error;
        }
    }
    /**
    async getPublication(
        pubId: string
    ): Promise<typeof AnyPostFragment | null> {
        if (this.cache.has(`lens/publication/${pubId}`)) {
            return this.cache.get(`lens/publication/${pubId}`);
        }

        const publication = await this.core.publication.fetch({ forId: pubId });

        if (publication)
            this.cache.set(`lens/publication/${pubId}`, publication);

        return publication;
    }

    async getPublicationsFor(
        profileId: string,
        limit: number = 50
    ): Promise<AnyPublicationFragment[]> {
        const timeline: AnyPublicationFragment[] = [];
        let next: any | undefined = undefined;

        do {
            const { items, next: newNext } = next
                ? await next()
                : await this.core.publication.fetchAll({
                      limit: LimitType.Fifty,
                      where: {
                          from: [profileId],
                          publicationTypes: [PublicationType.Post],
                      },
                  });

            items.forEach((publication) => {
                this.cache.set(
                    `lens/publication/${publication.id}`,
                    publication
                );
                timeline.push(publication);
            });

            next = newNext;
        } while (next && timeline.length < limit);

        return timeline;
    }

    async getMentions(): Promise<{
        mentions: AnyPublicationFragment[];
        next?: () => {};
    }> {
        if (!this.authenticated) {
            await this.authenticate();
        }
        // TODO: we should limit to new ones or at least latest n
        const result = await this.core.notifications.fetch({
            where: {
                highSignalFilter: false, // true,
                notificationTypes: [
                    NotificationType.Mentioned,
                    NotificationType.Commented,
                ],
            },
        });
        const mentions: AnyPublicationFragment[] = [];

        const { items, next } = result.unwrap();

        items.map((notification) => {
            // @ts-ignore NotificationFragment
            const item = notification.publication || notification.comment;
            if (!item.isEncrypted) {
                mentions.push(item);
                this.cache.set(`lens/publication/${item.id}`, item);
            }
        });

        return { mentions, next };
    }

    async getProfile(profileId: string): Promise<Profile> {
        if (this.cache.has(`lens/profile/${profileId}`)) {
            return this.cache.get(`lens/profile/${profileId}`) as Profile;
        }

        const result = await this.core.profile.fetch({
            forProfileId: profileId,
        });
        if (!result?.id) {
            elizaLogger.error("Error fetching user by profileId");

            throw "getProfile ERROR";
        }

        const profile: Profile = {
            id: "",
            profileId,
            name: "",
            handle: "",
        };

        profile.id = result.id;
        profile.name = result.metadata?.displayName;
        profile.handle = result.handle?.localName;
        profile.bio = result.metadata?.bio;
        profile.pfp = getProfilePictureUri(result.metadata?.picture);

        this.cache.set(`lens/profile/${profileId}`, profile);

        return profile;
    }

    async getTimeline(
        profileId: string,
        limit: number = 10
    ): Promise<AnyPublicationFragment[]> {
        try {
            if (!this.authenticated) {
                await this.authenticate();
            }
            const timeline: AnyPublicationFragment[] = [];
            let next: any | undefined = undefined;

            do {
                const result = next
                    ? await next()
                    : await this.core.feed.fetch({
                          where: {
                              for: profileId,
                              feedEventItemTypes: [FeedEventItemType.Post],
                          },
                      });

                const data = result.unwrap();

                data.items.forEach((item) => {
                    // private posts in orb clubs are encrypted
                    if (timeline.length < limit && !item.root.isEncrypted) {
                        this.cache.set(
                            `lens/publication/${item.id}`,
                            item.root
                        );
                        timeline.push(item.root as AnyPublicationFragment);
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
