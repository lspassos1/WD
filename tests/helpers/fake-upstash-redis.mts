export interface FakeRedisSortedSetEntry {
  member: string;
  score: number;
}

export interface FakeRedisState {
  fetchImpl: typeof fetch;
  redis: Map<string, string>;
  sortedSets: Map<string, FakeRedisSortedSetEntry[]>;
  expires: Map<string, number>;
}

export interface ParsedRedisCommand {
  verb: string;
  key: string;
  args: Array<string | number>;
}

export function parseRedisCommand(input: RequestInfo | URL, init?: RequestInit): ParsedRedisCommand | null {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const parsed = new URL(url);

  if (parsed.pathname.startsWith('/get/')) {
    return {
      verb: 'GET',
      key: decodeURIComponent(parsed.pathname.slice('/get/'.length)),
      args: [],
    };
  }

  if (parsed.pathname.startsWith('/set/')) {
    const parts = parsed.pathname.split('/');
    return {
      verb: 'SET',
      key: decodeURIComponent(parts[2] || ''),
      args: [decodeURIComponent(parts[3] || ''), ...parts.slice(4)],
    };
  }

  if ((parsed.pathname === '/' || parsed.pathname === '') && typeof init?.body === 'string') {
    const command = JSON.parse(init.body) as unknown;
    if (Array.isArray(command) && command.length > 0) {
      const verb = String(command[0] ?? '').toUpperCase();
      if (verb === 'EVAL') {
        return {
          verb,
          key: String(command[3] ?? ''),
          args: command.slice(4).map((value) => typeof value === 'string' || typeof value === 'number' ? value : String(value)),
        };
      }
      return {
        verb,
        key: typeof command[1] === 'string' ? command[1] : '',
        args: command.slice(2).map((value) => typeof value === 'string' || typeof value === 'number' ? value : String(value)),
      };
    }
  }

  return null;
}

export function createRedisFetch(fixtures: Record<string, unknown>): FakeRedisState {
  const redis = new Map<string, string>();
  const sortedSets = new Map<string, FakeRedisSortedSetEntry[]>();
  const expires = new Map<string, number>();

  for (const [key, value] of Object.entries(fixtures)) {
    redis.set(key, JSON.stringify(value));
  }

  const upsertSortedSet = (key: string, score: number, member: string) => {
    const next = (sortedSets.get(key) ?? []).filter((item) => item.member !== member);
    next.push({ member, score });
    next.sort((left, right) => left.score - right.score || left.member.localeCompare(right.member));
    sortedSets.set(key, next);
  };

  const removeByRank = (key: string, start: number, stop: number) => {
    const items = [...(sortedSets.get(key) ?? [])];
    if (items.length === 0) return;

    const normalizeIndex = (index: number) => (index < 0 ? items.length + index : index);
    const startIndex = Math.max(0, normalizeIndex(start));
    const stopIndex = Math.min(items.length - 1, normalizeIndex(stop));
    if (startIndex > stopIndex) return;
    items.splice(startIndex, stopIndex - startIndex + 1);
    sortedSets.set(key, items);
  };

  const readByRank = (key: string, start: number, stop: number) => {
    const items = [...(sortedSets.get(key) ?? [])];
    if (items.length === 0) return [];

    const normalizeIndex = (index: number) => (index < 0 ? items.length + index : index);
    const startIndex = Math.max(0, normalizeIndex(start));
    const stopIndex = Math.min(items.length - 1, normalizeIndex(stop));
    if (startIndex > stopIndex) return [];
    return items.slice(startIndex, stopIndex + 1);
  };

  const purgeIfExpired = (key: string) => {
    const expiresAt = expires.get(key);
    if (expiresAt != null && expiresAt <= Date.now()) {
      redis.delete(key);
      expires.delete(key);
      sortedSets.delete(key);
    }
  };

  const readString = (key: string) => {
    purgeIfExpired(key);
    return redis.get(key) ?? null;
  };

  const writeString = (key: string, value: string, args: Array<string | number>) => {
    purgeIfExpired(key);

    const flags = args.map((item) => String(item).toUpperCase());
    const nx = flags.includes('NX');
    if (nx && redis.has(key)) {
      return { result: null };
    }

    redis.set(key, value);
    expires.delete(key);

    const exIndex = flags.indexOf('EX');
    if (exIndex !== -1) {
      const ttlSeconds = Number(args[exIndex + 1] ?? 0);
      expires.set(key, Date.now() + ttlSeconds * 1000);
    }

    const pxIndex = flags.indexOf('PX');
    if (pxIndex !== -1) {
      const ttlMs = Number(args[pxIndex + 1] ?? 0);
      expires.set(key, Date.now() + ttlMs);
    }

    return { result: 'OK' };
  };

  const deleteKey = (key: string) => {
    purgeIfExpired(key);
    const existed = redis.delete(key);
    expires.delete(key);
    sortedSets.delete(key);
    return { result: existed ? 1 : 0 };
  };

  const executeCommand = (command: Array<string | number>) => {
    const [verb, ...rest] = command;
    const op = String(verb).toUpperCase();

    if (op === 'GET') {
      const key = String(rest[0] ?? '');
      return { result: readString(key) };
    }

    if (op === 'SET') {
      const key = String(rest[0] ?? '');
      const value = String(rest[1] ?? '');
      return writeString(key, value, rest.slice(2));
    }

    if (op === 'DEL') {
      return deleteKey(String(rest[0] ?? ''));
    }

    if (op === 'EVAL') {
      const key = String(rest[2] ?? '');
      const token = String(rest[3] ?? '');
      if (readString(key) === token) {
        return deleteKey(key);
      }
      return { result: 0 };
    }

    const redisKey = String(rest[0] ?? '');
    return { op, redisKey, args: rest.slice(1) };
  };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith(process.env.UPSTASH_REDIS_REST_URL || '')) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    const parsed = new URL(url);
    const command = parseRedisCommand(url, init);
    if (command?.verb === 'GET') {
      return new Response(JSON.stringify({ result: readString(command.key) }), { status: 200 });
    }

    if (command?.verb === 'SET') {
      return new Response(
        JSON.stringify(writeString(command.key, String(command.args[0] ?? ''), command.args.slice(1))),
        { status: 200 },
      );
    }

    if (command?.verb === 'DEL') {
      return new Response(JSON.stringify(deleteKey(command.key)), { status: 200 });
    }

    if (command?.verb === 'EVAL') {
      const token = String(command.args[0] ?? '');
      if (readString(command.key) === token) {
        return new Response(JSON.stringify(deleteKey(command.key)), { status: 200 });
      }
      return new Response(JSON.stringify({ result: 0 }), { status: 200 });
    }

    if (parsed.pathname === '/' || parsed.pathname === '') {
      const command = JSON.parse(typeof init?.body === 'string' ? init.body : '[]') as Array<string | number>;
      return new Response(JSON.stringify(executeCommand(command)), { status: 200 });
    }

    if (parsed.pathname === '/pipeline') {
      const commands = JSON.parse(typeof init?.body === 'string' ? init.body : '[]') as Array<Array<string | number>>;
      const result = commands.map((command) => {
        const executed = executeCommand(command);
        if ('result' in executed) {
          return executed;
        }

        const { op, redisKey, args } = executed;

        if (op === 'ZADD') {
          let added = 0;
          for (let index = 0; index < args.length; index += 2) {
            const existed = (sortedSets.get(redisKey) ?? []).some((e) => e.member === String(args[index + 1] ?? ''));
            upsertSortedSet(redisKey, Number(args[index] ?? 0), String(args[index + 1] ?? ''));
            if (!existed) added += 1;
          }
          return { result: added };
        }

        if (op === 'ZRANGE') {
          const items = readByRank(redisKey, Number(args[0] ?? 0), Number(args[1] ?? 0));
          const withScores = args.map(String).includes('WITHSCORES');
          if (!withScores) return { result: items.map((item) => item.member) };
          return { result: items.flatMap((item) => [item.member, String(item.score)]) };
        }

        if (op === 'ZREMRANGEBYRANK') {
          const before = (sortedSets.get(redisKey) ?? []).length;
          removeByRank(redisKey, Number(args[0] ?? 0), Number(args[1] ?? 0));
          const after = (sortedSets.get(redisKey) ?? []).length;
          return { result: before - after };
        }

        if (op === 'EXPIRE') {
          expires.set(redisKey, Date.now() + Number(args[0] ?? 0) * 1000);
          return { result: 1 };
        }

        throw new Error(`Unexpected pipeline command: ${op}`);
      });
      return new Response(JSON.stringify(result), { status: 200 });
    }

    throw new Error(`Unexpected Redis path: ${parsed.pathname}`);
  }) as typeof fetch;

  return { fetchImpl, redis, sortedSets, expires };
}

export function installRedis(fixtures: Record<string, unknown>): FakeRedisState {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
  delete process.env.VERCEL_ENV;
  const state = createRedisFetch(fixtures);
  globalThis.fetch = state.fetchImpl;
  return state;
}
