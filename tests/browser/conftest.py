from __future__ import annotations

import os
from pathlib import Path

import pytest

BROWSER_QA_ENABLED = os.getenv("BROWSER_QA_ENABLED") == "1"

if BROWSER_QA_ENABLED:
    pytest.importorskip("playwright.sync_api")
    from playwright.sync_api import Playwright, sync_playwright

    from tests.browser.support import FAKE_MEDIA_ARGS, write_json


    @pytest.fixture(scope="session")
    def base_url() -> str:
        return os.getenv("BROWSER_QA_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


    @pytest.fixture(scope="session")
    def artifact_dir() -> Path:
        path = Path(os.getenv("BROWSER_QA_ARTIFACT_DIR", "artifacts/browser"))
        path.mkdir(parents=True, exist_ok=True)
        return path


    @pytest.fixture(scope="session")
    def playwright_runtime() -> Playwright:
        with sync_playwright() as runtime:
            yield runtime


    @pytest.fixture(scope="session")
    def chromium_browser(playwright_runtime: Playwright):
        browser = playwright_runtime.chromium.launch(headless=True, args=FAKE_MEDIA_ARGS)
        yield browser
        browser.close()


    @pytest.fixture(scope="session")
    def webkit_browser(playwright_runtime: Playwright):
        browser = playwright_runtime.webkit.launch(headless=True)
        yield browser
        browser.close()


    @pytest.fixture(scope="session", autouse=True)
    def record_browser_versions(artifact_dir: Path, chromium_browser, webkit_browser) -> None:
        write_json(
            artifact_dir / "browser-versions.json",
            {
                "playwright": "1.61.0",
                "chromium": chromium_browser.version,
                "webkit": webkit_browser.version,
                "physical_device": False,
                "fake_media": True,
            },
        )
