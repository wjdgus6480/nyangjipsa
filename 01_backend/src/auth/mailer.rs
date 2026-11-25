//! 메일 발송 (이메일 인증·비밀번호 재설정).
//!
//! `MAIL_MODE` 로 고릅니다.
//! - `smtp`: 실제 발송. 업체 무관 SMTP (SMTP_HOST·SMTP_PORT·SMTP_USERNAME·SMTP_PASSWORD·SMTP_FROM·SMTP_TLS)
//! - `log` : 개발 전용. 메일 본문(링크 포함)을 서버 로그에 남김. **APP_ENV=production 에서는 서버가 시작을 거부**
//! - `disabled`(기본): 보내지 않고 실패로 처리 → 가입은 되지만 `email_sent: false`, 재발송으로 다시 시도
//! - 테스트: `Mailer::memory()` 로 보낸 메일을 모아 확인

use std::sync::{Arc, Mutex};

use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{Mailbox, header::ContentType},
    transport::smtp::authentication::Credentials,
};

use crate::auth::email::mask;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutgoingMail {
    pub to: String,
    pub subject: String,
    pub text: String,
}

#[derive(Debug, thiserror::Error)]
pub enum MailError {
    #[error("메일 발송이 설정되지 않았습니다 (MAIL_MODE)")]
    Disabled,
    #[error("메일 발송 실패: {0}")]
    Send(String),
}

/// SMTP 연결 방식
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmtpTls {
    /// 587 등: 평문 연결 후 STARTTLS (필수)
    StartTls,
    /// 465 등: 처음부터 TLS
    Tls,
}

#[derive(Clone)]
pub struct SmtpSettings {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from: String,
    pub tls: SmtpTls,
}

pub type MailBox = Arc<Mutex<Vec<OutgoingMail>>>;

#[derive(Clone)]
pub enum Mailer {
    Disabled,
    Log,
    Memory(MailBox),
    Smtp {
        transport: AsyncSmtpTransport<Tokio1Executor>,
        from: Mailbox,
    },
}

impl Mailer {
    /// 테스트용: 보낸 메일을 모으는 메일러와 그 보관함
    pub fn memory() -> (Self, MailBox) {
        let sent: MailBox = Arc::default();
        (Mailer::Memory(sent.clone()), sent)
    }

    pub fn smtp(s: &SmtpSettings) -> Result<Self, MailError> {
        let builder = match s.tls {
            SmtpTls::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&s.host),
            SmtpTls::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(&s.host),
        }
        .map_err(|e| MailError::Send(format!("SMTP 설정 오류: {e}")))?;
        let transport = builder
            .port(s.port)
            .credentials(Credentials::new(s.username.clone(), s.password.clone()))
            .build();
        let from = s
            .from
            .parse::<Mailbox>()
            .map_err(|e| MailError::Send(format!("SMTP_FROM 형식 오류: {e}")))?;
        Ok(Mailer::Smtp { transport, from })
    }

    pub fn mode_name(&self) -> &'static str {
        match self {
            Mailer::Disabled => "disabled",
            Mailer::Log => "log",
            Mailer::Memory(_) => "memory",
            Mailer::Smtp { .. } => "smtp",
        }
    }

    pub async fn send(&self, mail: OutgoingMail) -> Result<(), MailError> {
        match self {
            Mailer::Disabled => Err(MailError::Disabled),
            Mailer::Log => {
                // 개발 전용 (운영에서는 main 이 이 모드를 거부). 받는 주소는 가려서 남김
                tracing::info!(
                    to = %mask(&mail.to),
                    subject = %mail.subject,
                    "[MAIL_MODE=log 개발용] 메일 본문:\n{}",
                    mail.text
                );
                Ok(())
            }
            Mailer::Memory(sent) => {
                sent.lock().unwrap_or_else(|e| e.into_inner()).push(mail);
                Ok(())
            }
            Mailer::Smtp { transport, from } => {
                let to = mail
                    .to
                    .parse::<Mailbox>()
                    .map_err(|e| MailError::Send(format!("받는 주소 형식 오류: {e}")))?;
                let message = Message::builder()
                    .from(from.clone())
                    .to(to)
                    .subject(mail.subject)
                    .header(ContentType::TEXT_PLAIN)
                    .body(mail.text)
                    .map_err(|e| MailError::Send(e.to_string()))?;
                transport
                    .send(message)
                    .await
                    .map(|_| ())
                    .map_err(|e| MailError::Send(e.to_string()))
            }
        }
    }
}
