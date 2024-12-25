import { EvmAddress, Role, UUID } from "@lens-protocol/client";
import {
    FollowResponse,
    PostResponse,
    SelfFundedTransactionRequest,
    SponsoredTransactionRequest,
    TransactionWillFail,
    UnfollowResponse,
    DeletePostResponse,
} from "@lens-protocol/client";

export type operationResultType =
    | PostResponse
    | FollowResponse
    | UnfollowResponse
    | DeletePostResponse
    | SponsoredTransactionRequest
    | SelfFundedTransactionRequest
    | TransactionWillFail;

export type UserAccount = {
    usernameId?: string | null;
    address: EvmAddress;
    name?: string | null;
    localName?: string;
    namespace?: string;
    picture?: string;
    bio?: string | null;
    cover?: string | null;
    url?: string;
};

export type BroadcastResult = {
    id?: string;
    txId?: string;
};

export type AccountOwner = {
    role: Role.AccountOwner;
    authentication_id: UUID;
    account: EvmAddress;
    app: EvmAddress;
    owner: EvmAddress;
    sponsored: boolean;
};
