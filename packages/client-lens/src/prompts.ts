import {
    Character,
    elizaLogger,
    messageCompletionFooter,
    shouldRespondFooter,
} from "@elizaos/core";
import { AnyPost } from "@lens-protocol/client";
import { hasContent } from "./utils";

export const formatPost = (post: AnyPost): string => {
    // Early return if not a Post type
    if (post.__typename !== "Post") {
        elizaLogger.warn("Received non-Post type", { type: post.__typename });
        return "Invalid post format";
    }

    // Get values with fallbacks
    const authorName = post.author?.metadata?.name || "Unknown";
    const username = post.author?.username?.localName || "unknown";
    const replyToUsername = post.commentOn?.author?.username?.localName;
    const content =
        post.metadata && hasContent(post.metadata)
            ? post.metadata.content
            : "No content available";

    // Build the response string
    return `ID: ${post.id}
From: ${authorName} (@${username})${replyToUsername ? `\nIn reply to: @${replyToUsername}` : ""}
Text: ${content}`;
};

export const formatTimeline = (
    character: Character,
    timeline: AnyPost[]
) => `# ${character.name}'s Home Timeline
${timeline.map(formatPost).join("\n")}
`;

export const headerTemplate = `
{{timeline}}

# Knowledge
{{knowledge}}

About {{agentName}} (@{{lensHandle}}):
{{bio}}
{{lore}}
{{postDirections}}

{{providers}}

{{recentPosts}}

{{characterPostExamples}}`;

export const postTemplate =
    headerTemplate +
    `
# Task: Generate a post in the voice and style of {{agentName}}, aka @{{lensHandle}}
Write a single sentence post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}.
Try to write something totally different than previous posts. Do not add commentary or ackwowledge this request, just write the post.

Your response should not contain any questions. Brief, concise statements only. No emojis. Use \\n\\n (double spaces) between statements.`;

export const messageHandlerTemplate =
    headerTemplate +
    `
Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

Thread of posts You Are Replying To:
{{formattedConversation}}

# Task: Generate a post in the voice, style and perspective of {{agentName}} (@{{lensHandle}}):
{{currentPost}}` +
    messageCompletionFooter;

export const shouldRespondTemplate =
    `# Task: Decide if {{agentName}} should respond.
    About {{agentName}}:
    {{bio}}

    # INSTRUCTIONS: Determine if {{agentName}} (@{{lensHandle}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "RESPOND" or "IGNORE" or "STOP".

Response options are RESPOND, IGNORE and STOP.

{{agentName}} has zero tolerance for racism, discrimination, or disrespectful language. {{agentName}} should RESPOND to any messages containing discriminatory content, hate speech, or harmful stereotypes to promote respectful dialogue and support affected individuals.
{{agentName}} should RESPOND to messages when someone ask about strength training.
{{agentName}} should respond to messages that are directed at them, or participate in conversations that are interesting or relevant to their background, IGNORE messages that are irrelevant to them, and should STOP if the conversation is concluded.

{{agentName}} is in a room with other users and wants to be conversational, but not annoying.
{{agentName}} should RESPOND to messages that are directed at them, or participate in conversations that are interesting or relevant to their background.
{{agentName}} should RESPOND when someone shares experiences of discrimination or when support is needed.
{{agentName}} should always maintain respectful language and promote positive dialogue.
If a message is not interesting or relevant, {{agentName}} should IGNORE.
If a message thread has become repetitive, {{agentName}} should IGNORE.
Unless directly RESPONDing to a user, {{agentName}} should IGNORE messages that are very short or do not contain much information.
If someone uses disrespectful language or promotes harmful stereotypes, {{agentName}} should RESPOND with educational and constructive dialogue.
If a user asks {{agentName}} to stop talking, {{agentName}} should STOP.
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, {{agentName}} should STOP.

IMPORTANT: {{agentName}} (aka @{{lensHandle}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND. However, {{agentName}} will not ignore discriminatory content or disrespectful language, as maintaining a respectful and inclusive environment takes priority.

Thread of messages You Are Replying To:
{{formattedConversation}}

Current message:
{{currentPost}}

` + shouldRespondFooter;
