from __future__ import annotations

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.security import create_email_token
from app.models import User
from app.services.email import flush_email_queue, queue_email


def _subject(locale: str) -> str:
    if locale == "zh-TW":
        return "Guilua - 驗證您的帳戶"
    if locale == "en":
        return "Guilua - Verify your account"
    return "Guilua - Xác minh tài khoản"


def _body(locale: str, user: User, verify_url: str) -> str:
    name = user.full_name or user.email
    if locale == "zh-TW":
        return (
            f"您好 {name},\n\n"
            "請使用以下連結驗證您的 Guilua 帳戶。此連結將於 24 小時後失效。\n\n"
            f"{verify_url}\n\n"
            "如果您沒有註冊 Guilua，請忽略此郵件。"
        )
    if locale == "en":
        return (
            f"Hello {name},\n\n"
            "Please verify your Guilua account using the secure link below. This link expires in 24 hours.\n\n"
            f"{verify_url}\n\n"
            "If you did not register for Guilua, you can ignore this message."
        )
    return (
        f"Xin chào {name},\n\n"
        "Vui lòng xác minh tài khoản Guilua bằng liên kết bảo mật bên dưới. Liên kết có hiệu lực trong 24 giờ.\n\n"
        f"{verify_url}\n\n"
        "Nếu bạn không đăng ký tài khoản Guilua, vui lòng bỏ qua email này."
    )


def queue_member_verification_email(db: Session, request: Request, user: User, *, flush: bool = True) -> None:
    locale = user.locale if user.locale in {"vi", "zh-TW", "en"} else "vi"
    token = create_email_token(user.email)
    verify_url = str(request.url_for("verify_email")) + f"?token={token}"
    queue_email(
        db,
        user.email,
        _subject(locale),
        _body(locale, user, verify_url),
        "email_verification",
        user=user,
    )
    if flush:
        flush_email_queue(db, limit=20)
