import { stringToUuid } from "@elizaos/core";
import { BroadcastResult, operationResultType } from "./types";
import { PostResult } from "@lens-protocol/client";
import { sendEip712Transaction, sendTransaction } from "viem/zksync";
import { Account, Client } from "viem";

export const handleTxnLifeCycle = async (
    operationResult: operationResultType,
    walletClient: Client,
    account: Account
): Promise<string> => {
    try {
        if (operationResult.__typename === "PostResponse") {
            return operationResult.hash;
        }

        if (operationResult?.__typename === "SponsoredTransactionRequest") {
            const txnDetails = await sendEip712Transaction(walletClient, {
                data: operationResult.raw.data,
                gas: BigInt(operationResult.raw.gasLimit),
                maxFeePerGas: BigInt(operationResult.raw.maxFeePerGas),
                maxPriorityFeePerGas: BigInt(
                    operationResult.raw.maxPriorityFeePerGas
                ),
                nonce: operationResult.raw.nonce,
                paymaster:
                    operationResult.raw.customData.paymasterParams?.paymaster,
                paymasterInput:
                    operationResult.raw.customData.paymasterParams
                        ?.paymasterInput,
                to: operationResult.raw.to,
                value: BigInt(operationResult.raw.value),
                chain: null,
                account: account,
            });

            return txnDetails;
        }

        if (operationResult?.__typename === "SelfFundedTransactionRequest") {
            const txnDetails = await sendTransaction(walletClient, {
                data: operationResult?.raw?.data,
                gas: BigInt(operationResult?.raw?.gasLimit),
                maxFeePerGas: BigInt(operationResult?.raw?.maxFeePerGas),
                maxPriorityFeePerGas: BigInt(
                    operationResult?.raw?.maxPriorityFeePerGas
                ),
                nonce: operationResult?.raw?.nonce,
                to: operationResult?.raw?.to,
                type: "eip1559",
                value: BigInt(operationResult?.raw?.value),
                account: account,
                chain: null,
            });

            return txnDetails;
        }
        throw new Error("Unexpected operation result type");
    } catch (e) {
        throw Error("Sign rejected");
    }
};

export function postId({ pubId, agentId }: { pubId: string; agentId: string }) {
    return `${pubId}-${agentId}`;
}

export function postUuid(props: { pubId: string; agentId: string }) {
    return stringToUuid(postId(props));
}

export function populateMentions(
    text: string,
    userIds: number[],
    positions: number[],
    userMap: Record<number, string>
) {
    // Validate input arrays have same length
    if (userIds.length !== positions.length) {
        throw new Error(
            "User IDs and positions arrays must have the same length"
        );
    }

    // Create array of mention objects with position and user info
    const mentions = userIds
        .map((userId, index) => ({
            position: positions[index],
            userId,
            displayName: userMap[userId]!,
        }))
        .sort((a, b) => b.position - a.position); // Sort in reverse order to prevent position shifting

    // Create the resulting string by inserting mentions
    let result = text;
    mentions.forEach((mention) => {
        const mentionText = `@${mention.displayName}`;
        result =
            result.slice(0, mention.position) +
            mentionText +
            result.slice(mention.position);
    });

    return result;
}

export const handleBroadcastResult = (
    broadcastResult: any
): BroadcastResult | undefined => {
    const broadcastValue = broadcastResult.unwrap();

    if ("id" in broadcastValue || "txId" in broadcastValue) {
        return broadcastValue;
    } else {
        throw new Error();
    }
};

export const handlePostResult = (
    postResult: PostResult
): PostResult | undefined => {
    console.log("hash postResult", postResult);
    if ("hash" in postResult) {
        return { __typename: "PostResponse", hash: postResult.hash };
    }

    if ("reason" in postResult) {
        return undefined;
    }

    throw new Error("Unexpected PostResult type");
};

export const getProfilePictureUri = (picture: any): string | undefined => {
    if ("optimized" in picture) {
        return picture.optimized?.uri || picture.raw?.uri || picture.uri;
    } else {
        return picture.uri;
    }
};

export function omit<T extends object, K extends string>(
    obj: T,
    key: K
): Omit<T, K> {
    const result: any = {};
    Object.keys(obj).forEach((currentKey) => {
        if (currentKey !== key) {
            result[currentKey] = obj[currentKey];
        }
    });
    return result;
}

// Type guard function to check if metadata has content
export function hasContent(metadata: any): metadata is { content: string } {
    return (
        (metadata.__typename === "ArticleMetadata" ||
            metadata.__typename === "AudioMetadata" ||
            metadata.__typename === "TextOnlyMetadata" ||
            metadata.__typename === "ImageMetadata" ||
            metadata.__typename === "VideoMetadata" ||
            metadata.__typename === "EmbedMetadata" ||
            metadata.__typename === "LivestreamMetadata" ||
            metadata.__typename === "MintMetadata" ||
            metadata.__typename === "SpaceMetadata" ||
            metadata.__typename === "StoryMetadata" ||
            metadata.__typename === "ThreeDMetadata" ||
            metadata.__typename === "TransactionMetadata") &&
        typeof metadata.content === "string"
    );
}
