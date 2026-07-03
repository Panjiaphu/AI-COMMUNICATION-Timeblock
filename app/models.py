from datetime import datetime, timezone
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TransactionType(StrEnum):
    SEND_HOME = "send_home"
    BUY_USDT = "buy_usdt"
    SELL_USDT = "sell_usdt"


class TransactionStatus(StrEnum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    NEEDS_INFO = "needs_info"
    APPROVED = "approved"
    COMPLETED = "completed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class EmailStatus(StrEnum):
    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"


class ReferralCommissionType(StrEnum):
    ACTIVITY = "activity"
    LOSS_DEPOSIT = "loss_deposit"


class ReferralCommissionStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    PAID = "paid"
    VOID = "void"


class WalletLedgerType(StrEnum):
    DEPOSIT_APPROVED = "deposit_approved"
    WITHDRAW_APPROVED = "withdraw_approved"
    TRANSFER_IN = "transfer_in"
    TRANSFER_OUT = "transfer_out"
    BO_STAKE = "bo_stake"
    BO_PAYOUT = "bo_payout"
    RAPID_STAKE = "rapid_stake"
    RAPID_PAYOUT = "rapid_payout"
    ADJUSTMENT = "adjustment"


class SandboxRequestType(StrEnum):
    DEPOSIT = "deposit"
    WITHDRAW = "withdraw"


class SandboxRequestStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class GameRequestStatus(StrEnum):
    PENDING_CONFIRMATION = "pending_confirmation"
    ACCEPTED = "accepted"
    REJECTED_BY_SESSION_CONDITION = "rejected_by_session_condition"
    REFUNDED = "refunded"
    WON = "won"
    LOST = "lost"
    CANCELLED_BY_SYSTEM = "cancelled_by_system"


class BoSide(StrEnum):
    BUY = "buy"
    SELL = "sell"


class RapidPlayType(StrEnum):
    BAO_LO_2 = "bao_lo_2"
    BAO_LO_3 = "bao_lo_3"
    XIEN_2 = "xien_2"
    XIEN_3 = "xien_3"
    HEAD = "head"
    TAIL = "tail"
    EVEN_ODD = "even_odd"


class ContentPostStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class ContentPostSource(StrEnum):
    ADMIN = "admin"
    AI_AGENT = "ai_agent"


class ContentPostType(StrEnum):
    JOB = "job"
    SHOP = "shop"
    CRYPTO_ANALYSIS = "crypto_analysis"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    uid: Mapped[str] = mapped_column(String(24), unique=True, index=True, default="")
    referral_code: Mapped[str] = mapped_column(String(24), unique=True, index=True, default="")
    referred_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120), default="")
    locale: Mapped[str] = mapped_column(String(12), default="vi")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    transactions: Mapped[list["TransactionRequest"]] = relationship(back_populates="user")
    email_replies: Mapped[list["EmailReply"]] = relationship(back_populates="user")
    service_requests: Mapped[list["ServiceRequest"]] = relationship(back_populates="user")
    content_posts: Mapped[list["ContentPost"]] = relationship(back_populates="created_by")
    utility_usage: Mapped[list["MemberUtilityUsage"]] = relationship(back_populates="user")
    sponsor: Mapped["User | None"] = relationship(remote_side=[id], back_populates="referrals")
    referrals: Mapped[list["User"]] = relationship(back_populates="sponsor")
    referral_commissions: Mapped[list["ReferralCommission"]] = relationship(
        back_populates="beneficiary",
        foreign_keys="ReferralCommission.beneficiary_user_id",
    )
    internal_wallets: Mapped[list["InternalWallet"]] = relationship(back_populates="user")
    point_ledger_entries: Mapped[list["PointLedgerEntry"]] = relationship(
        back_populates="user",
        foreign_keys="PointLedgerEntry.user_id",
    )
    point_transfers_sent: Mapped[list["PointTransfer"]] = relationship(
        back_populates="sender",
        foreign_keys="PointTransfer.sender_user_id",
    )
    point_transfers_received: Mapped[list["PointTransfer"]] = relationship(
        back_populates="receiver",
        foreign_keys="PointTransfer.receiver_user_id",
    )
    sandbox_transactions: Mapped[list["SandboxTransaction"]] = relationship(
        back_populates="user",
        foreign_keys="SandboxTransaction.user_id",
    )
    bo_orders: Mapped[list["BoOrder"]] = relationship(back_populates="user")
    rapid_entries: Mapped[list["RapidEntry"]] = relationship(back_populates="user")


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair: Mapped[str] = mapped_column(String(32), index=True)
    buy_rate: Mapped[float] = mapped_column(Numeric(18, 6))
    sell_rate: Mapped[float] = mapped_column(Numeric(18, 6))
    source: Mapped[str] = mapped_column(String(32), default="manual")
    is_manual: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("ix_exchange_rates_pair_updated", "pair", "updated_at"),)


class TransactionRequest(Base):
    __tablename__ = "transaction_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    request_type: Mapped[TransactionType] = mapped_column(Enum(TransactionType), index=True)
    status: Mapped[TransactionStatus] = mapped_column(
        Enum(TransactionStatus), default=TransactionStatus.PENDING, index=True
    )
    amount_twd: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    amount_vnd: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    amount_usdt: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)
    rate_pair: Mapped[str] = mapped_column(String(32), default="")
    rate_value: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)
    recipient_name: Mapped[str] = mapped_column(String(120), default="")
    recipient_bank: Mapped[str] = mapped_column(String(120), default="")
    recipient_account: Mapped[str] = mapped_column(String(120), default="")
    contact_phone: Mapped[str] = mapped_column(String(64), default="")
    contact_line: Mapped[str] = mapped_column(String(120), default="")
    usdt_network: Mapped[str] = mapped_column(String(32), default="")
    wallet_address: Mapped[str] = mapped_column(String(255), default="")
    member_note: Mapped[str] = mapped_column(Text, default="")
    admin_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="transactions")
    email_replies: Mapped[list["EmailReply"]] = relationship(back_populates="transaction")


class ReferralCommission(Base):
    __tablename__ = "referral_commissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    beneficiary_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    source_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    level: Mapped[int] = mapped_column(Integer, index=True)
    commission_type: Mapped[ReferralCommissionType] = mapped_column(Enum(ReferralCommissionType), index=True)
    rate_percent: Mapped[float] = mapped_column(Numeric(8, 4))
    base_amount: Mapped[float] = mapped_column(Numeric(18, 4))
    amount: Mapped[float] = mapped_column(Numeric(18, 4))
    currency: Mapped[str] = mapped_column(String(16), default="POINT", index=True)
    status: Mapped[ReferralCommissionStatus] = mapped_column(
        Enum(ReferralCommissionStatus), default=ReferralCommissionStatus.PENDING, index=True
    )
    reference_type: Mapped[str] = mapped_column(String(64), default="")
    reference_id: Mapped[str] = mapped_column(String(64), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    beneficiary: Mapped[User] = relationship(foreign_keys=[beneficiary_user_id], back_populates="referral_commissions")
    source_user: Mapped[User] = relationship(foreign_keys=[source_user_id])
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_user_id])

    __table_args__ = (
        Index("ix_referral_commissions_beneficiary_created", "beneficiary_user_id", "created_at"),
        Index("ix_referral_commissions_source_created", "source_user_id", "created_at"),
        Index("ix_referral_commissions_level_type", "level", "commission_type"),
    )


class InternalWallet(Base):
    __tablename__ = "internal_wallets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    currency: Mapped[str] = mapped_column(String(16), default="SLB_POINT", index=True)
    available_balance: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    locked_balance: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    total_deposit: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    total_withdraw: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    total_profit: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    total_loss: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="internal_wallets")

    __table_args__ = (Index("ix_internal_wallets_user_currency", "user_id", "currency", unique=True),)


class PointLedgerEntry(Base):
    __tablename__ = "point_ledger_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("internal_wallets.id"), index=True)
    entry_type: Mapped[WalletLedgerType] = mapped_column(Enum(WalletLedgerType), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    balance_before: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    balance_after: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    reference_type: Mapped[str] = mapped_column(String(64), default="", index=True)
    reference_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    user: Mapped[User] = relationship(back_populates="point_ledger_entries", foreign_keys=[user_id])
    wallet: Mapped[InternalWallet] = relationship()
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_user_id])

    __table_args__ = (Index("ix_point_ledger_user_created", "user_id", "created_at"),)


class PointTransfer(Base):
    __tablename__ = "point_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    sender_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    receiver_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    currency: Mapped[str] = mapped_column(String(16), default="SLB_POINT", index=True)
    status: Mapped[str] = mapped_column(String(32), default="completed", index=True)
    memo: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    sender: Mapped[User] = relationship(
        back_populates="point_transfers_sent",
        foreign_keys=[sender_user_id],
    )
    receiver: Mapped[User] = relationship(
        back_populates="point_transfers_received",
        foreign_keys=[receiver_user_id],
    )

    __table_args__ = (
        Index("ix_point_transfers_sender_created", "sender_user_id", "created_at"),
        Index("ix_point_transfers_receiver_created", "receiver_user_id", "created_at"),
    )


class PlatformTreasuryAccount(Base):
    __tablename__ = "platform_treasury_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    currency: Mapped[str] = mapped_column(String(16), default="SLB_POINT", unique=True, index=True)
    available_balance: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    reserve_floor: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    total_platform_profit: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    total_platform_loss: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class PlatformLedgerEntry(Base):
    __tablename__ = "platform_ledger_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    treasury_id: Mapped[int] = mapped_column(ForeignKey("platform_treasury_accounts.id"), index=True)
    entry_type: Mapped[str] = mapped_column(String(64), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    balance_before: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    balance_after: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    reference_type: Mapped[str] = mapped_column(String(64), default="", index=True)
    reference_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    treasury: Mapped[PlatformTreasuryAccount] = relationship()
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_user_id])


class SandboxTransaction(Base):
    __tablename__ = "sandbox_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    request_type: Mapped[SandboxRequestType] = mapped_column(Enum(SandboxRequestType), index=True)
    status: Mapped[SandboxRequestStatus] = mapped_column(
        Enum(SandboxRequestStatus), default=SandboxRequestStatus.PENDING, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    currency: Mapped[str] = mapped_column(String(16), default="SLB_POINT", index=True)
    transfer_channel: Mapped[str] = mapped_column(String(80), default="")
    account_name: Mapped[str] = mapped_column(String(120), default="")
    account_identifier: Mapped[str] = mapped_column(String(255), default="")
    member_note: Mapped[str] = mapped_column(Text, default="")
    admin_note: Mapped[str] = mapped_column(Text, default="")
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="sandbox_transactions", foreign_keys=[user_id])
    reviewed_by: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_user_id])


class BoOrder(Base):
    __tablename__ = "bo_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    session_code: Mapped[str] = mapped_column(String(32), index=True)
    asset: Mapped[str] = mapped_column(String(16), index=True)
    side: Mapped[BoSide] = mapped_column(Enum(BoSide), index=True)
    stake_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    payout_ratio: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("1.95"))
    entry_price: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))
    result_price: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))
    status: Mapped[GameRequestStatus] = mapped_column(
        Enum(GameRequestStatus), default=GameRequestStatus.ACCEPTED, index=True
    )
    profit_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    result_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    user: Mapped[User] = relationship(back_populates="bo_orders")

    __table_args__ = (Index("ix_bo_orders_user_created", "user_id", "created_at"),)


class RapidEntry(Base):
    __tablename__ = "rapid_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    session_code: Mapped[str] = mapped_column(String(32), index=True)
    play_type: Mapped[RapidPlayType] = mapped_column(Enum(RapidPlayType), index=True)
    selection: Mapped[str] = mapped_column(String(80), index=True)
    stake_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    payout_ratio: Mapped[Decimal] = mapped_column(Numeric(10, 4))
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    result_code: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[GameRequestStatus] = mapped_column(
        Enum(GameRequestStatus), default=GameRequestStatus.ACCEPTED, index=True
    )
    result_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    user: Mapped[User] = relationship(back_populates="rapid_entries")

    __table_args__ = (Index("ix_rapid_entries_user_created", "user_id", "created_at"),)


class RapidResultBoard(Base):
    __tablename__ = "rapid_result_boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    special_number: Mapped[str] = mapped_column(String(8), default="", index=True)
    result_payload: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    settled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    __table_args__ = (Index("ix_rapid_result_boards_created", "created_at"),)


class EmailNotification(Base):
    __tablename__ = "email_notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipient: Mapped[str] = mapped_column(String(255), index=True)
    subject: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[EmailStatus] = mapped_column(Enum(EmailStatus), default=EmailStatus.QUEUED, index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    transaction_id: Mapped[int | None] = mapped_column(ForeignKey("transaction_requests.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EmailReply(Base):
    __tablename__ = "email_replies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sender: Mapped[str] = mapped_column(String(255), index=True)
    recipient: Mapped[str] = mapped_column(String(255), default="")
    subject: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    provider_message_id: Mapped[str] = mapped_column(String(255), default="", index=True)
    raw_payload: Mapped[str] = mapped_column(Text, default="")
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    transaction_id: Mapped[int | None] = mapped_column(ForeignKey("transaction_requests.id"), nullable=True, index=True)
    is_processed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User | None] = relationship(back_populates="email_replies")
    transaction: Mapped[TransactionRequest | None] = relationship(back_populates="email_replies")


class ServiceRequest(Base):
    __tablename__ = "service_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    service_type: Mapped[str] = mapped_column(String(64), default="ip_switch", index=True)
    status: Mapped[str] = mapped_column(String(32), default=TransactionStatus.PENDING.value, index=True)
    target_region: Mapped[str] = mapped_column(String(64), default="")
    protocol: Mapped[str] = mapped_column(String(64), default="")
    duration_hours: Mapped[int] = mapped_column(Integer, default=24)
    device_label: Mapped[str] = mapped_column(String(120), default="")
    current_ip: Mapped[str] = mapped_column(String(80), default="")
    member_note: Mapped[str] = mapped_column(Text, default="")
    assigned_endpoint: Mapped[str] = mapped_column(String(255), default="")
    admin_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="service_requests")


class ContentPost(Base):
    __tablename__ = "content_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_type: Mapped[ContentPostType] = mapped_column(Enum(ContentPostType), index=True)
    title: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(String(500), default="")
    target_url: Mapped[str] = mapped_column(String(500), default="")
    platform: Mapped[str] = mapped_column(String(64), default="other", index=True)
    market_session: Mapped[str] = mapped_column(String(64), default="", index=True)
    market_bias: Mapped[str] = mapped_column(String(32), default="", index=True)
    risk_level: Mapped[str] = mapped_column(String(32), default="", index=True)
    tradingview_symbol: Mapped[str] = mapped_column(String(80), default="")
    tradingview_url: Mapped[str] = mapped_column(String(500), default="")
    analysis_category: Mapped[str] = mapped_column(String(80), default="", index=True)
    locale: Mapped[str] = mapped_column(String(12), default="vi", index=True)
    status: Mapped[ContentPostStatus] = mapped_column(
        Enum(ContentPostStatus), default=ContentPostStatus.DRAFT, index=True
    )
    source: Mapped[ContentPostSource] = mapped_column(
        Enum(ContentPostSource), default=ContentPostSource.ADMIN, index=True
    )
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    ai_agent_name: Mapped[str] = mapped_column(String(120), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    tags: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    created_by: Mapped[User | None] = relationship(back_populates="content_posts")

    __table_args__ = (
        Index("ix_content_posts_type_status_locale", "post_type", "status", "locale"),
        Index("ix_content_posts_type_sort", "post_type", "sort_order", "created_at"),
    )


class AiAgentApiKey(Base):
    __tablename__ = "ai_agent_api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    key_hash: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    prefix: Mapped[str] = mapped_column(String(16), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    allowed_post_types: Mapped[str] = mapped_column(Text, default='["job","shop","crypto_analysis"]')
    can_auto_publish: Mapped[bool] = mapped_column(Boolean, default=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    logs: Mapped[list["AiAgentPostLog"]] = relationship(back_populates="agent_key")


class AiAgentPostLog(Base):
    __tablename__ = "ai_agent_post_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_key_id: Mapped[int | None] = mapped_column(ForeignKey("ai_agent_api_keys.id"), nullable=True, index=True)
    endpoint: Mapped[str] = mapped_column(String(255), default="")
    post_type: Mapped[str] = mapped_column(String(32), default="", index=True)
    request_ip: Mapped[str] = mapped_column(String(64), default="")
    status_code: Mapped[int] = mapped_column(Integer, default=200)
    error_message: Mapped[str] = mapped_column(Text, default="")
    created_post_id: Mapped[int | None] = mapped_column(ForeignKey("content_posts.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    agent_key: Mapped[AiAgentApiKey | None] = relationship(back_populates="logs")


class UtilityItem(Base):
    __tablename__ = "utility_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(64), default="spark")
    route_path: Mapped[str] = mapped_column(String(255), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_member_only: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_free: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class MemberUtilityUsage(Base):
    __tablename__ = "member_utility_usage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    utility_key: Mapped[str] = mapped_column(String(80), index=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="utility_usage")

    __table_args__ = (Index("ix_member_utility_usage_user_key", "user_id", "utility_key", unique=True),)


class ShortLink(Base):
    __tablename__ = "short_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    target_url: Mapped[str] = mapped_column(String(700))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    click_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class SecurityRule(Base):
    __tablename__ = "security_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    rule_type: Mapped[str] = mapped_column(String(40), index=True)
    value: Mapped[str] = mapped_column(String(255), index=True)
    action: Mapped[str] = mapped_column(String(24), default="block")
    severity: Mapped[str] = mapped_column(String(24), default="medium", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class IpReputationCache(Base):
    __tablename__ = "ip_reputation_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ip_address: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    ip_version: Mapped[str] = mapped_column(String(16), default="unknown")
    country_code: Mapped[str] = mapped_column(String(8), default="", index=True)
    country_name: Mapped[str] = mapped_column(String(120), default="")
    region: Mapped[str] = mapped_column(String(120), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    latitude: Mapped[float | None] = mapped_column(Numeric(10, 6), nullable=True)
    longitude: Mapped[float | None] = mapped_column(Numeric(10, 6), nullable=True)
    timezone: Mapped[str] = mapped_column(String(80), default="")
    asn: Mapped[str] = mapped_column(String(80), default="")
    isp: Mapped[str] = mapped_column(String(160), default="")
    organization: Mapped[str] = mapped_column(String(160), default="")
    is_proxy: Mapped[bool] = mapped_column(Boolean, default=False)
    is_vpn: Mapped[bool] = mapped_column(Boolean, default=False)
    is_tor: Mapped[bool] = mapped_column(Boolean, default=False)
    is_hosting: Mapped[bool] = mapped_column(Boolean, default=False)
    risk_score: Mapped[int] = mapped_column(Integer, default=0, index=True)
    provider: Mapped[str] = mapped_column(String(80), default="")
    raw_json: Mapped[str] = mapped_column(Text, default="{}")
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class SecurityEvent(Base):
    __tablename__ = "security_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(24), default="info", index=True)
    risk_score: Mapped[int] = mapped_column(Integer, default=0, index=True)
    ip_address: Mapped[str] = mapped_column(String(80), default="", index=True)
    ip_version: Mapped[str] = mapped_column(String(16), default="unknown")
    country_code: Mapped[str] = mapped_column(String(8), default="", index=True)
    country_name: Mapped[str] = mapped_column(String(120), default="")
    region: Mapped[str] = mapped_column(String(120), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    asn: Mapped[str] = mapped_column(String(80), default="")
    isp: Mapped[str] = mapped_column(String(160), default="")
    path: Mapped[str] = mapped_column(String(500), default="", index=True)
    method: Mapped[str] = mapped_column(String(12), default="")
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    user_agent: Mapped[str] = mapped_column(Text, default="")
    referer: Mapped[str] = mapped_column(Text, default="")
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    username_or_email: Mapped[str] = mapped_column(String(255), default="", index=True)
    rule_id: Mapped[int | None] = mapped_column(ForeignKey("security_rules.id"), nullable=True, index=True)
    request_id: Mapped[str] = mapped_column(String(80), default="", index=True)
    details_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    __table_args__ = (
        Index("ix_security_events_type_created", "event_type", "created_at"),
        Index("ix_security_events_ip_created", "ip_address", "created_at"),
    )


class SecurityIncident(Base):
    __tablename__ = "security_incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(220))
    incident_type: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), default="open", index=True)
    severity: Mapped[str] = mapped_column(String(24), default="medium", index=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    affected_ip: Mapped[str] = mapped_column(String(80), default="", index=True)
    affected_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    event_count: Mapped[int] = mapped_column(Integer, default=0)
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class SecurityPlaybook(Base):
    __tablename__ = "security_playbooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_type: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(220))
    description: Mapped[str] = mapped_column(Text, default="")
    immediate_steps: Mapped[str] = mapped_column(Text, default="")
    containment_steps: Mapped[str] = mapped_column(Text, default="")
    eradication_steps: Mapped[str] = mapped_column(Text, default="")
    recovery_steps: Mapped[str] = mapped_column(Text, default="")
    prevention_steps: Mapped[str] = mapped_column(Text, default="")
    checklist_json: Mapped[str] = mapped_column(Text, default="[]")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
