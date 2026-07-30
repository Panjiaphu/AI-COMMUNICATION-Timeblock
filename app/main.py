from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.communication.manager import room_manager
from app.communication.router import router as communication_router
from app.core.config import BASE_DIR, get_settings
from app.integrations.timeblock import TimeblockClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    cleanup_task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(30)
        await room_manager.cleanup()


settings = get_settings()
app = FastAPI(title="Guilua Communication Runtime", debug=settings.debug, lifespan=lifespan)
app.state.settings = settings
app.state.timeblock_client = TimeblockClient(settings)
app.mount("/static", StaticFiles(directory=BASE_DIR / "app" / "static"), name="static")
app.include_router(communication_router)


@app.get("/healthz/")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "guilua-communication-runtime"}
