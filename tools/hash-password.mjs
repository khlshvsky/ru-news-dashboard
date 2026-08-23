#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  hash-password.mjs — генерация значений для переменных окружения.
//
//  Запуск:
//    node tools/hash-password.mjs
//    node tools/hash-password.mjs --user admin
//
//  Пароль вводится скрыто (не остаётся в history шелла и в ps).
//  Скрипт ничего никуда не отправляет и не пишет на диск — только печатает.
// ─────────────────────────────────────────────────────────────────────────────

import { createInterface } from 'node:readline';
import { derivePasswordHash, formatPasswordHash } from '../lib/auth.js';

const ITERATIONS = 210000;   // рекомендация OWASP для PBKDF2-HMAC-SHA256

const args = process.argv.slice(2);
const userArg = args.indexOf('--user');
const username = userArg >= 0 ? args[userArg + 1] : null;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    const onData = (char) => {
      // Пока пользователь печатает, гасим эхо, чтобы пароль не светился.
      if (['\n', '\r', '\u0004'].includes(String(char))) {
        process.stdin.removeListener('data', onData);
        return;
      }
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(question + '*'.repeat(rl.line.length));
    };

    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const user = username || await ask('Логин: ');
if (!user) {
  console.error('Логин не может быть пустым.');
  process.exit(1);
}

const password = await askHidden('Пароль: ');
if (password.length < 12) {
  console.error(`\nПароль слишком короткий (${password.length} символов).`);
  console.error('Минимум 12. Это единственная преграда между интернетом и твоей лентой,');
  console.error('а перебор PBKDF2 на арендованной видеокарте стоит дешевле обеда.');
  process.exit(1);
}

const confirm = await askHidden('Ещё раз: ');
if (password !== confirm) {
  console.error('\nПароли не совпали.');
  process.exit(1);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const hash = await derivePasswordHash(password, salt, ITERATIONS);
const secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

console.log('\n' + '─'.repeat(72));
console.log('Добавь это в переменные окружения Vercel');
console.log('(Project → Settings → Environment Variables), для всех окружений:');
console.log('─'.repeat(72) + '\n');
console.log(`AUTH_USERNAME=${user}`);
console.log(`AUTH_PASSWORD_HASH=${formatPasswordHash(ITERATIONS, salt, hash)}`);
console.log(`AUTH_SECRET=${secret}`);
console.log('\n' + '─'.repeat(72));
console.log('AUTH_SECRET подписывает сессионные куки. Сменишь его — разлогинятся');
console.log('все сессии разом; это и есть способ выкинуть всех принудительно.');
console.log('Сам пароль нигде не сохранён: восстановить его из хеша нельзя,');
console.log('забудешь — просто сгенерируй новый.');
console.log('─'.repeat(72) + '\n');
