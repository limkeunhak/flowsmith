/**
 * **메일 보내기** — 알림의 «메일» 채널이 쓴다. SMTP는 서버 설정이다(플로우마다 정하지 않는다).
 *
 *   FLOWSMITH_SMTP_URL   smtp://사용자:비밀번호@메일서버:587 (STARTTLS) · smtps://…:465 (TLS)
 *   FLOWSMITH_MAIL_FROM  보내는 사람 — 「Flowsmith <robot@example.com>」 (없으면 SMTP 사용자)
 *
 * ★SMTP 비밀번호는 서버의 환경변수에만 — 플로우 · 기록 · 화면 어디에도 나가지 않는다.
 */
import nodemailer from "nodemailer";

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
}

export interface Mailer {
  /** 화면에 보여 줄 보내는 사람 */
  readonly from: string;
  send(m: MailMessage): Promise<void>;
}

export class SmtpMailer implements Mailer {
  readonly from: string;
  readonly #transport: nodemailer.Transporter;

  constructor(smtpUrl: string, from?: string) {
    let user = "";
    try { user = decodeURIComponent(new URL(smtpUrl).username); } catch { throw new Error("FLOWSMITH_SMTP_URL을 읽을 수 없습니다 — smtp://사용자:비밀번호@서버:587 모양으로 쓰세요"); }
    this.from = from?.trim() || user;
    if (!this.from) throw new Error("보내는 사람을 모릅니다 — FLOWSMITH_MAIL_FROM을 정하세요");
    this.#transport = nodemailer.createTransport(smtpUrl, { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  }

  async send(m: MailMessage): Promise<void> {
    await this.#transport.sendMail({
      from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html,
      ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })) } : {}),
    });
  }
}

/** 환경변수에서 — 없으면 null(메일 채널은 «보낼 서버가 없음»으로 남는다) */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer | null {
  const url = env["FLOWSMITH_SMTP_URL"]?.trim();
  return url ? new SmtpMailer(url, env["FLOWSMITH_MAIL_FROM"]) : null;
}
