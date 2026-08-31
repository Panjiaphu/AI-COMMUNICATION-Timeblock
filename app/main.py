from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.communication.manager import RoomManager
from app.communication.router import router as communication_router
from app.group_translation.router import router as group_translation_router
from app.group_translation.provider import OpenAIGroupTranslationProvider
from app.group_v3.crypto import GroupCrypto
from app.group_v3.media import LiveKitGroupMediaProvider
from app.group_v3.radio_floor import DistributedRadioFloor
from app.group_v3.radio_router import router as group_v3_radio_router
from app.group_v3.radio_service import GroupRadioService
from app.group_v3.router import router as group_v3_router
from app.group_v3.session_router import router as group_v3_session_router
from app.group_v3.session_service import GroupMediaSessionService
from app.group_v3.translation_router import router as group_v3_translation_router
from app.group_v3.translation_service import GroupTranslationService
from app.group_v3.service import GroupService, GroupServiceError
from app.group_radio import RadioFloorManager, RadioRoomCapacity
from app.group_radio.router import router as group_radio_router
from app.handoff.router_v3 import router as group_handoff_v3_router
from app.bff.router import router as bff_router
from app.bff.session_store import SessionStore
from app.core.config import BASE_DIR, Settings, get_settings
from app.db import Database
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
                if app.state.settings.group_radio_v3_enabled:
                    try:
                        await app.state.group_radio_service.reconcile_device_loss(app.state.group_radio_floor)
                    except GroupServiceError:
                        pass

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
            database = getattr(getattr(app, "state", None), "database", None)
            if database:
                database.dispose()
            group_radio_floor = getattr(getattr(app, "state", None), "group_radio_floor", None)
            if group_radio_floor:
                await group_radio_floor.close()

    application = FastAPI(title=runtime_settings.app_name, debug=runtime_settings.debug, lifespan=lifespan)
    application.state.settings = runtime_settings
    application.state.database = Database(runtime_settings)
    group_crypto = GroupCrypto(runtime_settings)
    livekit_provider = LiveKitGroupMediaProvider(runtime_settings)
    application.state.group_service = GroupService(application.state.database, group_crypto)
    application.state.group_media_session_service = GroupMediaSessionService(
        application.state.database,
        runtime_settings,
        livekit_provider,
    )
    application.state.group_translation_service = GroupTranslationService(
        application.state.database,
        runtime_settings,
        group_crypto,
    )
    application.state.openai_group_translation_provider = OpenAIGroupTranslationProvider(runtime_settings)
    application.state.group_radio_floor = DistributedRadioFloor(runtime_settings)
    application.state.group_radio_service = GroupRadioService(
        application.state.database,
        runtime_settings,
        livekit_provider,
    )
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
    application.include_router(group_handoff_v3_router)
    application.include_router(group_v3_router)
    application.include_router(group_v3_session_router)
    application.include_router(group_v3_translation_router)
    application.include_router(group_v3_radio_router)
    application.include_router(communication_router)
    application.include_router(group_translation_router)
    application.include_router(group_radio_router)

    @application.exception_handler(GroupServiceError)
    async def group_service_error(_request: Request, exc: GroupServiceError) -> JSONResponse:
        return JSONResponse(
            {"detail": exc.code},
            status_code=exc.status_code,
            headers={
                "Cache-Control": "no-store, private, max-age=0",
                "Pragma": "no-cache",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @application.get('/healthz/')
    async def healthz() -> dict[str, str]:
        return {'status': 'ok', 'service': 'guilua-communication-runtime'}

    @application.get('/readyz/')
    async def readyz():
        if runtime_settings.group_v3_enabled:
            try:
                application.state.database.ping()
            except Exception:
                return JSONResponse(
                    {
                        'status': 'not_ready',
                        'service': 'guilua-communication-runtime',
                        'dependency': 'group_v3_database',
                        'deployment_version': runtime_settings.deployment_version,
                    },
                    status_code=503,
                )
        if runtime_settings.group_v3_enabled and runtime_settings.group_radio_v3_enabled:
            try:
                await application.state.group_radio_floor.ping()
            except GroupServiceError:
                return JSONResponse(
                    {
                        'status': 'not_ready',
                        'service': 'guilua-communication-runtime',
                        'dependency': 'group_radio_valkey',
                        'deployment_version': runtime_settings.deployment_version,
                    },
                    status_code=503,
                )
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
