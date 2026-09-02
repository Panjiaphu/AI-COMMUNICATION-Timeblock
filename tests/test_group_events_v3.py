from __future__ import annotations

import asyncio

from app.group_v3.events import GroupEventBroker


def test_group_event_broker_fans_out_bounded_non_secret_invalidations():
    async def scenario():
        broker = GroupEventBroker(queue_size=1)
        async with broker.subscribe("space-1") as first, broker.subscribe("space-1") as second:
            await broker.publish("space-1", "message.created", resource_id="message-1")
            await broker.publish("space-1", "message.updated", resource_id="message-1")
            first_event = first.get_nowait()
            second_event = second.get_nowait()
            assert first_event.event_type == second_event.event_type == "message.updated"
            assert first_event.resource_id == second_event.resource_id == "message-1"
            assert "content" not in first_event.as_dict()
            assert "token" not in first_event.as_dict()

    asyncio.run(scenario())
