import { z } from "zod";

// Shared validation for Ethereum addresses
const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
const ethAddressSchema = z
    .string()
    .regex(ethAddressRegex, "Must be a valid Ethereum address")
    .describe("Ethereum address starting with 0x");

// Amount validation
const amountSchema = z
    .string()
    .regex(/^\d*\.?\d+$/, "Must be a valid number string")
    .describe('Amount in string format (e.g. "0.1")');

// Transfer Params Schema
export const transferParamsSchema = z.object({
    fromChain: z.string(), // Should be SupportedChain
    toAddress: ethAddressSchema,
    amount: amountSchema,
    data: z
        .string()
        .regex(/^0x[a-fA-F0-9]*$/)
        .optional(),
});

// In schemas.ts
export const swapParamsSchema = z.object({
    chain: z.string().describe("Chain to execute the swap on"),
    fromToken: z.string().describe("Token to swap from"),
    toToken: z.string().describe("Token to swap to"),
    amount: z.string().regex(/^\d*\.?\d+$/, "Must be a valid number string"),
    slippage: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .default(0.5)
        .describe("Slippage tolerance percentage"),
});

export const bridgeParamsSchema = z.object({
    fromChain: z.string().describe("Source chain for the bridge"),
    toChain: z.string().describe("Destination chain for the bridge"),
    fromToken: ethAddressSchema,
    toToken: ethAddressSchema,
    amount: amountSchema,
    toAddress: ethAddressSchema.optional(),
});

// Type inference
export type TransferParamsSchema = z.infer<typeof transferParamsSchema>;
export type BridgeParamsSchema = z.infer<typeof bridgeParamsSchema>;
export type SwapParamsSchema = z.infer<typeof swapParamsSchema>;
