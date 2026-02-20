import { App, SlackCommandMiddlewareArgs } from "@slack/bolt";
import { buildComposeEmailModal } from "./modals";

export const registerCommands = (app: App): void => {
  app.command("/compose-email", async ({ ack, body, client }) => {
    await ack();

    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildComposeEmailModal(),
      });
    } catch (error) {
      console.error("Failed to open compose modal", error);
    }
  });
};
