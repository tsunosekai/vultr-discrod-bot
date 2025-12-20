import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  AutocompleteInteraction,
} from "discord.js";
import {
  getServerConfig,
  getServerNames,
  loadServersConfig,
  env,
} from "../../config.js";
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
  .setDescription("Manage Vultr game servers")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("start")
      .setDescription("Start a server from snapshot")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Server name")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("stop")
      .setDescription("Stop a server and save snapshot")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Server name")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("Check server status")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Server name (optional, shows all if not specified)")
          .setRequired(false)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("List all configured servers")
  );

export async function autocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focusedValue = interaction.options.getFocused();
  const serverNames = getServerNames();
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
  }
}

async function handleStart(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const serverName = interaction.options.getString("name", true);
  const config = getServerConfig(serverName);

  if (!config) {
    await interaction.reply({
      content: `Server "${serverName}" is not configured.`,
      ephemeral: true,
    });
    return;
  }

  const existingInstance = await findInstanceByLabel(config.label);
  if (existingInstance) {
    await interaction.reply({
      content: `Server "${serverName}" is already running.\nIP: \`${existingInstance.main_ip}\``,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const snapshots = await findSnapshotsByPrefix(config.snapshotPrefix);
    if (snapshots.length === 0) {
      await interaction.editReply(
        `No snapshot found for "${serverName}" (prefix: ${config.snapshotPrefix})`
      );
      return;
    }

    const latestSnapshot = snapshots[0];
    await interaction.editReply(
      `Starting "${serverName}" from snapshot: ${latestSnapshot.description}...`
    );

    const instance = await createInstanceFromSnapshot(
      latestSnapshot.id,
      config.region,
      config.plan,
      config.label
    );

    await interaction.editReply(
      `Instance created. Waiting for server to be ready...`
    );

    const readyInstance = await waitForInstanceReady(instance.id);

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`${config.label} Started`)
      .addFields(
        { name: "IP Address", value: `\`${readyInstance.main_ip}\``, inline: true },
        { name: "Status", value: "Running", inline: true },
        { name: "Region", value: config.region, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ content: null, embeds: [embed] });
  } catch (error) {
    console.error("Error starting server:", error);
    await interaction.editReply(
      `Failed to start server: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

async function handleStop(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const serverName = interaction.options.getString("name", true);
  const config = getServerConfig(serverName);

  if (!config) {
    await interaction.reply({
      content: `Server "${serverName}" is not configured.`,
      ephemeral: true,
    });
    return;
  }

  const instance = await findInstanceByLabel(config.label);
  if (!instance) {
    await interaction.reply({
      content: `Server "${serverName}" is not running.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);
    const snapshotDescription = `${config.snapshotPrefix}${timestamp}`;

    await interaction.editReply(`Creating snapshot: ${snapshotDescription}...`);

    const snapshot = await createSnapshot(instance.id, snapshotDescription);
    await interaction.editReply(
      `Snapshot created. Waiting for completion (this may take several minutes)...`
    );

    await waitForSnapshotReady(snapshot.id);

    await interaction.editReply(`Snapshot complete. Deleting old snapshots...`);

    const snapshots = await findSnapshotsByPrefix(config.snapshotPrefix);
    const snapshotsToDelete = snapshots.slice(env.snapshotRetention);
    for (const oldSnapshot of snapshotsToDelete) {
      await deleteSnapshot(oldSnapshot.id);
    }

    await interaction.editReply(`Deleting instance...`);
    await deleteInstance(instance.id);

    const embed = new EmbedBuilder()
      .setColor(0xff9900)
      .setTitle(`${config.label} Stopped`)
      .addFields(
        { name: "Snapshot", value: snapshotDescription, inline: true },
        { name: "Status", value: "Saved & Stopped", inline: true },
        {
          name: "Old Snapshots Deleted",
          value: `${snapshotsToDelete.length}`,
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.editReply({ content: null, embeds: [embed] });
  } catch (error) {
    console.error("Error stopping server:", error);
    await interaction.editReply(
      `Failed to stop server: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

async function handleStatus(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const serverName = interaction.options.getString("name");

  await interaction.deferReply();

  try {
    if (serverName) {
      const config = getServerConfig(serverName);
      if (!config) {
        await interaction.editReply(`Server "${serverName}" is not configured.`);
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
            name: "Status",
            value: instance ? "Running" : "Stopped",
            inline: true,
          },
          {
            name: "IP Address",
            value: instance ? `\`${instance.main_ip}\`` : "-",
            inline: true,
          },
          { name: "Snapshots", value: `${snapshots.length}`, inline: true }
        )
        .setTimestamp();

      if (snapshots.length > 0) {
        embed.addFields({
          name: "Latest Snapshot",
          value: snapshots[0].description,
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } else {
      const config = loadServersConfig();
      const instances = await listInstances();
      const serverNames = Object.keys(config.servers);

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Server Status")
        .setTimestamp();

      for (const name of serverNames) {
        const serverConfig = config.servers[name];
        const instance = instances.find((i) => i.label === serverConfig.label);

        embed.addFields({
          name: `${serverConfig.label}`,
          value: instance
            ? `Running - \`${instance.main_ip}\``
            : "Stopped",
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error("Error getting status:", error);
    await interaction.editReply(
      `Failed to get status: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

async function handleList(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const config = loadServersConfig();
  const serverEntries = Object.entries(config.servers);

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("Configured Servers")
    .setDescription("Use `/server start <name>` to start a server")
    .setTimestamp();

  for (const [name, serverConfig] of serverEntries) {
    embed.addFields({
      name: `${name}`,
      value: `${serverConfig.description}\nRegion: ${serverConfig.region} | Plan: ${serverConfig.plan}`,
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed] });
}
