from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.communication.manager import RoomManager
from app.communication.router import router as communication_router
from app.group_translation.router import router as group_translation_router
from app.group_radio import RadioFloorManager, RadioRoomCapacity
from app.group_radio.router import router as group_radio_router
from app.bff.router import router as bff_router
from app.bff.session_store import SessionStore
from app.core.config import BASE_DIR, Settings, get_settings
from app.integrations.timeblock.client import TimeblockClient, TimeblockIntegrationError
from app.telemetry.logging import configure_logging

configure_logging()


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async def cleanup_loop() -> None:
            while True:
                await asyncio.sleep(30)
                await app.state.room_manager.cleanup()
                await app.state.radio_floor.cleanup()

        task = asyncio.create_task(cleanup_loop())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            close_client = getattr(getattr(app, "state", None), "timeblock_client", None)
            close_method = getattr(close_client, "aclose", None)
            if close_method:
                await close_method()

    application = FastAPI(title=runtime_settings.app_name, debug=runtime_settings.debug, lifespan=lifespan)
    application.state.settings = runtime_settings
    application.state.room_manager = RoomManager(runtime_settings)
    application.state.radio_floor = RadioFloorManager(
        lease_seconds=runtime_settings.group_radio_floor_lease_seconds,
        max_burst_seconds=runtime_settings.group_radio_max_burst_seconds,
    )
    application.state.radio_capacity = RadioRoomCapacity(runtime_settings.group_radio_max_rooms)
    application.state.timeblock_client = TimeblockClient(runtime_settings)
    application.state.bff_session_store = SessionStore(
        session_ttl_seconds=runtime_settings.guilua_session_ttl_seconds,
        pending_ttl_seconds=runtime_settings.guilua_pending_authorization_ttl_seconds,
        max_entries=runtime_settings.guilua_session_max_entries,
        max_pending_entries=runtime_settings.guilua_pending_authorization_max_entries,
        pending_rate_limit_count=runtime_settings.guilua_authorization_start_rate_limit_count,
        pending_rate_limit_window_seconds=(
            runtime_settings.guilua_authorization_start_rate_limit_window_seconds
        ),
    )
    application.mount('/static', StaticFiles(directory=BASE_DIR / 'app' / 'static'), name='static')

    @application.get('/service-worker.js', include_in_schema=False)
    async def service_worker() -> FileResponse:
        response = FileResponse(BASE_DIR / 'app' / 'static' / 'service-worker.js', media_type='application/javascript')
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Service-Worker-Allowed'] = '/'
        return response

    application.include_router(bff_router)
    application.include_router(communication_router)
    application.include_router(group_translation_router)
    application.include_router(group_radio_router)

    @application.get('/healthz/')
    async def healthz() -> dict[str, str]:
        return {'status': 'ok', 'service': 'guilua-communication-runtime'}

    @application.get('/readyz/')
    async def readyz():
        if runtime_settings.development_session_fallback_enabled:
            return {
                'status': 'ready',
                'service': 'guilua-communication-runtime',
                'authority': 'development',
                'deployment_version': runtime_settings.deployment_version,
            }
        try:
            manifest = await application.state.timeblock_client.contract_capabilities()
        except TimeblockIntegrationError:
            return JSONResponse(
                {
                    'status': 'not_ready',
                    'service': 'guilua-communication-runtime',
                    'dependency': 'timeblock_client_contract_v2',
                    'deployment_version': runtime_settings.deployment_version,
                },
                status_code=503,
            )
        return {
            'status': 'ready',
            'service': 'guilua-communication-runtime',
            'authority': manifest['authority'],
            'contract_version': manifest['contract_version'],
            'deployment_version': runtime_settings.deployment_version,
        }

    return application


app = create_app()
