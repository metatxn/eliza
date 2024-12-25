import { EvmAddress, Role, UUID } from "@lens-protocol/client";

export type Profile = {
    id: string;
    profileId: string;
    name?: string | null;
    handle?: string;
    pfp?: string;
    bio?: string | null;
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
