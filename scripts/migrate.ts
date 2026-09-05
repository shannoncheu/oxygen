import { database } from '../lib/server/db';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
database()
  .then(() => {
    console.log('数据库迁移完成。');
    process.exit(0);
  })
  .catch((error) => {
    console.error('数据库迁移失败：', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  });
