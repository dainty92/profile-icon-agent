
import { Mastra } from '@mastra/core/mastra';
import { createLogger } from '@mastra/core/logger';

import { profileIconAgent } from './agents';

export const mastra = new Mastra({
  agents: { profileIconAgent },
  logger: createLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
