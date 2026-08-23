#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  manage-users.mjs — заведение и удаление пользователей.
//
//    node tools/manage-users.mjs list
//    node tools/manage-users.mjs add <логин> [--admin] [--note "текст"]
//    node tools/manage-users.mjs promote <логин>
//    node tools/manage-users.mjs demote <логин>
//    node tools/manage-users.mjs passwd <логин>
//    node tools/manage-users.mjs disable <логин>
//    node tools/manage-users.mjs enable <логин>
//    node tools/manage-users.mjs remove <логин>
//    node tools/manage-users.mjs secret          — новый AUTH_SECRET
//
//  Переменные окружения читаются из .env.local в корне проекта.
//
//  Режим Redis: изменения применяются сразу, передеплой не нужен.
//  Режим AUTH_USERS: скрипт печатает готовую строку, её надо вставить
//  в Vercel и передеплоить.
//
//  Пароли вводятся скрыто и никуда не сохраняются — только их хеши.
// ─────────────────────────────────────────────────────────────────────────────

import { createInterface } from 'node:readline';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── .env.local → process.env ────────────────────────────────────────────────

const envPath = path.join(root, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const { derivePasswordHash, formatPasswordHash } = await import('../lib/auth.js');
const {
  getStoreKind, getRedisConfig, listUsers, getUserRecord,
  saveUserRecord, deleteUserRecord, normalizeUsername
} = await import('../lib/users.js');

const ITERATIONS = 210000;

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`
};

// ── Ввод ────────────────────────────────────────────────────────────────────

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
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

async function askNewPassword() {
  const password = await askHidden('Пароль: ');
  if (password.length < 12) {
    fail(`Пароль слишком короткий (${password.length} символов), нужно минимум 12.`);
  }
  const confirm = await askHidden('Ещё раз: ');
  if (password !== confirm) fail('Пароли не совпали.');
  return password;
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fail(message) {
  console.error('\n' + C.err(message));
  process.exit(1);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, ITERATIONS);
  return formatPasswordHash(ITERATIONS, salt, hash);
}

// ── Запись ──────────────────────────────────────────────────────────────────

const storeKind = getStoreKind();
const isRedis = storeKind === 'redis';

async function persist(users, changed) {
  if (isRedis) {
    await saveUserRecord(changed);
    console.log(`\n${C.ok('Сохранено в Redis.')} Передеплой не нужен, изменение уже действует.\n`);
    return;
  }

  const payload = users.map((u) => ({
    username: u.username,
    passwordHash: u.passwordHash,
    ...(u.disabled ? { disabled: true } : {}),
    ...(u.note ? { note: u.note } : {}),
    ...(u.createdAt ? { createdAt: u.createdAt } : {})
  }));

  console.log('\n' + '─'.repeat(72));
  console.log(C.b('Вставь это целиком в переменную AUTH_USERS на Vercel'));
  console.log('(Settings → Environment Variables), затем сделай Redeploy:');
  console.log('─'.repeat(72) + '\n');
  console.log(JSON.stringify(payload));
  console.log('\n' + '─'.repeat(72));
  console.log(C.warn('Это одна строка — скопируй её без переносов.'));
  console.log('В режиме AUTH_USERS каждый новый пользователь требует передеплоя.');
  console.log('Подключишь Redis — правки станут применяться сразу.');
  console.log('─'.repeat(72) + '\n');
}

// ── Команды ─────────────────────────────────────────────────────────────────

const [command, argument] = process.argv.slice(2);
const noteIndex = process.argv.indexOf('--note');
const note = noteIndex >= 0 ? process.argv[noteIndex + 1] : null;
const wantAdmin = process.argv.includes('--admin');

function describeStore() {
  if (isRedis) return C.ok('Redis') + C.dim(` (${getRedisConfig().url})`);
  if (storeKind === 'env') return C.warn('AUTH_USERS') + C.dim(' — правки требуют передеплоя');
  if (storeKind === 'legacy') return C.warn('AUTH_USERNAME') + C.dim(' — старый одиночный режим');
  return C.err('не настроено');
}

async function requireUser(name) {
  if (!name) fail('Укажи логин.');
  const user = await getUserRecord(name);
  if (!user) fail(`Пользователь «${normalizeUsername(name)}» не найден.`);
  return user;
}

switch (command) {
  case 'list': {
    const users = await listUsers();
    console.log(`\nХранилище: ${describeStore()}`);
    console.log(`Пользователей: ${users.length}\n`);
    if (!users.length) {
      console.log(C.dim('  пусто — заведи первого: node tools/manage-users.mjs add <логин>\n'));
      break;
    }
    for (const user of users) {
      const state = user.disabled ? C.err('отключён') : C.ok('активен  ');
      const role = user.isAdmin ? C.b('[админ]') : '       ';
      const created = user.createdAt ? C.dim(new Date(user.createdAt).toLocaleDateString('ru-RU')) : '';
      console.log(`  ${state} ${role} ${String(user.username).padEnd(20)} ${created} ${user.note ? C.dim('· ' + user.note) : ''}`);
    }
    console.log();
    break;
  }

  case 'add': {
    if (!argument) fail('Укажи логин: node tools/manage-users.mjs add anna');
    const username = normalizeUsername(argument);
    if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
      fail('Логин: 2–32 символа, латиница, цифры, точка, дефис, подчёркивание.');
    }
    if (await getUserRecord(username)) {
      fail(`Пользователь «${username}» уже существует. Сменить пароль: passwd ${username}`);
    }

    console.log(`\nНовый пользователь: ${C.b(username)}`);
    const password = await askNewPassword();

    const record = {
      username,
      passwordHash: await hashPassword(password),
      disabled: false,
      isAdmin: wantAdmin,
      createdAt: new Date().toISOString(),
      ...(note ? { note } : {})
    };

    const users = [...(await listUsers()), record];
    await persist(users, record);
    if (wantAdmin) {
      console.log(C.ok('Администратор.') + ' Панель: /admin.html — дальше пользователей можно');
      console.log('заводить прямо в браузере, без терминала.\n');
    }
    break;
  }

  case 'passwd': {
    const user = await requireUser(argument);
    console.log(`\nНовый пароль для: ${C.b(user.username)}`);
    const password = await askNewPassword();

    const updated = { ...user, passwordHash: await hashPassword(password) };
    const users = (await listUsers()).map((u) =>
      normalizeUsername(u.username) === normalizeUsername(user.username) ? updated : u);

    await persist(users, updated);
    console.log(C.dim('Старая сессия этого пользователя продолжит работать до истечения срока.'));
    console.log(C.dim('Чтобы оборвать её сразу — смени AUTH_SECRET (разлогинит всех).\n'));
    break;
  }

  case 'promote':
  case 'demote': {
    const user = await requireUser(argument);
    const isAdmin = command === 'promote';

    if (!isAdmin) {
      const admins = (await listUsers()).filter((u) => u.isAdmin === true && u.disabled !== true);
      if (admins.length <= 1 && user.isAdmin) {
        fail('Это последний администратор — снимать права нельзя, панель станет недоступна.');
      }
    }

    const updated = { ...user, isAdmin };
    const users = (await listUsers()).map((u) =>
      normalizeUsername(u.username) === normalizeUsername(user.username) ? updated : u);

    await persist(users, updated);
    console.log(`${user.username}: ${isAdmin ? C.ok('администратор') : 'обычный пользователь'}\n`);
    break;
  }

  case 'disable':
  case 'enable': {
    const user = await requireUser(argument);
    const disabled = command === 'disable';
    const updated = { ...user, disabled };
    const users = (await listUsers()).map((u) =>
      normalizeUsername(u.username) === normalizeUsername(user.username) ? updated : u);

    await persist(users, updated);
    console.log(`${user.username}: ${disabled ? C.err('отключён') : C.ok('включён')}`);
    if (disabled) {
      console.log(C.dim('Вход закрыт немедленно. Уже открытая сессия доживёт до истечения срока,'));
      console.log(C.dim('если не включён AUTH_STRICT_SESSION=true.\n'));
    }
    break;
  }

  case 'remove': {
    const user = await requireUser(argument);
    const answer = await ask(`Удалить «${user.username}»? Введи логин для подтверждения: `);
    if (normalizeUsername(answer) !== normalizeUsername(user.username)) {
      fail('Не совпало, ничего не удалено.');
    }

    if (isRedis) {
      await deleteUserRecord(user.username);
      console.log(`\n${C.ok('Удалён из Redis.')}\n`);
    } else {
      const users = (await listUsers())
        .filter((u) => normalizeUsername(u.username) !== normalizeUsername(user.username));
      await persist(users, null);
    }
    console.log(C.dim('Вход закрыт. Активная сессия — см. примечание про AUTH_STRICT_SESSION.\n'));
    break;
  }

  case 'secret': {
    console.log(`\nAUTH_SECRET=${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}\n`);
    console.log(C.warn('Замена этого значения разлогинит всех пользователей разом.\n'));
    break;
  }

  default: {
    console.log(`
${C.b('Управление пользователями')}

  Хранилище: ${describeStore()}

  ${C.b('list')}                     показать всех
  ${C.b('add')} <логин> [--admin]     завести нового
  ${C.b('promote')} <логин>           выдать права администратора
  ${C.b('demote')} <логин>            забрать права
  ${C.b('passwd')} <логин>            сменить пароль
  ${C.b('disable')} <логин>           запретить вход
  ${C.b('enable')} <логин>            разрешить обратно
  ${C.b('remove')} <логин>            удалить
  ${C.b('secret')}                   сгенерировать новый AUTH_SECRET
`);
    if (storeKind === 'none') {
      console.log(C.err('  Хранилище не настроено.'));
      console.log('  Подключи Upstash Redis через Vercel Marketplace, скопируй');
      console.log('  KV_REST_API_URL и KV_REST_API_TOKEN в .env.local, затем:');
      console.log(`  ${C.b('node tools/manage-users.mjs add ты --admin')}\n`);
    } else if (isRedis) {
      const admins = (await listUsers()).filter((u) => u.isAdmin === true);
      if (!admins.length) {
        console.log(C.warn('  Администраторов нет — панель /admin.html никому не доступна.'));
        console.log(`  Выдать права: ${C.b('node tools/manage-users.mjs promote <логин>')}\n`);
      }
    }
  }
}
