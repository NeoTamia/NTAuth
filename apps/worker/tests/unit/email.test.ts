import { describe, expect, test } from "bun:test";

import { createEmailHandler } from "../../src/email";

describe("email outbox handler", () => {
  test("uses a stable message id and propagates SMTP unavailability", async () => {
    const sent: unknown[] = [];
    const transport = {
      async sendMail(message: unknown) {
        sent.push(message);
        throw new Error("smtp-secret-host-unavailable");
      },
    };
    const handler = createEmailHandler(transport as never, "NTAuth <no-reply@neotamia.re>");
    const job = {
      attempts: 1,
      id: "7f5d87b4-8fc8-4d91-a66c-e322554b7209",
      maxAttempts: 5,
      payload: { subject: "Invitation", text: "Welcome", to: "user@example.test" },
      type: "email",
    };

    await expect(handler(job)).rejects.toThrow("smtp-secret-host-unavailable");
    expect(sent).toEqual([
      expect.objectContaining({
        messageId: `<${job.id}@ntauth.neotamia.re>`,
        to: "user@example.test",
      }),
    ]);
  });
});
