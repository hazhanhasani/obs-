"""A frozen encoder is recovered; a merely slow encoder is left alone."""
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch
from test_dashboard import streamcore


@contextmanager
def desired_main():
    yield SimpleNamespace(execute=lambda _: [dict(id='main', desired=1, mode='test', file=None)])


def test_controller_recovers_frozen_publisher_but_not_slow_publisher():
    for frozen in (False, True):
        controller = streamcore.Controller()
        now = [0]
        controller.tracker.clock = lambda: now[0]
        proc = SimpleNamespace(pid=100, stdout=None, poll=lambda: None)
        controller.processes['main'] = proc
        controller.tracker.attach('main', proc)
        controller.tracker.record('main', 100, {'frame': '5', 'speed': '0.5x'})
        now[0] = 30
        controller.tracker.record('main', 100, {'frame': '5' if frozen else '10', 'speed': '0.5x'})
        with patch.object(streamcore, 'connect', desired_main), patch.object(controller, 'stop') as stop:
            controller.reconcile()
        assert stop.call_count == int(frozen)
