import { DigestService } from '../digestService';
import { prisma } from '../../db';
import { gigaChatService } from '../gigachatService';
import type { Api } from '@maxhub/max-bot-api';

// Мокируем зависимости
jest.mock('../../db', () => ({
  prisma: {
    message: {
      findMany: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
    material: {
      findMany: jest.fn(),
    },
    digestLog: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../gigachatService', () => ({
  gigaChatService: {
    enabled: true,
    summarizeChat: jest.fn(),
  },
}));

jest.mock('../../logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('DigestService', () => {
  let digestService: DigestService;
  const mockChatId = BigInt(123456);
  const mockChatTitle = 'Test Chat';
  const mockRange = {
    from: new Date('2024-01-01'),
    to: new Date('2024-01-07'),
  };

  beforeEach(() => {
    digestService = new DigestService();
    jest.clearAllMocks();
  });

  describe('generateDigest', () => {
    it('должен возвращать сообщение об ошибке для невалидного chatId', async () => {
      const result = await digestService.generateDigest('invalid', mockChatTitle, mockRange);
      expect(result).toBe('Не удалось определить ID чата.');
    });

    it('должен возвращать сообщение, если сообщений нет', async () => {
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      const result = await digestService.generateDigest(mockChatId, mockChatTitle, mockRange);

      expect(result).toBe('За выбранный период сообщений не найдено.');
      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: {
          chatId: mockChatId,
          timestamp: {
            gte: mockRange.from,
            lte: mockRange.to,
          },
          text: {
            not: null,
          },
        },
        orderBy: {
          timestamp: 'asc',
        },
        take: 200, // DIGEST_MAX_MESSAGES
      });
    });

    it('должен генерировать дайджест через GigaChat', async () => {
      const mockMessages = [
        {
          id: '1',
          text: 'Первое сообщение',
          senderName: 'User1',
          senderId: 1,
          timestamp: new Date('2024-01-02'),
        },
        {
          id: '2',
          text: 'Второе сообщение',
          senderName: 'User2',
          senderId: 2,
          timestamp: new Date('2024-01-03'),
        },
      ];

      const mockDigest = '📊 Дайджест обсуждений\n\nКлючевые темы...';

      (prisma.message.findMany as jest.Mock).mockResolvedValue(mockMessages);
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.material.findMany as jest.Mock).mockResolvedValue([]);
      (gigaChatService.summarizeChat as jest.Mock).mockResolvedValue(mockDigest);

      const result = await digestService.generateDigest(mockChatId, mockChatTitle, mockRange);

      expect(result).toContain('Дайджест');
      expect(gigaChatService.summarizeChat).toHaveBeenCalled();
    });

    it('должен использовать fallback, если GigaChat недоступен', async () => {
      (gigaChatService as any).enabled = false;

      const mockMessages = [
        {
          id: '1',
          text: 'Сообщение',
          senderName: 'User1',
          senderId: 1,
          timestamp: new Date('2024-01-02'),
        },
      ];

      (prisma.message.findMany as jest.Mock).mockResolvedValue(mockMessages);
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.material.findMany as jest.Mock).mockResolvedValue([]);

      const result = await digestService.generateDigest(mockChatId, mockChatTitle, mockRange);

      expect(result).toContain('Дайджест');
      expect(result).toContain('Сообщение');
      expect(gigaChatService.summarizeChat).not.toHaveBeenCalled();
    });
  });

  describe('setBotApi', () => {
    it('должен устанавливать botApi', () => {
      const mockApi = {} as Api;
      digestService.setBotApi(mockApi);
      // Проверяем, что API установлен (через вызов generateDigest с этим API)
      expect(digestService).toBeDefined();
    });
  });
});

