from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.communication.manager import RoomManager
from app.communication.router import router as communication_router
from app.core.config import BASE_DIR, Settings, get_settings
from app.integrations.timeblock.client import TimeblockClient

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async def cleanup_loop() -> None:
            while True:
                await asyncio.sleep(30)
                await app.state.room_manager.cleanup()

        task = asyncio.create_task(cleanup_loop())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    application = FastAPI(title=runtime_settings.app_name, debug=runtime_settings.debug, lifespan=lifespan)
    application.state.settings = runtime_settings
    application.state.room_manager = RoomManager(runtime_settings)
    application.state.timeblock_client = TimeblockClient(runtime_settings)
    application.mount('/static', StaticFiles(directory=BASE_DIR / 'app' / 'static'), name='static')
    application.include_router(communication_router)

    @application.get('/healthz/')
    async def healthz() -> dict[str, str]:
        return {'status': 'ok', 'service': 'guilua-communication-runtime'}

    return application


app = create_app()
