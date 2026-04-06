import { z } from 'zod';

export const CreateItemSchema = z.object({
  subject: z.string().min(1),
  itemType: z.enum(['multiple-choice', 'free-response', 'essay']),
  difficulty: z.number().int().min(1).max(5),
  content: z.object({
    question: z.string().min(1),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string().min(1),
    explanation: z.string().min(1),
  }),
  metadata: z.object({
    author: z.string().min(1),
    status: z.enum(['draft', 'review', 'approved', 'archived']),
    tags: z.array(z.string()),
  }),
  securityLevel: z.enum(['standard', 'secure', 'highly-secure']),
});

export const UpdateItemSchema = z.object({
  subject: z.string().min(1).optional(),
  itemType: z.enum(['multiple-choice', 'free-response', 'essay']).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  content: z.object({
    question: z.string().min(1).optional(),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string().min(1).optional(),
    explanation: z.string().min(1).optional(),
  }).optional(),
  metadata: z.object({
    author: z.string().min(1).optional(),
    status: z.enum(['draft', 'review', 'approved', 'archived']).optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  securityLevel: z.enum(['standard', 'secure', 'highly-secure']).optional(),
});

export const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  subject: z.string().optional(),
  status: z.enum(['draft', 'review', 'approved', 'archived']).optional(),
});

export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
export type ListQueryInput = z.infer<typeof ListQuerySchema>;
