import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  AutocompleteInteraction,
  GuildMember,
} from "discord.js";
import {
  getServerConfig,
  getServerNamesForGuild,
  isServerAllowedForGuild,
  loadServersConfig,
  env,
  ServerConfig,
} from "../../config.js";
import { executeCommand, downloadFile, downloadDirectoryAsZip } from "../../sftp/client.js";
import {
  generateDownloadFilename,
  getLocalFilePath,
  getFileUrl,
  cleanupOldFiles,
  listSavedFiles,
} from "../../file-server.js";

function hasAllowedRole(interaction: ChatInputCommandInteraction): boolean {
  const allowedRoleName = env.allowedRoleName;
  if (!allowedRoleName) return true;

  const member = interaction.member as GuildMember | null;
  if (!member) return false;

  return member.roles.cache.some(
    (role) => role.name.toLowerCase() === allowedRoleName.toLowerCase()
  );
}

const regionNames: Record<string, string> = {
  nrt: "東京",
  icn: "ソウル",
  sgp: "シンガポール",
  lax: "ロサンゼルス",
  ord: "シカゴ",
  ewr: "ニュージャージー",
  ams: "アムステルダム",
  lhr: "ロンドン",
  fra: "フランクフルト",
  syd: "シドニー",
};

const planNames: Record<string, string> = {
  "vc2-1c-1gb": "1コア / 1GB",
  "vc2-1c-2gb": "1コア / 2GB",
  "vc2-2c-4gb": "2コア / 4GB",
  "vc2-4c-8gb": "4コア / 8GB",
  "vc2-6c-16gb": "6コア / 16GB",
  "vc2-8c-32gb": "8コア / 32GB",
  "voc-g-2c-8gb-50s-amd": "2コア / 8GB (汎用)",
};

function formatRegion(region: string): string {
  return regionNames[region] || region;
}

function formatPlan(plan: string): string {
  return planNames[plan] || plan;
}

import {
  findInstanceByLabel,
  findSnapshotsByPrefix,
  createInstanceFromSnapshot,
  createSnapshot,
  deleteInstance,
  deleteSnapshot,
  waitForInstanceReady,
  waitForSnapshotReady,
  listInstances,
} from "../../vultr/api.js";

export const data = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Vultr ゲームサーバーを管理")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("start")
      .setDescription("スナップショットからサーバーを起動")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("サーバー名")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("stop")
      .setDescription("サーバーを停止してスナップショットを保存")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("サーバー名")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("サーバーの状態を確認")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("サーバー名（省略時は全サーバー表示）")
          .setRequired(false)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("登録済みサーバー一覧を表示")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("files")
      .setDescription("保存済みファイル一覧を表示")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("サーバー名")
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

export async function autocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focusedValue = interaction.options.getFocused();
  const guildId = interaction.guildId || "";
  const serverNames = getServerNamesForGuild(guildId);
  const filtered = serverNames.filter((name) =>
    name.toLowerCase().includes(focusedValue.toLowerCase())
  );
  await interaction.respond(
    filtered.slice(0, 25).map((name) => ({ name, value: name }))
  );
}

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!hasAllowedRole(interaction)) {
    await interaction.reply({
      content: `このコマンドを使用する権限がありません。必要なロール: "${env.allowedRoleName}"`,
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "start":
      await handleStart(interaction);
      break;
    case "stop":
      await handleStop(interaction);
      break;
    case "status":
      await handleStatus(interaction);
      break;
    case "list":
      await handleList(interaction);
      break;
    case "files":
      await handleFiles(interaction);
      break;
  }
}

async function handleStart(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const serverName = interaction.options.getString("name", true);
  const guildId = interaction.guildId || "";

  const config = getServerConfig(serverName);

  if (!config || !isServerAllowedForGuild(serverName, guildId)) {
    await interaction.reply({
      content: `サーバー "${serverName}" は設定されていません。`,
      ephemeral: true,
    });
    return;
  }

  const existingInstance = await findInstanceByLabel(config.label);
  if (existingInstance) {
    await interaction.reply({
      content: `サーバー "${serverName}" は既に起動中です。\nIP: \`${existingInstance.main_ip}\``,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const snapshots = await findSnapshotsByPrefix(config.snapshotPrefix);
    if (snapshots.length === 0) {
      await interaction.editReply(
        `"${serverName}" のスナップショットが見つかりません（プレフィックス: ${config.snapshotPrefix}）`
      );
      return;
    }

    const latestSnapshot = snapshots[0];
    await interaction.editReply(
      `"${serverName}" を起動中... スナップショット: ${latestSnapshot.description}`
    );

    const instance = await createInstanceFromSnapshot(
      latestSnapshot.id,
      config.region,
      config.plan,
      config.label
    );

    await interaction.editReply(
      `インスタンスを作成しました。サーバーの準備完了を待機中...`
    );

    const readyInstance = await waitForInstanceReady(instance.id);

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`${config.label} 起動完了`)
      .addFields(
        { name: "IP アドレス", value: `\`${readyInstance.main_ip}\``, inline: true },
        { name: "状態", value: "稼働中", inline: true },
        { name: "リージョン", value: formatRegion(config.region), inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ content: null, embeds: [embed] });
  } catch (error) {
    console.error("Error starting server:", error);
    await interaction.editReply(
      `サーバーの起動に失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}`
    );
  }
}

async function downloadFilesFromServer(
  serverName: string,
  config: ServerConfig,
  host: string
): Promise<{ name: string; url: string; description: string }[]> {
  const downloadedFiles: { name: string; url: string; description: string }[] = [];

  if (!config.downloadableFiles || !config.sshUser) {
    return downloadedFiles;
  }

  const sshOptions = {
    host,
    user: config.sshUser,
  };

  for (const [fileKey, fileConfig] of Object.entries(config.downloadableFiles)) {
    try {
      const isDirectory = fileConfig.type === "directory";
      const ext = isDirectory ? ".zip" : "";
      const filename = generateDownloadFilename(serverName, fileKey, fileConfig.path + ext);
      const localPath = getLocalFilePath(filename);

      if (isDirectory) {
        await downloadDirectoryAsZip(sshOptions, fileConfig.path, localPath);
      } else {
        await downloadFile(sshOptions, fileConfig.path, localPath);
      }

      downloadedFiles.push({
        name: fileKey,
        url: getFileUrl(filename),
        description: fileConfig.description,
      });

      cleanupOldFiles(serverName, fileKey);
    } catch (error) {
      console.error(`Failed to download ${fileKey}:`, error);
    }
  }

  return downloadedFiles;
}

async function handleStop(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const serverName = interaction.options.getString("name", true);
  const guildId = interaction.guildId || "";

  const config = getServerConfig(serverName);

  if (!config || !isServerAllowedForGuild(serverName, guildId)) {
    await interaction.reply({
      content: `サーバー "${serverName}" は設定されていません。`,
      ephemeral: true,
    });
    return;
  }

  const instance = await findInstanceByLabel(config.label);
  if (!instance) {
    await interaction.reply({
      content: `サーバー "${serverName}" は起動していません。`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  let downloadedFiles: { name: string; url: string; description: string }[] = [];

  try {
    const hasDownloadConfig = config.sshUser && config.downloadableFiles && Object.keys(config.downloadableFiles).length > 0;

    if (hasDownloadConfig && config.stopCommand) {
      await interaction.editReply(`ゲームサーバーを停止中...`);

      const sshOptions = { host: instance.main_ip, user: config.sshUser! };
      await executeCommand(sshOptions, config.stopCommand);

      await interaction.editReply(`ファイルをダウンロード中...`);
      downloadedFiles = await downloadFilesFromServer(serverName, config, instance.main_ip);

      if (config.startCommand) {
        await interaction.editReply(`ゲームサーバーを再起動中...`);
        await executeCommand(sshOptions, config.startCommand);
      }
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);
    const snapshotDescription = `${config.snapshotPrefix}${timestamp}`;

    await interaction.editReply(`スナップショットを作成中: ${snapshotDescription}...`);

    const snapshot = await createSnapshot(instance.id, snapshotDescription);
    await interaction.editReply(
      `スナップショットを作成中... 完了まで数分かかる場合があります。`
    );

    await waitForSnapshotReady(snapshot.id);

    const snapshots = await findSnapshotsByPrefix(config.snapshotPrefix);
    const createdSnapshot = snapshots.find((s) => s.id === snapshot.id);
    if (!createdSnapshot || createdSnapshot.status !== "complete") {
      await interaction.editReply(
        `⚠️ スナップショットの作成を確認できませんでした。サーバーは削除されません。\n手動で確認してください。`
      );
      return;
    }

    await interaction.editReply(`スナップショット完了。古いスナップショットを削除中...`);

    const snapshotsToDelete = snapshots.slice(env.snapshotRetention);
    for (const oldSnapshot of snapshotsToDelete) {
      await deleteSnapshot(oldSnapshot.id);
    }

    await interaction.editReply(`インスタンスを削除中...`);
    await deleteInstance(instance.id);

    const embed = new EmbedBuilder()
      .setColor(0xff9900)
      .setTitle(`${config.label} 停止完了`)
      .addFields(
        { name: "スナップショット", value: snapshotDescription, inline: true },
        { name: "状態", value: "保存済み・停止", inline: true },
        {
          name: "削除した古いスナップショット",
          value: `${snapshotsToDelete.length} 件`,
          inline: true,
        }
      )
      .setTimestamp();

    if (downloadedFiles.length > 0) {
      const downloadLinks = downloadedFiles
        .map((f) => `**${f.description}**: ${f.url}`)
        .join("\n");
      embed.addFields({
        name: "ダウンロードファイル",
        value: downloadLinks,
        inline: false,
      });
    }

    await interaction.editReply({ content: null, embeds: [embed] });
  } catch (error) {
    console.error("Error stopping server:", error);
    await interaction.editReply(
      `⚠️ サーバーの停止に失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}\nサーバーは削除されていません。手動で確認してください。`
    );
  }
}

async function handleStatus(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const serverName = interaction.options.getString("name");
  const guildId = interaction.guildId || "";

  await interaction.deferReply();

  try {
    if (serverName) {
      const config = getServerConfig(serverName);
      if (!config || !isServerAllowedForGuild(serverName, guildId)) {
        await interaction.editReply(`サーバー "${serverName}" は設定されていません。`);
        return;
      }

      const instance = await findInstanceByLabel(config.label);
      const snapshots = await findSnapshotsByPrefix(config.snapshotPrefix);

      const embed = new EmbedBuilder()
        .setColor(instance ? 0x00ff00 : 0x999999)
        .setTitle(`${config.label}`)
        .setDescription(config.description)
        .addFields(
          {
            name: "状態",
            value: instance ? "稼働中" : "停止中",
            inline: true,
          },
          {
            name: "IP アドレス",
            value: instance ? `\`${instance.main_ip}\`` : "-",
            inline: true,
          },
          { name: "スナップショット数", value: `${snapshots.length}`, inline: true }
        )
        .setTimestamp();

      if (snapshots.length > 0) {
        embed.addFields({
          name: "最新のスナップショット",
          value: snapshots[0].description,
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } else {
      const config = loadServersConfig();
      const instances = await listInstances();
      const serverNames = getServerNamesForGuild(guildId);

      if (serverNames.length === 0) {
        await interaction.editReply("利用可能なサーバーがありません。");
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("サーバー状態")
        .setTimestamp();

      for (const name of serverNames) {
        const serverConfig = config.servers[name];
        const instance = instances.find((i) => i.label === serverConfig.label);

        embed.addFields({
          name: `${serverConfig.label}`,
          value: instance
            ? `稼働中 - \`${instance.main_ip}\``
            : "停止中",
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error("Error getting status:", error);
    await interaction.editReply(
      `状態の取得に失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}`
    );
  }
}

async function handleList(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guildId = interaction.guildId || "";
  const config = loadServersConfig();
  const allowedServerNames = getServerNamesForGuild(guildId);

  if (allowedServerNames.length === 0) {
    await interaction.reply({
      content: "利用可能なサーバーがありません。",
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("登録済みサーバー")
    .setDescription("`/server start <name>` でサーバーを起動できます")
    .setTimestamp();

  for (const name of allowedServerNames) {
    const serverConfig = config.servers[name];
    embed.addFields({
      name: `${name}`,
      value: `${serverConfig.description}\nリージョン: ${formatRegion(serverConfig.region)} | プラン: ${formatPlan(serverConfig.plan)}`,
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function handleFiles(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const serverName = interaction.options.getString("name", true);
  const guildId = interaction.guildId || "";

  const config = getServerConfig(serverName);

  if (!config || !isServerAllowedForGuild(serverName, guildId)) {
    await interaction.reply({
      content: `サーバー "${serverName}" は設定されていません。`,
      ephemeral: true,
    });
    return;
  }

  const files = listSavedFiles(serverName);

  if (files.length === 0) {
    await interaction.reply({
      content: `"${serverName}" の保存済みファイルはありません。`,
      ephemeral: true,
    });
    return;
  }

  const filesByKey = new Map<string, typeof files>();
  for (const file of files) {
    const existing = filesByKey.get(file.fileKey) || [];
    existing.push(file);
    filesByKey.set(file.fileKey, existing);
  }

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`${config.label} - 保存済みファイル`)
    .setTimestamp();

  for (const [fileKey, keyFiles] of filesByKey) {
    const fileConfig = config.downloadableFiles?.[fileKey];
    const description = fileConfig?.description || fileKey;

    const fileList = keyFiles
      .slice(0, 5)
      .map((f) => {
        const date = f.timestamp.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
        return `[${date}](${f.url})`;
      })
      .join("\n");

    embed.addFields({
      name: description,
      value: fileList || "ファイルなし",
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed] });
}
