import { TaskService } from '../taskService';
import { prisma } from '../../db';
import { gigaChatService } from '../gigachatService';
import { sanitizeText } from '../../utils/text';

// Мокаем зависимости
jest.mock('../../db', () => ({
  prisma: {
    task: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../gigachatService', () => ({
  gigaChatService: {
    enabled: true,
    extractTasks: jest.fn(),
  },
}));

jest.mock('../../utils/text', () => ({
  sanitizeText: jest.fn(),
}));

jest.mock('../../logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../preferenceService', () => ({
  preferenceService: {
    getReminderOffset: jest.fn().mockResolvedValue(120),
  },
}));

jest.mock('../reminderService', () => ({
  reminderService: {
    createReminder: jest.fn(),
  },
}));

describe('TaskService', () => {
  let taskService: TaskService;

  beforeEach(() => {
    taskService = new TaskService();
    jest.clearAllMocks();
  });

  describe('processIncomingMessage', () => {
    const mockMessage = {
      body: {
        text: 'Нужно сделать задачу до завтра',
      },
      recipient: {
        chat_id: '123456789',
      },
      sender: {
        user_id: 1,
      },
    } as any;

    it('должен возвращать пустой массив, если текст пустой', async () => {
      (sanitizeText as jest.Mock).mockReturnValue('');
      
      const result = await taskService.processIncomingMessage(mockMessage);
      
      expect(result).toEqual([]);
    });

    it('должен возвращать пустой массив, если GigaChat не включен', async () => {
      (sanitizeText as jest.Mock).mockReturnValue('test message');
      (gigaChatService.enabled as any) = false;
      
      const result = await taskService.processIncomingMessage(mockMessage);
      
      expect(result).toEqual([]);
    });

    it('должен обрабатывать сообщение с валидным текстом', async () => {
      (sanitizeText as jest.Mock).mockReturnValue('Нужно сделать задачу до завтра');
      (gigaChatService.enabled as any) = true;
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);
      (gigaChatService.extractTasks as jest.Mock).mockResolvedValue([]);
      
      const result = await taskService.processIncomingMessage(mockMessage);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getUpcomingTasks', () => {
    it('должен возвращать задачи за период', async () => {
      const mockTasks = [
        {
          id: '1',
          title: 'Test Task',
          dueDate: new Date('2024-01-20'),
          reminders: [],
        },
      ];
      
      (prisma.task.findMany as jest.Mock).mockResolvedValue(mockTasks);
      
      const result = await taskService.getUpcomingTasks(
        BigInt(123456789),
        new Date('2024-01-25')
      );
      
      expect(result).toEqual(mockTasks);
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            chatId: BigInt(123456789),
          }),
        })
      );
    });

    it('должен возвращать пустой массив для невалидного chatId', async () => {
      const result = await taskService.getUpcomingTasks(null as any, new Date());
      
      expect(result).toEqual([]);
      expect(prisma.task.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getPersonalTasks', () => {
    it('должен возвращать персональные задачи пользователя', async () => {
      const mockTasks = [
        {
          id: '1',
          title: 'My Task',
          assigneeId: 1,
          dueDate: new Date('2024-01-20'),
          reminders: [],
        },
      ];
      
      (prisma.task.findMany as jest.Mock).mockResolvedValue(mockTasks);
      
      const result = await taskService.getPersonalTasks(1, new Date('2024-01-25'));
      
      expect(result).toEqual(mockTasks);
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { assigneeId: 1 },
              { createdByUserId: 1 },
            ]),
          }),
        })
      );
    });

    it('должен возвращать пустой массив для невалидного userId', async () => {
      const result = await taskService.getPersonalTasks(null as any, new Date());
      
      expect(result).toEqual([]);
      expect(prisma.task.findMany).not.toHaveBeenCalled();
    });
  });
});
