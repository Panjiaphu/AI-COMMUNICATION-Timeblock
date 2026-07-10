from decimal import Decimal
import os
import unittest

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import EmailNotification, InternalWallet, PointLedgerEntry, PointTransfer, SandboxTransaction, User
from app.services.referrals import ensure_user_referral_identity
from app.services.slbo import approve_deposit
from app.services.slbo_transfer_direct import transfer_points


class DirectPointTransferServiceTest(unittest.TestCase):
    def _delete_user(self, db, user_id: int) -> None:
        db.query(PointTransfer).filter(PointTransfer.sender_user_id == user_id).delete(synchronize_session=False)
        db.query(PointTransfer).filter(PointTransfer.receiver_user_id == user_id).delete(synchronize_session=False)
        db.query(PointLedgerEntry).filter(PointLedgerEntry.user_id == user_id).delete(synchronize_session=False)
        db.query(EmailNotification).filter(EmailNotification.user_id == user_id).delete(synchronize_session=False)
        db.query(SandboxTransaction).filter(SandboxTransaction.user_id == user_id).delete(synchronize_session=False)
        db.query(InternalWallet).filter(InternalWallet.user_id == user_id).delete(synchronize_session=False)
        user = db.get(User, user_id)
        if user:
            db.delete(user)

    def test_direct_point_transfer_writes_balances_and_ledger(self):
        suffix = os.getpid()
        emails = [
            f"direct-service-admin-{suffix}@example.com",
            f"direct-service-sender-{suffix}@example.com",
            f"direct-service-receiver-{suffix}@example.com",
        ]
        created_user_ids: list[int] = []
        with SessionLocal() as db:
            for existing in db.query(User).filter(User.email.in_(emails)).all():
                self._delete_user(db, existing.id)
            admin = User(email=emails[0], password_hash=hash_password("x"), is_admin=True, is_active=True, is_email_verified=True)
            sender = User(email=emails[1], password_hash=hash_password("x"), is_active=True, is_email_verified=True)
            receiver = User(email=emails[2], password_hash=hash_password("x"), is_active=True, is_email_verified=True)
            for user in (admin, sender, receiver):
                ensure_user_referral_identity(db, user)
                db.add(user)
            db.commit()
            for user in (admin, sender, receiver):
                db.refresh(user)
            created_user_ids = [admin.id, sender.id, receiver.id]
            approve_deposit(db, user=sender, amount=Decimal("500"), admin=admin, note="seed")
            item = transfer_points(db, sender=sender, recipient_identifier=receiver.uid, amount=Decimal("125"), memo="smoke")
            self.assertEqual("completed", item.status)
            self.assertTrue(item.reference_code.startswith("PT"))
            sender_wallet = db.query(InternalWallet).filter(InternalWallet.user_id == sender.id).first()
            receiver_wallet = db.query(InternalWallet).filter(InternalWallet.user_id == receiver.id).first()
            self.assertEqual(Decimal("375.0000"), sender_wallet.available_balance)
            self.assertEqual(Decimal("125.0000"), receiver_wallet.available_balance)
            self.assertEqual(2, db.query(PointLedgerEntry).filter(PointLedgerEntry.reference_id == item.reference_code).count())
            for user_id in created_user_ids:
                self._delete_user(db, user_id)
            db.commit()


if __name__ == "__main__":
    unittest.main()
