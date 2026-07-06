from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import secrets

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    InternalWallet,
    PointLedgerEntry,
    ReferralCommission,
    ReferralCommissionStatus,
    ReferralCommissionType,
    User,
    WalletLedgerType,
)


MAX_REFERRAL_LEVEL = 3
ACTIVITY_COMMISSION_RATES = {
    1: Decimal("0.20"),
    2: Decimal("0.08"),
    3: Decimal("0.03"),
}
LOSS_DEPOSIT_COMMISSION_RATES = {
    1: Decimal("6.00"),
    2: Decimal("2.00"),
    3: Decimal("1.00"),
}
REFERRAL_COMMISSION_RATES = ACTIVITY_COMMISSION_RATES
MIN_COMMISSION_PAYOUT = Decimal("0.0001")
AUTO_PAYOUT_ENABLED = True


@dataclass(frozen=True)
class ReferralLevelSummary:
    level: int
    count: int
    rate_percent: Decimal


def normalize_referral_code(value: str | None) -> str:
    return "".join(ch for ch in (value or "").strip().upper() if ch.isalnum() or ch in {"-", "_"})


def ensure_user_referral_identity(db: Session, user: User) -> None:
    if not user.uid:
        user.uid = _unique_member_code(db, prefix="GL")
    if not user.referral_code:
        user.referral_code = _unique_member_code(db, prefix="RF")


def ensure_all_user_referral_identities(db: Session) -> int:
    users = db.query(User).filter((User.uid == "") | (User.referral_code == "")).all()
    for user in users:
        ensure_user_referral_identity(db, user)
    if users:
        db.commit()
    return len(users)


def find_referrer(db: Session, referral_code: str | None) -> User | None:
    code = normalize_referral_code(referral_code)
    if not code:
        return None
    return (
        db.query(User)
        .filter(
            User.is_active.is_(True),
            User.is_admin.is_(False),
            (User.referral_code == code) | (User.uid == code),
        )
        .first()
    )


def build_referral_link(user: User, base_url: str, locale: str = "vi") -> str:
    code = user.referral_code or user.uid
    return f"{base_url.rstrip('/')}/register?ref={code}&lang={locale}"


def referral_level_counts(db: Session, root_user: User, max_level: int = MAX_REFERRAL_LEVEL) -> list[ReferralLevelSummary]:
    results: list[ReferralLevelSummary] = []
    current_parent_ids = [root_user.id]
    for level in range(1, max_level + 1):
        if not current_parent_ids:
            results.append(ReferralLevelSummary(level, 0, ACTIVITY_COMMISSION_RATES[level]))
            continue
        children = (
            db.query(User.id)
            .filter(User.referred_by_user_id.in_(current_parent_ids), User.is_admin.is_(False))
            .all()
        )
        child_ids = [int(row[0]) for row in children]
        results.append(ReferralLevelSummary(level, len(child_ids), ACTIVITY_COMMISSION_RATES[level]))
        current_parent_ids = child_ids
    return results


def referral_tree(db: Session, root_user: User, max_level: int = MAX_REFERRAL_LEVEL) -> list[dict]:
    tree: list[dict] = []
    queue: deque[tuple[int, int]] = deque([(root_user.id, 0)])
    while queue:
        parent_id, parent_level = queue.popleft()
        next_level = parent_level + 1
        if next_level > max_level:
            continue
        children = (
            db.query(User)
            .filter(User.referred_by_user_id == parent_id, User.is_admin.is_(False))
            .order_by(User.created_at.desc())
            .limit(200)
            .all()
        )
        for child in children:
            tree.append({"level": next_level, "user": child})
            queue.append((child.id, next_level))
    return tree


def member_commission_summary(db: Session, user: User) -> dict:
    rows = (
        db.query(ReferralCommission.status, func.coalesce(func.sum(ReferralCommission.amount), 0))
        .filter(ReferralCommission.beneficiary_user_id == user.id)
        .group_by(ReferralCommission.status)
        .all()
    )
    totals = {status.value if hasattr(status, "value") else str(status): Decimal(str(amount or 0)) for status, amount in rows}
    total_amount = sum(totals.values(), Decimal("0"))
    recent = (
        db.query(ReferralCommission)
        .filter(ReferralCommission.beneficiary_user_id == user.id)
        .order_by(ReferralCommission.created_at.desc())
        .limit(20)
        .all()
    )
    return {"totals": totals, "total_amount": total_amount, "recent": recent}


def commission_rates_for_type(commission_type: ReferralCommissionType) -> dict[int, Decimal]:
    if commission_type == ReferralCommissionType.LOSS_DEPOSIT:
        return LOSS_DEPOSIT_COMMISSION_RATES
    return ACTIVITY_COMMISSION_RATES


def create_referral_commissions(
    db: Session,
    *,
    source_user: User,
    commission_type: ReferralCommissionType,
    base_amount: Decimal,
    currency: str = "POINT",
    reference_type: str = "",
    reference_id: str = "",
    note: str = "",
    created_by: User | None = None,
    status: ReferralCommissionStatus = ReferralCommissionStatus.PENDING,
) -> list[ReferralCommission]:
    if base_amount <= 0:
        raise ValueError("base_amount_must_be_positive")
    current = source_user
    created: list[ReferralCommission] = []
    rates = commission_rates_for_type(commission_type)
    normalized_reference_type = reference_type.strip()[:64]
    normalized_reference_id = reference_id.strip()[:64]
    for level in range(1, MAX_REFERRAL_LEVEL + 1):
        sponsor_id = current.referred_by_user_id
        if not sponsor_id:
            break
        sponsor = db.get(User, sponsor_id)
        if not sponsor or not sponsor.is_active or sponsor.is_admin or sponsor.id == source_user.id:
            break
        duplicate = (
            db.query(ReferralCommission.id)
            .filter(
                ReferralCommission.beneficiary_user_id == sponsor.id,
                ReferralCommission.source_user_id == source_user.id,
                ReferralCommission.level == level,
                ReferralCommission.commission_type == commission_type,
                ReferralCommission.reference_type == normalized_reference_type,
                ReferralCommission.reference_id == normalized_reference_id,
            )
            .first()
        )
        if duplicate:
            current = sponsor
            continue
        rate = rates[level]
        amount = (base_amount * rate / Decimal("100")).quantize(Decimal("0.0001"))
        if amount < MIN_COMMISSION_PAYOUT:
            current = sponsor
            continue
        commission = ReferralCommission(
            reference_code=_unique_commission_code(db),
            beneficiary_user_id=sponsor.id,
            source_user_id=source_user.id,
            level=level,
            commission_type=commission_type,
            rate_percent=rate,
            base_amount=base_amount,
            amount=amount,
            currency=(currency or "POINT").strip().upper()[:16],
            status=status,
            reference_type=normalized_reference_type,
            reference_id=normalized_reference_id,
            note=note.strip(),
            created_by_user_id=created_by.id if created_by else None,
        )
        db.add(commission)
        db.flush()
        if AUTO_PAYOUT_ENABLED and commission.status in {ReferralCommissionStatus.PENDING, ReferralCommissionStatus.APPROVED}:
            auto_pay_referral_commission(db, commission)
        created.append(commission)
        current = sponsor
    if created:
        db.commit()
        for item in created:
            db.refresh(item)
    return created


def auto_pay_referral_commission(db: Session, commission: ReferralCommission) -> ReferralCommission:
    if commission.status == ReferralCommissionStatus.PAID:
        return commission
    if commission.status == ReferralCommissionStatus.VOID:
        return commission
    agent = db.get(User, commission.beneficiary_user_id)
    if not agent or not agent.is_active or agent.is_admin:
        commission.status = ReferralCommissionStatus.VOID
        commission.note = f"{commission.note}\nAuto void: inactive or invalid beneficiary.".strip()
        return commission
    amount = Decimal(str(commission.amount or 0)).quantize(Decimal("0.0001"))
    if amount < MIN_COMMISSION_PAYOUT:
        commission.status = ReferralCommissionStatus.VOID
        commission.note = f"{commission.note}\nAuto void: below minimum payout.".strip()
        return commission
    wallet = _ensure_agent_wallet(db, agent, commission.currency)
    before = Decimal(str(wallet.available_balance or 0)).quantize(Decimal("0.0001"))
    after = (before + amount).quantize(Decimal("0.0001"))
    wallet.available_balance = after
    wallet.updated_at = datetime.now(timezone.utc)
    db.add(
        PointLedgerEntry(
            user_id=agent.id,
            wallet_id=wallet.id,
            entry_type=WalletLedgerType.ADJUSTMENT,
            amount=amount,
            balance_before=before,
            balance_after=after,
            reference_type="referral_commission",
            reference_id=commission.reference_code,
            reason=(
                f"Auto paid referral commission {commission.commission_type.value} "
                f"L{commission.level} from {commission.reference_type}:{commission.reference_id}"
            ),
            created_by_user_id=commission.created_by_user_id,
        )
    )
    commission.status = ReferralCommissionStatus.PAID
    commission.note = f"{commission.note}\nAuto paid to internal wallet.".strip()
    return commission


def admin_referral_summary(db: Session) -> dict:
    members = db.query(User).filter(User.is_admin.is_(False)).count()
    referred_members = db.query(User).filter(User.is_admin.is_(False), User.referred_by_user_id.is_not(None)).count()
    commission_count = db.query(ReferralCommission).count()
    pending_total = (
        db.query(func.coalesce(func.sum(ReferralCommission.amount), 0))
        .filter(ReferralCommission.status == ReferralCommissionStatus.PENDING)
        .scalar()
    )
    approved_total = (
        db.query(func.coalesce(func.sum(ReferralCommission.amount), 0))
        .filter(ReferralCommission.status == ReferralCommissionStatus.APPROVED)
        .scalar()
    )
    paid_total = (
        db.query(func.coalesce(func.sum(ReferralCommission.amount), 0))
        .filter(ReferralCommission.status == ReferralCommissionStatus.PAID)
        .scalar()
    )
    activity_total = (
        db.query(func.coalesce(func.sum(ReferralCommission.amount), 0))
        .filter(ReferralCommission.commission_type == ReferralCommissionType.ACTIVITY)
        .scalar()
    )
    loss_deposit_total = (
        db.query(func.coalesce(func.sum(ReferralCommission.amount), 0))
        .filter(ReferralCommission.commission_type == ReferralCommissionType.LOSS_DEPOSIT)
        .scalar()
    )
    return {
        "members": members,
        "referred_members": referred_members,
        "commission_count": commission_count,
        "pending_total": Decimal(str(pending_total or 0)),
        "approved_total": Decimal(str(approved_total or 0)),
        "paid_total": Decimal(str(paid_total or 0)),
        "activity_total": Decimal(str(activity_total or 0)),
        "loss_deposit_total": Decimal(str(loss_deposit_total or 0)),
    }


def _ensure_agent_wallet(db: Session, user: User, currency: str | None = None) -> InternalWallet:
    code = (currency or "SLB_POINT").strip().upper()[:16]
    wallet = db.query(InternalWallet).filter(InternalWallet.user_id == user.id, InternalWallet.currency == code).first()
    if wallet:
        return wallet
    wallet = InternalWallet(user_id=user.id, currency=code)
    db.add(wallet)
    db.flush()
    return wallet


def _unique_member_code(db: Session, prefix: str) -> str:
    for _ in range(30):
        code = f"{prefix}{secrets.token_hex(4).upper()}"
        exists = db.query(User.id).filter((User.uid == code) | (User.referral_code == code)).first()
        if not exists:
            return code
    raise RuntimeError("Could not generate unique member code")


def _unique_commission_code(db: Session) -> str:
    for _ in range(30):
        code = f"RC{secrets.token_hex(6).upper()}"
        exists = db.query(ReferralCommission.id).filter(ReferralCommission.reference_code == code).first()
        if not exists:
            return code
    raise RuntimeError("Could not generate unique commission code")
