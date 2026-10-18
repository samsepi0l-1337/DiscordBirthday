import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { Events } from "discord.js";
import type {
	ApplicationCommandDataResolvable,
	Client,
	GuildMember,
} from "discord.js";
import { loadConfig } from "./config.js";
import {
	createClient,
	createSendDmHandler,
	handleDmCreate,
	handleDmUpdate,
	registerCommands,
} from "./discord.js";
import type { DmMessageLike, InteractionLike, SendDeps } from "./discord.js";
import { ResponseStore } from "./store.js";
import {
	openDmChannel,
	syncDmHistory,
	type HistoryChannelLike,
} from "./sync.js";
import type { MemberLike } from "./types.js";

export async function main(): Promise<void> {
	loadEnv();
	const config = loadConfig(process.env);
	const store = await ResponseStore.load(config.responsesPath);
	const rawSave = store.save.bind(store);
	let saveQueue: Promise<void> = Promise.resolve();
	store.save = () => {
		const run = saveQueue.then(rawSave);
		saveQueue = run.catch(() => undefined);
		return run;
	};
	const client = createClient();

	const getDeps = async (): Promise<SendDeps> => {
		const guild = await client.guilds.fetch(config.guildId);
		const fetched = await guild.members.fetch();
		const byId = new Map<string, GuildMember>();
		const members: MemberLike[] = [];
		for (const member of fetched.values()) {
			byId.set(member.id, member);
			members.push({
				id: member.id,
				username: member.user.username,
				globalName: member.user.globalName,
				nickname: member.nickname,
				bot: member.user.bot,
			});
		}
		return {
			members,
			botUserId: client.user?.id ?? "",
			config,
			store,
			sendDm: async (member, text) => {
				const target = byId.get(member.id);
				if (!target) throw new Error(`member not found: ${member.id}`);
				const sent = await target.send(text);
				return sent.channelId;
			},
			delay: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
			now: () => new Date(),
			log: (line) => console.log(line),
		};
	};

	const handleSendDm = createSendDmHandler(getDeps);

	client.once(Events.ClientReady, () => {
		client.guilds
			.fetch(config.guildId)
			.then((guild) =>
				registerCommands({
					commands: {
						set: (data) =>
							guild.commands.set(data as ApplicationCommandDataResolvable[]),
					},
				}),
			)
			.catch((err: unknown) =>
				console.error("command registration failed", err),
			);

		syncStoredDms(client, store, config.sendDelayMs).catch((err: unknown) =>
			console.error("dm sync failed", err),
		);
	});

	client.on(Events.MessageCreate, (message) => {
		handleDmCreate(message as unknown as DmMessageLike, store).catch(
			(err: unknown) => console.error("messageCreate handler failed", err),
		);
	});

	client.on(Events.MessageUpdate, (_old, message) => {
		handleDmUpdate(message as unknown as DmMessageLike, store).catch(
			(err: unknown) => console.error("messageUpdate handler failed", err),
		);
	});

	client.on(Events.InteractionCreate, (interaction) => {
		if (!interaction.isChatInputCommand()) return;
		handleSendDm(interaction as unknown as InteractionLike).catch(
			(err: unknown) => console.error("interaction handler failed", err),
		);
	});

	await client.login(config.token);
}

async function syncStoredDms(
	client: Client,
	store: ResponseStore,
	delayMs: number,
): Promise<void> {
	await syncDmHistory({
		store,
		delayMs,
		delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		log: (line) => console.log(line),
		openChannel: (target) =>
			openDmChannel(target, {
				fetchChannel: async (channelId) => {
					const channel = await client.channels.fetch(channelId);
					if (!channel?.isDMBased() || !("messages" in channel)) return null;
					return channel as unknown as HistoryChannelLike;
				},
				createDM: async (userId) => {
					const user = await client.users.fetch(userId);
					return (await user.createDM()) as unknown as HistoryChannelLike;
				},
			}),
	});
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exitCode = 1;
	});
}
