import unittest

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.services.slbo import bo_session_clock, get_or_create_bo_session_result
from app.db.session import SessionLocal


class BoSixtySecondSessionMetadataTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_bo_clock_defaults_to_30_open_30_processing(self):
        settings = get_settings()
        self.assertEqual(30, settings.bo_trade_open_seconds)
        self.assertEqual(30, settings.bo_result_wait_seconds)
        clock = bo_session_clock()
        self.assertEqual(60, clock["total_seconds"])
        self.assertEqual(30, clock["open_seconds"])
        self.assertIn(clock["state"], {"open", "processing"})

    def test_room_state_exposes_bo_phase_metadata(self):
        response = self.client.get("/api/slbo/room-state?lang=vi")
        self.assertEqual(200, response.status_code)
        payload = response.json()
        bo_clock = payload["bo_clock"]
        self.assertEqual(60, bo_clock["total_seconds"])
        self.assertEqual(30, bo_clock["open_seconds"])
        self.assertEqual(30, bo_clock["processing_seconds"])
        self.assertIn("phase_label", bo_clock)
        self.assertIn("server_now_ts", payload)
        self.assertIn("server_now_ts", bo_clock)
        self.assertIn("current_session_start_ts", bo_clock)
        self.assertIn("current_session_cutoff_ts", bo_clock)
        self.assertIn("current_session_close_ts", bo_clock)
        self.assertIn("next_session_start_ts", bo_clock)
        self.assertGreater(bo_clock["server_now_ts"], 1_000_000_000_000)
        self.assertLessEqual(bo_clock["current_session_start_ts"], bo_clock["server_now_ts"])
        self.assertLess(bo_clock["current_session_start_ts"], bo_clock["current_session_cutoff_ts"])
        self.assertLess(bo_clock["current_session_cutoff_ts"], bo_clock["current_session_close_ts"])
        self.assertEqual(30_000, bo_clock["current_session_cutoff_ts"] - bo_clock["current_session_start_ts"])
        self.assertEqual(60_000, bo_clock["current_session_close_ts"] - bo_clock["current_session_start_ts"])
        self.assertEqual("1m", payload["settlement"]["settlement_interval"])
        self.assertEqual(True, payload["settlement"]["delayed_settlement"])

    def test_bo_chart_exposes_settlement_metadata(self):
        response = self.client.get("/api/slbo/bo-chart?asset=BTC&interval=1&limit=40")
        self.assertEqual(200, response.status_code)
        payload = response.json()
        self.assertEqual("1m", payload["settlement_interval"])
        self.assertEqual("BO System Chart", payload["settlement_source"])
        self.assertEqual("reference_only", payload["tradingview_role"])
        self.assertEqual(True, payload["delayed_settlement"])
        self.assertIn("server_now_ts", payload)
        self.assertIn("cutoff_ts", payload)
        self.assertIn("close_ts", payload)
        self.assertGreater(payload["server_now_ts"], 1_000_000_000_000)
        self.assertGreater(payload["cutoff_ts"], 1_000_000_000_000)
        self.assertGreater(payload["close_ts"], payload["cutoff_ts"])
        self.assertIn("processing_zone", payload)
        self.assertIn("member_order_markers", payload)
        self.assertGreaterEqual(len(payload["candles"]), 20)

    def test_bo_session_result_side_matches_entry_and_result_price(self):
        with SessionLocal() as db:
            result = get_or_create_bo_session_result(db, "S123456", "BTC")
            entry = result["entry_price"]
            close = result["result_price"]
            if close >= entry:
                self.assertEqual("buy", result["result_side"])
            else:
                self.assertEqual("sell", result["result_side"])
            again = get_or_create_bo_session_result(db, "S123456", "BTC")
            self.assertEqual(result["result_side"], again["result_side"])
            self.assertEqual(result["entry_price"], again["entry_price"])
            self.assertEqual(result["result_price"], again["result_price"])
            db.rollback()


if __name__ == "__main__":
    unittest.main()
