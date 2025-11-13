import { Message } from "@prisma/client";
export type ChatScope = "group" | "channel" | "direct" | "unknown";
export type TimeRange = {
    from: Date;
    to: Date;
};
export type DigestOptions = {
    audienceUserId?: number | string;
    includeActionItems?: boolean;
    includeDeadlines?: boolean;
};
export type AssistantAnswer = {
    title: string;
    body: string;
    attachments?: Array<{
        title: string;
        url?: string;
        messageId?: string;
    }>;
};
export type ParsedTask = {
    title: string;
    description?: string;
    dueDate?: Date;
    assigneeId?: number | string;
    assigneeName?: string;
};
export type MessageWithContext = Message & {
    link?: {
        type: "reply" | "forward";
        messageId?: string;
    };
};
export type MaterialInfo = {
    title: string;
    link?: string;
    messageId: string;
    type?: "image" | "file" | "video" | "share";
    fileName?: string;
    fileType?: string;
    description?: string;
};
//# sourceMappingURL=types.d.ts.map