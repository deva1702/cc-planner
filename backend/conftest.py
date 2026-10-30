# Register the marker used for performance-related tests.
def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "perf: timing checks that depend on machine speed; skip with  -m 'not perf'")