import { randomUUID } from 'node:crypto';
import { autoRetry } from '@grammyjs/auto-retry';
import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy';
import { type UserFromGetMe } from 'grammy/types';
import { type ExerciseDefinition, type ExerciseDefinitionId } from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import {
  detectStrongFormat,
  extractHevy,
  extractStrong,
  extractTelegram,
  libraryMatch,
  libraryResolver,
  looksLikeHevyExport,
  readHeader,
  sniffDelimiter,
  UnsupportedExportFormat,
  type ExerciseResolver,
  type SourceExtraction,
} from '@ferrum/importers';
import { toWireEvent } from '@ferrum/sync-protocol';
import { type Database } from '../db.ts';
import { EventLogTooLargeError, loadUserEvents } from '../sync.ts';
import { latestFinishedSession } from './history.ts';
import { importForUser, type BotImportOutcome } from './imports.ts';
import { nextForExercise } from './next.ts';
import {
  escapeHtml,
  renderImportReport,
  renderLastPerformances,
  renderRecommendation,
  renderSummary,
} from './render.ts';
import { parseShorthand } from './shorthand.ts';
import {
  bindTelegramIdentity,
  chatTzOffsetMinutes,
  consumeLinkToken,
  deletePending,
  findOrCreateTelegramUser,
  setChatTzOffsetMinutes,
  loadPending,
  savePending,
  upsertChat,
  userForChat,
  type PendingShorthand,
} from './store.ts';

export interface TelegramBotOptions {
  readonly token: string;
  readonly db: Database;
  readonly fileApiRoot?: string;
  readonly botInfo?: UserFromGetMe;
}

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

const WELCOME = [
  'Ferrum bot at your service.',
  '/summary — your last finished workout',
  '/next <exercise> — what to do next for that exercise',
  '/export — your full event log as a JSON file',
  '/tz +3 — set your UTC offset so sets land on your local day',
  'Send a Hevy or Strong CSV export to import your history.',
  'Type sets like "bench press 100x5 @2" (one per line) to log them.',
].join('\n');

const SHORTHAND_HELP =
  'To log sets, write one per line as "<exercise> <kg>x<reps>", optionally "@<reps in reserve>". Example:\nbench press 100x5 @2';

export function createTelegramBot(options: TelegramBotOptions): Bot {
  const { token, db } = options;
  const fileApiRoot = options.fileApiRoot ?? 'https://api.telegram.org';
  const library = loadExerciseLibrary();
  const bot = new Bot(
    token,
    options.botInfo === undefined ? undefined : { botInfo: options.botInfo }
  );
  bot.api.config.use(autoRetry());
  // Without a catch-all, a handler error becomes a webhook 500 and Telegram
  // redelivers the update — a retry storm against whatever just failed.
  bot.catch(error => {
    if (error.error instanceof EventLogTooLargeError) {
      void error.ctx.reply('This history is too large to process over chat; use the app for it.');
      return;
    }
    console.error('telegram handler error', error);
  });

  // Everything is private-chat only: in a group, commands and callback taps
  // arrive from ANY member, and authorizing on chat id would let one member
  // read or write another member's training log.
  async function requireUser(ctx: Context): Promise<string | null> {
    if (ctx.chat?.type !== 'private') return null;
    const chatId = ctx.chat.id;
    const userId = await userForChat(db, chatId);
    if (userId == null) await ctx.reply('Send /start first, then try again.');
    return userId;
  }

  bot.command('start', async ctx => {
    const from = ctx.from;
    const chatId = ctx.chat.id;
    if (from === undefined) return;
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Ferrum works in a private chat only. Message me directly.');
      return;
    }
    const payload = ctx.match.trim();
    if (payload.length > 0) {
      const linkedUserId = await consumeLinkToken(db, payload);
      if (linkedUserId == null) {
        await ctx.reply(
          'That link token is invalid, used or expired. Mint a fresh one and try again.'
        );
        return;
      }
      await bindTelegramIdentity(db, linkedUserId, String(from.id));
      await upsertChat(db, chatId, linkedUserId);
      await ctx.reply(`Linked to your existing account.\n${WELCOME}`);
      return;
    }
    const userId = await findOrCreateTelegramUser(db, String(from.id));
    await upsertChat(db, chatId, userId);
    await ctx.reply(WELCOME);
  });

  bot.command('tz', async ctx => {
    const userId = await requireUser(ctx);
    if (userId == null) return;
    const offset = parseTzOffset(ctx.match.trim());
    if (offset == null) {
      await ctx.reply('Usage: /tz <UTC offset>, e.g. /tz +3, /tz -4, /tz +5:30');
      return;
    }
    await setChatTzOffsetMinutes(db, ctx.chat.id, offset);
    await ctx.reply(
      `Timezone set to UTC${formatTzOffset(offset)}. Logged sets now land on your local day.`
    );
  });

  bot.command('summary', async ctx => {
    const userId = await requireUser(ctx);
    if (userId == null) return;
    const events = await loadUserEvents(db, userId);
    const latest = latestFinishedSession(events);
    if (latest == null) {
      await ctx.reply('No finished workout yet. Import a CSV or log some sets first.');
      return;
    }
    await ctx.reply(renderSummary(latest, library), { parse_mode: 'HTML' });
  });

  bot.command('next', async ctx => {
    const userId = await requireUser(ctx);
    if (userId == null) return;
    const query = ctx.match.trim();
    if (query.length === 0) {
      await ctx.reply('Usage: /next <exercise name>, e.g. /next bench press barbell');
      return;
    }
    const events = await loadUserEvents(db, userId);
    const outcome = nextForExercise(library, events, query);
    switch (outcome.kind) {
      case 'unknown_exercise':
        await ctx.reply(`I could not match "${outcome.query}" to any exercise in the library.`);
        return;
      case 'no_history':
        await ctx.reply(
          `${assumingLine(outcome.assuming)}No comparable history for ${outcome.name} yet, so there is nothing to recommend from.`
        );
        return;
      case 'no_prescription':
        await ctx.reply(
          assumingLine(outcome.assuming) + renderLastPerformances(outcome.name, outcome.sessions),
          { parse_mode: 'HTML' }
        );
        return;
      case 'recommendation':
        await ctx.reply(
          assumingLine(outcome.assuming) +
            renderRecommendation(outcome.name, outcome.recommendation),
          { parse_mode: 'HTML' }
        );
        return;
    }
  });

  bot.command('export', async ctx => {
    const userId = await requireUser(ctx);
    if (userId == null) return;
    const events = await loadUserEvents(db, userId);
    const json = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        count: events.length,
        events: events.map(toWireEvent),
      },
      null,
      2
    );
    await ctx.replyWithDocument(
      new InputFile(new TextEncoder().encode(json), 'ferrum-events.json')
    );
  });

  bot.on('message:document', async ctx => {
    const userId = await requireUser(ctx);
    if (userId == null) return;
    const document = ctx.message.document;
    if (document.file_size != null && document.file_size > MAX_IMPORT_FILE_BYTES) {
      await ctx.reply(
        'That file is larger than 10 MB, which no workout CSV export is. Refusing to download it.'
      );
      return;
    }
    const file = await ctx.api.getFile(document.file_id);
    const filePath = file.file_path;
    if (filePath == null) {
      await ctx.reply('Telegram returned no download path for that file; please resend it.');
      return;
    }
    if (file.file_size != null && file.file_size > MAX_IMPORT_FILE_BYTES) {
      await ctx.reply(
        'That file is larger than 10 MB, which no workout CSV export is. Refusing to download it.'
      );
      return;
    }
    const response = await fetch(`${fileApiRoot}/file/bot${token}/${filePath}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await ctx.reply(
        `Downloading the file failed with status ${response.status}; please resend it.`
      );
      return;
    }
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > MAX_IMPORT_FILE_BYTES) {
      await ctx.reply(
        'That file is larger than 10 MB, which no workout CSV export is. Refusing to download it.'
      );
      return;
    }
    const text = await response.text();

    let extraction: SourceExtraction | null;
    try {
      extraction = detectAndExtract(text);
    } catch (error) {
      if (error instanceof UnsupportedExportFormat) {
        await ctx.reply(error.message);
        return;
      }
      throw error;
    }
    if (extraction == null) {
      await ctx.reply(
        'This does not look like a Hevy or Strong workout export. Send the CSV produced by "Export workout data" in either app.'
      );
      return;
    }
    const outcome = await importForUser(db, userId, extraction, libraryResolver(library));
    await ctx.reply(importReply(outcome), { parse_mode: 'HTML' });
  });

  bot.on('message:text', async ctx => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    const userId = await requireUser(ctx);
    if (userId == null) return;

    const parsed = parseShorthand(text);
    if (parsed.lines.length === 0) {
      await ctx.reply(SHORTHAND_HELP);
      return;
    }
    if (parsed.rejectedLines.length > 0) {
      await ctx.reply(
        `I could not read these lines, so nothing was logged:\n${parsed.rejectedLines.join('\n')}\n${SHORTHAND_HELP}`
      );
      return;
    }

    const tzOffsetMinutes = await chatTzOffsetMinutes(db, ctx.chat.id);
    const pending: PendingShorthand = {
      kind: 'shorthand',
      messageId: ctx.message.message_id,
      chatId: ctx.chat.id,
      date: localDayOf(ctx.message.date, tzOffsetMinutes),
      tzOffsetMinutes,
      lines: parsed.lines,
      overrides: {},
    };
    await promptForPending(ctx, randomUUID().slice(0, 8), pending);
  });

  bot.on('callback_query:data', async ctx => {
    const [verb, pendingId, ...rest] = ctx.callbackQuery.data.split(':');
    const chatId = ctx.chatId;
    if (verb == null || pendingId == null || chatId == null || ctx.chat?.type !== 'private') {
      await ctx.answerCallbackQuery();
      return;
    }
    const userId = await userForChat(db, chatId);
    if (userId == null) {
      await ctx.answerCallbackQuery({ text: 'Send /start first.' });
      return;
    }
    const pending = await loadPending(db, pendingId, chatId);
    if (pending == null) {
      await ctx.answerCallbackQuery({ text: 'This prompt has expired.' });
      return;
    }

    if (verb === 'no') {
      await deletePending(db, pendingId);
      await ctx.editMessageText('Cancelled — nothing was logged.');
      await ctx.answerCallbackQuery();
      return;
    }

    if (verb === 'pk') {
      const definition = library.byId.get(rest.join(':') as ExerciseDefinitionId);
      const name = firstUnresolvedName(pending);
      if (definition === undefined || name == null) {
        await ctx.answerCallbackQuery({ text: 'That choice is no longer valid.' });
        return;
      }
      const updated: PendingShorthand = {
        ...pending,
        overrides: { ...pending.overrides, [name]: definition.id },
      };
      const nextUnresolved = firstUnresolvedName(updated);
      if (nextUnresolved != null) {
        await savePending(db, pendingId, chatId, updated);
        const keyboard = suggestionKeyboard(pendingId, library.search(nextUnresolved).slice(0, 3));
        await ctx.editMessageText(`I do not know "${nextUnresolved}". Did you mean:`, {
          reply_markup: keyboard,
        });
        await ctx.answerCallbackQuery();
        return;
      }
      await runPendingImport(ctx, userId, pendingId, updated);
      return;
    }

    if (verb === 'ok') {
      await runPendingImport(ctx, userId, pendingId, pending);
      return;
    }
    await ctx.answerCallbackQuery();
  });

  async function promptForPending(
    ctx: Context,
    pendingId: string,
    pending: PendingShorthand
  ): Promise<void> {
    const unresolvedName = firstUnresolvedName(pending);
    if (unresolvedName == null) {
      await savePending(db, pendingId, pending.chatId, pending);
      await ctx.reply(previewText(pending), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('Confirm', `ok:${pendingId}`)
          .text('Cancel', `no:${pendingId}`),
      });
      return;
    }
    const suggestions = library.search(unresolvedName).slice(0, 3);
    if (suggestions.length === 0) {
      await ctx.reply(
        `I do not know "${unresolvedName}" and found nothing similar in the library. Fix the name and resend; nothing was logged.`
      );
      return;
    }
    await savePending(db, pendingId, pending.chatId, pending);
    await ctx.reply(`I do not know "${unresolvedName}". Did you mean:`, {
      reply_markup: suggestionKeyboard(pendingId, suggestions),
    });
  }

  async function runPendingImport(
    ctx: Context,
    userId: string,
    pendingId: string,
    pending: PendingShorthand
  ): Promise<void> {
    const extraction = extractTelegram({
      messageId: pending.messageId,
      chatId: pending.chatId,
      date: pending.date,
      tzOffsetMinutes: pending.tzOffsetMinutes,
      lines: pending.lines,
    });
    const outcome = await importForUser(db, userId, extraction, pendingResolver(pending.overrides));
    // Ack first — the button must stop spinning even if the edit below fails
    // (message too old, already edited); delete the pending row only after the
    // edit lands so a redelivered callback can still resolve it.
    await ctx.answerCallbackQuery({ text: 'Logged.' });
    await ctx.editMessageText(importReply(outcome), { parse_mode: 'HTML' });
    await deletePending(db, pendingId);
  }

  function pendingResolver(overrides: Readonly<Record<string, string>>): ExerciseResolver {
    const base = libraryResolver(library);
    return {
      resolve(rawName: string) {
        const overrideId = overrides[rawName];
        const definition =
          overrideId == null ? undefined : library.byId.get(overrideId as ExerciseDefinitionId);
        if (definition !== undefined) return libraryMatch(definition, rawName);
        return base.resolve(rawName);
      },
    };
  }

  function firstUnresolvedName(pending: PendingShorthand): string | null {
    for (const line of pending.lines) {
      const name = line.rawExerciseName;
      if (pending.overrides[name] != null) continue;
      if (library.resolveAlias(name) === undefined) return name;
    }
    return null;
  }

  function previewText(pending: PendingShorthand): string {
    const lines = pending.lines.map(line => {
      const definition = definitionFor(pending, line.rawExerciseName);
      const name = definition?.name ?? line.rawExerciseName;
      const rir = line.rir == null ? '' : ` @RIR ${line.rir}`;
      return `${escapeHtml(name)} ${line.loadKg} kg × ${line.reps}${rir}`;
    });
    return `${lines.join('\n')}\n— confirm?`;
  }

  function definitionFor(
    pending: PendingShorthand,
    rawName: string
  ): ExerciseDefinition | undefined {
    const overrideId = pending.overrides[rawName];
    if (overrideId != null) return library.byId.get(overrideId as ExerciseDefinitionId);
    return library.resolveAlias(rawName);
  }

  return bot;
}

function detectAndExtract(text: string): SourceExtraction | null {
  let header: readonly string[];
  try {
    header = readHeader(text, sniffDelimiter(text));
  } catch (error) {
    console.error('import header sniff failed', error);
    return null;
  }
  if (looksLikeHevyExport(header)) return extractHevy(text);
  if (detectStrongFormat(header) != null) return extractStrong(text);
  return null;
}

function importReply(outcome: BotImportOutcome): string {
  return renderImportReport(
    outcome.result.report,
    outcome.result.unresolved.length,
    outcome.accepted,
    outcome.duplicates
  );
}

function suggestionKeyboard(
  pendingId: string,
  suggestions: readonly ExerciseDefinition[]
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const definition of suggestions) {
    keyboard.text(definition.name, `pk:${pendingId}:${definition.id}`).row();
  }
  keyboard.text('Cancel', `no:${pendingId}`);
  return keyboard;
}

function assumingLine(assuming: string | null): string {
  return assuming == null ? '' : `Assuming you mean ${assuming}.\n`;
}

function localDayOf(unixSeconds: number, tzOffsetMinutes: number): string {
  return new Date((unixSeconds + tzOffsetMinutes * 60) * 1000).toISOString().slice(0, 10);
}

function parseTzOffset(raw: string): number | null {
  const match = /^([+-]?)(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (match == null) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');
  if (hours > 14 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return match[1] === '-' ? -total : total;
}

function formatTzOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60));
  const minutes = absolute % 60;
  return minutes === 0 ? `${sign}${hours}` : `${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}
