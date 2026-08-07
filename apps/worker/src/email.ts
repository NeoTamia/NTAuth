import type { Transporter } from "nodemailer";

import type { JobHandler } from "./worker";

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid_email_${field}`);
  }
  return value;
}

export function createEmailHandler(transport: Transporter, from: string): JobHandler {
  return async (job) => {
    const to = requiredString(job.payload.to, "recipient");
    const subject = requiredString(job.payload.subject, "subject");
    const text = requiredString(job.payload.text, "body");
    const html = typeof job.payload.html === "string" ? job.payload.html : undefined;

    await transport.sendMail({
      from,
      html,
      messageId: `<${job.id}@ntauth.neotamia.re>`,
      subject,
      text,
      to,
    });
  };
}
