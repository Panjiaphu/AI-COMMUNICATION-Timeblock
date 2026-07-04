from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.models import InternalWallet, User
from app.services.slbo_outcome_settings import get_member_target_success_rate


def pct(v, default=Decimal('0.00')):
    if v is None or v == '':
        v = default
    x = Decimal(str(v)).quantize(Decimal('0.01'))
    return max(Decimal('0.00'), min(Decimal('100.00'), x))


def money(v):
    return Decimal(str(v or 0)).quantize(Decimal('0.0001'))


def ensure_table(db: Session):
    db.execute(text('''CREATE TABLE IF NOT EXISTS slbo_member_outcome_settings (
        user_id INTEGER PRIMARY KEY,
        member_target_success_rate NUMERIC(5,2) NOT NULL DEFAULT 45.00,
        positive_profit_guard_percent NUMERIC(8,2) NOT NULL DEFAULT 0.00,
        guard_enabled INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        updated_by_user_id INTEGER NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )'''))
    db.commit()


def profit_percent(wallet: InternalWallet | None):
    if not wallet:
        return Decimal('0.00')
    basis = money(wallet.total_deposit)
    if basis <= 0:
        basis = money(get_settings().member_initial_point_balance)
    if basis <= 0:
        basis = Decimal('1.0000')
    return (((money(wallet.total_profit) - money(wallet.total_loss)) / basis) * Decimal('100')).quantize(Decimal('0.01'))


def get_setting(db: Session, user_id: int):
    ensure_table(db)
    row = db.execute(text('''SELECT * FROM slbo_member_outcome_settings WHERE user_id=:uid'''), {'uid': int(user_id)}).mappings().first()
    if not row:
        return None
    return {
        'user_id': int(row['user_id']),
        'member_target_success_rate': pct(row['member_target_success_rate'], get_member_target_success_rate(db)),
        'positive_profit_guard_percent': pct(row['positive_profit_guard_percent']),
        'guard_enabled': bool(row['guard_enabled']),
        'note': row.get('note') or '',
    }


def settings_map(db: Session, members: list[User]):
    return {m.id: s for m in members if (s := get_setting(db, m.id))}


def update_setting(db: Session, *, user_id: int, target_rate, guard_percent, guard_enabled: bool, note='', admin_user_id=None):
    ensure_table(db)
    db.execute(text('''INSERT INTO slbo_member_outcome_settings
        (user_id, member_target_success_rate, positive_profit_guard_percent, guard_enabled, note, updated_by_user_id, created_at, updated_at)
        VALUES (:uid, :target, :guard, :enabled, :note, :admin, :now, :now)
        ON CONFLICT (user_id) DO UPDATE SET
        member_target_success_rate=EXCLUDED.member_target_success_rate,
        positive_profit_guard_percent=EXCLUDED.positive_profit_guard_percent,
        guard_enabled=EXCLUDED.guard_enabled,
        note=EXCLUDED.note,
        updated_by_user_id=EXCLUDED.updated_by_user_id,
        updated_at=EXCLUDED.updated_at'''), {
        'uid': int(user_id), 'target': pct(target_rate, get_member_target_success_rate(db)),
        'guard': pct(guard_percent), 'enabled': 1 if guard_enabled else 0,
        'note': str(note or '')[:500], 'admin': admin_user_id, 'now': datetime.now(timezone.utc)})
    db.commit()
    return get_setting(db, user_id)


def effective_policy(db: Session, *, user: User, wallet: InternalWallet | None):
    base = get_member_target_success_rate(db)
    s = get_setting(db, user.id) or {}
    target = pct(s.get('member_target_success_rate'), base)
    guard = pct(s.get('positive_profit_guard_percent'))
    enabled = bool(s.get('guard_enabled'))
    current = profit_percent(wallet)
    active = enabled and guard > 0 and current >= guard
    return {'member_target_success_rate': Decimal('0.00') if active else target,
            'base_member_target_success_rate': target,
            'positive_profit_guard_percent': guard,
            'current_profit_percent': current,
            'guard_enabled': enabled,
            'guard_active': active,
            'note': s.get('note') or ''}
