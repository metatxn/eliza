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
        // Convert to string if object
        elizaLogger.debug("lens storage: ", this.lensStorage);
        const object =
            typeof json === "string" ? JSON.parse(json) : JSON.stringify(json);

        elizaLogger.debug("object in lens uploadJson: ", object, typeof object);
        const resource = await this.lensStorage.uploadAsJson(object);

        return {
            url: resource.gatewayUrl,
        };
    }
}
