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

            // Make direct fetch request matching the curl format
            const response = await fetch(
                "https://storage-api.testnet.lens.dev",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body:
                        typeof json === "string" ? json : JSON.stringify(json),
                }
            );

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Upload failed: ${text}`);
            }

            const [data] = await response.json();
            elizaLogger.debug("Upload JSON response:", data);

            return {
                url: data.gateway_url,
                cid: data.storage_key,
            };
        } catch (error: any) {
            elizaLogger.error("Detailed JSON upload error:", {
                name: error.name,
                message: error.message,
                stack: error.stack,
            });
            throw error;
        }
    }
}
