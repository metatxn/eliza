import { IAgentRuntime } from "@elizaos/core";

export interface UploadResponse {
    cid?: string | null;
    url: string;
}

export enum StorageProviderEnum {
    PINATA = "pinata",
    STORJ = "storj",
    ARWEAVE = "arweave",
    LENS = "lens-storage",
}

export interface StorageProvider {
    provider: StorageProviderEnum;
    initialize?: () => Promise<void>;
    uploadFile(file: {
        buffer: Buffer;
        originalname: string;
        mimetype: string;
    }): Promise<UploadResponse>;
    uploadJson(json: Record<string, any> | string): Promise<UploadResponse>;
}
