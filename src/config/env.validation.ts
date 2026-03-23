import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(5000),
  API_PREFIX: Joi.string().default('api'),

  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SYNC: Joi.boolean().default(false),

  LLM_BASE_URL: Joi.string().uri().required(),
  LLM_MODEL: Joi.string().required(),
  LLM_API_KEY: Joi.string().allow('').default('local-llama'),

  AGENT_MAX_STEPS: Joi.number().integer().min(1).max(32).default(8),
  AGENT_DEFAULT_DOMAIN: Joi.string().default('general'),

  REQUEST_TIMEOUT_MS: Joi.number().default(30000),
  SEMRUSH_COOKIE: Joi.string().allow('').optional(),
  SEMRUSH_COOKIE_FILE: Joi.string().default('src/config/cookie-semrush.txt'),
});
