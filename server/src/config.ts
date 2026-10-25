import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MAX_PAYLOAD_SIZE_BYTES: z.coerce.number().default(16384),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().default(60000),
  PAIRING_TOKEN_TTL_SECONDS: z.coerce.number().default(300),
  MESSAGE_QUEUE_TTL_SECONDS: z.coerce.number().default(300),
  MAX_QUEUED_MESSAGES_PER_RECEIVER: z.coerce.number().default(20),
  DATA_FILE_PATH: z.string().optional()
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
