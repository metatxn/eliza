import { elizaLogger } from "@elizaos/core";
import {
    StorageProvider,
    StorageProviderEnum,
    UploadResponse,
} from "./StorageProvider";
import { StorageClient, testnet } from "@lens-protocol/storage-node-client";

export class LensStorageProvider implements StorageProvider {
    provider = StorageProviderEnum.LENS;
    private lensStorage: StorageClient;

    constructor() {
        // Initialize Lens Storage client
        this.lensStorage = StorageClient.create(testnet);
        elizaLogger.debug("lensStorage constructer: ", this.lensStorage);
    }

    async uploadFile(file: {
        buffer: Buffer;
        originalname: string;
        mimetype: string;
    }): Promise<UploadResponse> {
        try {
            const fileToUpload = new File([file.buffer], file.originalname, {
                type: file.mimetype,
            });

            const resource = await this.lensStorage.uploadFile(fileToUpload);
            return {
                url: resource.gatewayUrl,
            };
        } catch {
            throw new Error(`Failed to upload file using lens-storage`);
        }
    }

    async uploadJson(json: unknown): Promise<UploadResponse> {
        try {
            elizaLogger.debug("Starting upload with JSON:", json);

            const result = await this.lensStorage.uploadAsJson(json);
            elizaLogger.debug("Upload successful:", result);

            return {
                cid: result.storageKey,
                url: result.gatewayUrl,
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            elizaLogger.error("Upload failed:", {
                step: "uploadJson",
                nodeVersion: process.version,
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                },
            });

            if (error.name === "StorageClientError") {
                elizaLogger.error("Storage client error:", error.message);
            }

            throw error;
        }
    }
}
