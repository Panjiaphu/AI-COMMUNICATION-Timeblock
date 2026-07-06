from __future__ import annotations

from html import escape

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.security import create_email_token
from app.models import User
from app.services.email import flush_email_queue, queue_email


def _subject(locale: str) -> str:
    if locale == "zh-TW":
        return "Guilua 帳戶驗證通知"
    if locale == "en":
        return "Verify your Guilua account"
    return "Guilua - Xác minh tài khoản"


def _copy(locale: str, name: str) -> dict[str, str]:
    if locale == "zh-TW":
        return {
            "preheader": "請完成 Guilua 帳戶驗證以啟用會員服務。",
            "headline": "驗證您的 Guilua 帳戶",
            "greeting": f"您好 {name},",
            "intro": "感謝您註冊 Guilua。請點擊下方按鈕完成帳戶驗證，以啟用會員錢包、BO 頁面與相關服務。",
            "button": "立即驗證帳戶",
            "expires": "此安全連結將於 24 小時後失效。",
            "fallback": "如果按鈕無法開啟，請複製以下連結至瀏覽器：",
            "ignore": "如果您沒有註冊 Guilua，請忽略此郵件。",
            "footer": "此為系統交易通知，請勿直接回覆。",
        }
    if locale == "en":
        return {
            "preheader": "Complete your Guilua account verification to activate member services.",
            "headline": "Verify your Guilua account",
            "greeting": f"Hello {name},",
            "intro": "Thank you for registering with Guilua. Please confirm your email address to activate your member wallet, BO page access, and supported services.",
            "button": "Verify account",
            "expires": "This secure verification link expires in 24 hours.",
            "fallback": "If the button does not open, copy and paste this link into your browser:",
            "ignore": "If you did not register for Guilua, you can safely ignore this email.",
            "footer": "This is a transactional system notification. Please do not reply directly.",
        }
    return {
        "preheader": "Hoàn tất xác minh tài khoản Guilua để kích hoạt dịch vụ member.",
        "headline": "Xác minh tài khoản Guilua",
        "greeting": f"Xin chào {name},",
        "intro": "Cảm ơn bạn đã đăng ký Guilua. Vui lòng xác minh email để kích hoạt ví điểm member, quyền truy cập trang BO và các dịch vụ được hỗ trợ.",
        "button": "Xác minh tài khoản",
        "expires": "Liên kết bảo mật này có hiệu lực trong 24 giờ.",
        "fallback": "Nếu nút không mở được, hãy sao chép liên kết dưới đây vào trình duyệt:",
        "ignore": "Nếu bạn không đăng ký tài khoản Guilua, vui lòng bỏ qua email này.",
        "footer": "Đây là email giao dịch tự động từ hệ thống. Vui lòng không trả lời trực tiếp.",
    }


def _verification_html(locale: str, user: User, verify_url: str) -> str:
    name = escape(user.full_name or user.email)
    url = escape(verify_url, quote=True)
    copy = _copy(locale, name)
    return f"""<!doctype html>
<html lang="{escape(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>{copy['headline']}</title>
</head>
<body style="margin:0;padding:0;background:#f3f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#172033;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{copy['preheader']}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #e4e9f2;box-shadow:0 18px 45px rgba(17,24,39,.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a 0%,#063b36 48%,#0b5dd7 100%);padding:28px 34px;color:#ffffff;">
              <div style="font-size:24px;font-weight:800;letter-spacing:-.02em;"><span style="color:#34f5c6;">G</span>uilua</div>
              <div style="margin-top:16px;font-size:28px;line-height:1.25;font-weight:800;">{copy['headline']}</div>
              <div style="margin-top:8px;font-size:14px;line-height:1.6;color:#d7e2ff;">Secure member account verification</div>
            </td>
          </tr>
          <tr>
            <td style="padding:34px;">
              <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:#172033;">{copy['greeting']}</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.75;color:#4b5565;">{copy['intro']}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;">
                <tr>
                  <td style="border-radius:14px;background:linear-gradient(135deg,#46efbd,#0fb7e9);">
                    <a href="{url}" style="display:inline-block;padding:15px 26px;color:#061018;text-decoration:none;font-weight:800;font-size:15px;border-radius:14px;">{copy['button']}</a>
                  </td>
                </tr>
              </table>
              <div style="background:#f8fafc;border:1px solid #e5eaf3;border-radius:16px;padding:16px 18px;margin:0 0 22px;">
                <p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#647084;">{copy['expires']}</p>
                <p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#647084;">{copy['fallback']}</p>
                <a href="{url}" style="word-break:break-all;color:#0a7cff;font-size:13px;line-height:1.55;">{url}</a>
              </div>
              <p style="margin:0;font-size:13px;line-height:1.7;color:#7b8495;">{copy['ignore']}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 34px;background:#f8fafc;border-top:1px solid #e8edf5;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#8a94a6;">{copy['footer']}</p>
              <p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:#8a94a6;">© Guilua. Account security notification.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def queue_member_verification_email(db: Session, request: Request, user: User, *, flush: bool = True) -> None:
    locale = user.locale if user.locale in {"vi", "zh-TW", "en"} else "vi"
    token = create_email_token(user.email)
    verify_url = str(request.url_for("verify_email")) + f"?token={token}"
    queue_email(
        db,
        user.email,
        _subject(locale),
        _verification_html(locale, user, verify_url),
        "email_verification",
        user=user,
    )
    if flush:
        flush_email_queue(db, limit=20)
