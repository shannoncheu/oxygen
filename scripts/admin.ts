import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createAdministrator, resetAdministrator } from '../lib/server/admin';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

function secret(prompt: string): Promise<string> {
  if (!stdin.isTTY)
    throw new Error(
      '请在交互式终端运行，密码不会显示。Docker 请使用 docker compose exec app npm run admin -- create。',
    );
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function cleanup() {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    }
    function onData(chunk: Buffer) {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('操作已取消。'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    }
    stdin.on('data', onData);
  });
}
async function main() {
  const command = process.argv[2];
  if (command !== 'create' && command !== 'reset')
    throw new Error('用法：npm run admin -- create 或 npm run admin -- reset');
  let username = '';
  if (command === 'create') {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    username = (await rl.question('管理员账号：')).trim();
    rl.close();
  }
  const password = await secret(
    command === 'create'
      ? '密码（至少 12 个字符，不显示）：'
      : '新密码（至少 12 个字符，不显示）：',
  );
  const confirmation = await secret('再次输入密码：');
  if (password !== confirmation) throw new Error('两次密码不一致。');
  if (command === 'create') await createAdministrator(username, password);
  else await resetAdministrator(password);
  console.log(
    command === 'create' ? '管理员创建完成。请通过站点登录。' : '密码已重置，全部现有会话已失效。',
  );
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : '管理员操作失败。');
    process.exit(1);
  });
