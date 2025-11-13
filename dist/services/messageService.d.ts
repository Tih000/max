import type { Message as MaxMessage } from "@maxhub/max-bot-api/dist/core/network/api";
import { Prisma } from "@prisma/client";
export declare class MessageService {
    upsertFromMaxMessage(message: MaxMessage): Promise<(Prisma.Without<Prisma.MessageCreateInput, Prisma.MessageUncheckedCreateInput> & Prisma.MessageUncheckedCreateInput) | (Prisma.Without<Prisma.MessageUncheckedCreateInput, Prisma.MessageCreateInput> & Prisma.MessageCreateInput)>;
    private extractMaterials;
}
export declare const messageService: MessageService;
//# sourceMappingURL=messageService.d.ts.map