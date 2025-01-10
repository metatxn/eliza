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

    async uploadJson(
        json: Record<string, any> | string
    ): Promise<UploadResponse> {
        try {
            elizaLogger.debug("Attempting to upload JSON:", json);
            const resource = await this.lensStorage.uploadAsJson(json);
            elizaLogger.debug("Upload JSON response:", resource);
            return {
                url: resource.gatewayUrl,
            };
        } catch (error: any) {
            elizaLogger.error("Detailed JSON upload error:", {
                name: error.name,
                message: error.message,
                stack: error.stack,
            });
            throw new Error(
                `Failed to upload JSON using lens-storage: ${error.message}`
            );
        }
    }
}
